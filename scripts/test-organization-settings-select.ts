import assert from "node:assert/strict";
import {
  isUndefinedColumnError,
  selectWithColumnFallback,
  undefinedColumnName,
  type PostgrestLikeError,
} from "../src/lib/supabase/select-with-column-fallback";

// Production regression, 2026-10-23: the Business Settings load's
// hand-written 42703 fallback chain still selected regional_preferences
// at its deepest level. The production organizations table predates that
// column (and staff_sales_mode / drawer_no_sale_staff_allowed /
// books_currency), so every retry failed with 42703 and settings did
// not load at all. The shared tolerant read must end at the floor list —
// the exact select the app used before any optional column existed.

const WIDE = [
  "id", "name", "phone", "address", "city", "invoice_footer_note",
  "default_payment_terms", "overselling_policy", "staff_sales_mode",
  "drawer_no_sale_staff_allowed", "books_currency", "regional_preferences",
];
const FLOOR = [
  "id", "name", "phone", "address", "city", "invoice_footer_note",
  "default_payment_terms", "overselling_policy",
];

function undefinedColumn(column: string): PostgrestLikeError {
  return { code: "42703", message: `column organizations.${column} does not exist` };
}

type Outcome = { data: { id: string } | null; error: PostgrestLikeError | null };

function scriptedRun(script: (columns: string[], call: number) => Outcome) {
  const calls: string[][] = [];
  const run = async (columns: string[]): Promise<Outcome> => {
    calls.push([...columns]);
    return script(columns, calls.length);
  };
  return { run, calls };
}

async function main(): Promise<void> {
  // Error-shape helpers: Postgres phrasing, schema-cache phrasing, and
  // non-column errors are classified correctly.
  assert.equal(undefinedColumnName(undefinedColumn("books_currency")), "books_currency");
  assert.equal(
    undefinedColumnName({ code: "PGRST204", message: "Could not find the 'books_currency' column of 'organizations' in the schema cache" }),
    "books_currency",
  );
  assert.equal(isUndefinedColumnError({ code: "42501", message: "permission denied for table organizations" }), false);
  assert.equal(undefinedColumnName({ code: "42501", message: "permission denied for table organizations" }), null);
  assert.equal(isUndefinedColumnError(null), false);

  // (a1) Post-migration database: the widened select succeeds on the
  // first attempt, verbatim — behaviour is unchanged.
  {
    const { run, calls } = scriptedRun(() => ({ data: { id: "org1" }, error: null }));
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(result.error, null);
    assert.deepEqual(result.data, { id: "org1" });
    assert.equal(calls.length, 1, "no retry when the widened select succeeds");
    assert.deepEqual(calls[0], WIDE);
    assert.deepEqual(result.columns, WIDE);
  }

  // (a2) Partially migrated: each 42703 drops exactly the named column;
  // unrelated optional columns are kept.
  {
    const { run, calls } = scriptedRun((columns) => {
      if (columns.includes("staff_sales_mode")) return { data: null, error: undefinedColumn("staff_sales_mode") };
      if (columns.includes("books_currency")) return { data: null, error: undefinedColumn("books_currency") };
      return { data: { id: "org1" }, error: null };
    });
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(result.error, null);
    assert.deepEqual(result.data, { id: "org1" });
    assert.equal(calls.length, 3);
    assert.ok(!calls[1].includes("staff_sales_mode"), "second attempt drops the named column");
    assert.ok(calls[1].includes("books_currency"), "second attempt keeps unrelated optional columns");
    assert.ok(calls[1].includes("regional_preferences"), "second attempt keeps regional_preferences");
    assert.ok(!result.columns.includes("staff_sales_mode"));
    assert.ok(!result.columns.includes("books_currency"));
    assert.ok(result.columns.includes("drawer_no_sale_staff_allowed"), "columns that exist are still read");
    assert.ok(result.columns.includes("regional_preferences"));
  }

  // (a3) Fully pre-migration database: every optional column is missing
  // in turn, and the read only succeeds at the floor — the exact legacy
  // column list, in order.
  {
    const missingInTurn = ["staff_sales_mode", "drawer_no_sale_staff_allowed", "books_currency", "regional_preferences"];
    const { run, calls } = scriptedRun((columns) => {
      const missing = missingInTurn.find((column) => columns.includes(column));
      return missing ? { data: null, error: undefinedColumn(missing) } : { data: { id: "org1" }, error: null };
    });
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(result.error, null);
    assert.deepEqual(result.data, { id: "org1" });
    assert.deepEqual(result.columns, FLOOR, "the successful select is exactly the legacy floor list");
    assert.deepEqual(calls[calls.length - 1], FLOOR);
  }

  // (a4) A 42703 whose column cannot be parsed jumps straight to the
  // floor for one final attempt instead of guessing column by column.
  {
    const { run, calls } = scriptedRun((columns, call) =>
      call === 1
        ? { data: null, error: { code: "42703", message: "undefined column" } }
        : { data: { id: "org1" }, error: null },
    );
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(result.error, null);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], FLOOR);
    assert.deepEqual(result.columns, FLOOR);
  }

  // (b1) A non-42703 error is returned untouched on the first attempt —
  // never retried, never swallowed.
  {
    const failure: PostgrestLikeError = { code: "42501", message: "permission denied for table organizations" };
    const { run, calls } = scriptedRun(() => ({ data: null, error: failure }));
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(calls.length, 1, "non-column errors are not retried");
    assert.equal(result.error, failure, "the original error object is returned verbatim");
    assert.deepEqual(result.columns, WIDE);
  }

  // (b2) A 42703 naming a FLOOR column cannot be fixed by dropping —
  // the error surfaces immediately instead of looping.
  {
    const { run, calls } = scriptedRun(() => ({ data: null, error: undefinedColumn("name") }));
    const result = await selectWithColumnFallback({ columns: WIDE, floor: FLOOR, run });
    assert.equal(calls.length, 1, "a missing floor column is not retried");
    assert.equal(result.error?.code, "42703");
  }

  // (b3) The floor itself failing with a droppable-column error left
  // over (error names a column already dropped) terminates with that
  // error once the floor has been attempted.
  {
    const { run, calls } = scriptedRun((columns) =>
      columns.includes("regional_preferences")
        ? { data: null, error: undefinedColumn("regional_preferences") }
        : { data: null, error: undefinedColumn("regional_preferences") },
    );
    const result = await selectWithColumnFallback({
      columns: ["name", "working_hours", "regional_preferences"],
      floor: ["name", "working_hours"],
      run,
    });
    assert.equal(result.error?.code, "42703");
    assert.deepEqual(result.columns, ["name", "working_hours"], "attempts end at the floor");
    assert.ok(calls.length <= 3, "the fallback always terminates");
  }

  console.log("test-organization-settings-select: all assertions passed");
}

void main();
