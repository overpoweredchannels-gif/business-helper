/**
 * Expiring Stock Checks structured type (P1 Area B, sub-defect (4) —
 * Option A, UMAIR-approved 2026-11-18) — Unit Tests.
 *
 * Defect: the "Expiring Stock Checks" tile count was a FRAGILE string
 * match on the task TITLE —
 * `pendingTasks.filter((t) => t.task_type === "stock_check" &&
 * t.title.toLowerCase().includes("expir"))` (page.tsx:14497) — so any
 * stock_check task whose title happened to mention "expir" counted,
 * and a genuine expiring-stock check with a plain title did not.
 * There was no structured field distinguishing an expiring stock
 * check from a generic stock_check task.
 *
 * Fix: a structured task type "expiry_check" now exists in `taskTypes`
 * (src/lib/tradeos/constants.ts), so the manual task form — whose
 * type select is driven by `taskTypes.map(...)` with
 * `taskTypeLabels[type]` — offers it, and the form validation
 * `taskTypes.includes(taskType) ? taskType : "general"` stores it.
 * task_type is a plain string with no enum/check constraint anywhere
 * (verified by grep over src/lib/migrations/ and the whole src tree),
 * so NO database migration was needed. The count is
 * `countExpiringStockChecks` (src/lib/dashboard/needs-attention.ts):
 * pending tasks whose task_type is "expiry_check", with NO title
 * matching anywhere in the count path. Existing stock_check tasks
 * are NOT re-typed — they stay stock_check and simply do not count.
 * The Task Manager filter gained its own "expiry_check" option
 * (labelled Expiring Stock Checks) and the old "stock_check" option
 * is now honestly labelled "Stock Checks" (new key `task.stockChecks`
 * ×4 locales); the tile deep-links to "expiry_check" via
 * `taskFilterForNeedsAttentionTile`. The filter still matches
 * "stock_check" tasks when that value is selected directly.
 *
 * This test imports the production helpers directly (no mirroring)
 * and asserts the wiring on the real page.tsx / messages.ts sources.
 *
 * Run: npx tsx scripts/test-expiry-check-type.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  countExpiringStockChecks,
  taskFilterForNeedsAttentionTile,
  taskMatchesTypeFilter,
} from "../src/lib/dashboard/needs-attention";
import { taskTypeLabels, taskTypes } from "../src/lib/tradeos/constants";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

type TaskLike = { task_type: string; title: string; status: string };

function pending(tasks: TaskLike[]): TaskLike[] {
  return tasks.filter((task) => task.status === "pending");
}

async function main(): Promise<void> {
  // --- (a) expiry_check is a valid task type; the form accepts it. ---

  check(
    taskTypes.includes("expiry_check"),
    '(a) "expiry_check" is in taskTypes',
  );
  check(
    taskTypes.includes("stock_check"),
    '(a) "stock_check" is still a valid task type (unchanged)',
  );
  check(
    taskTypeLabels["expiry_check"] === "Expiring Stock Check",
    '(a) taskTypeLabels has "Expiring Stock Check" for expiry_check',
  );
  check(
    taskTypeLabels["stock_check"] === "Stock Check",
    '(a) taskTypeLabels still has "Stock Check" for stock_check',
  );

  // The form's own validation rule, driven with the real taskTypes.
  const formStores = (taskType: string): string =>
    taskTypes.includes(taskType) ? taskType : "general";
  check(
    formStores("expiry_check") === "expiry_check",
    '(a) the form stores "expiry_check" (not coerced to "general")',
  );
  check(
    formStores("bogus_type") === "general",
    '(a) the form still coerces an unknown type to "general"',
  );

  // --- (b) the tile count counts ONLY pending expiry_check tasks. ---

  const mixed: TaskLike[] = [
    // A stock_check task whose title mentions "expir" — the OLD rule counted it.
    { task_type: "stock_check", title: "expiring milk check", status: "pending" },
    // An expiry_check task with a plain title — the OLD rule missed it.
    { task_type: "expiry_check", title: "check the dairy fridge", status: "pending" },
    { task_type: "expiry_check", title: "weekly expiry round", status: "pending" },
    { task_type: "general", title: "expiring contract review", status: "pending" },
    { task_type: "payment_collection", title: "expiry fee follow-up", status: "pending" },
  ];
  check(
    countExpiringStockChecks(pending(mixed)) === 2,
    "(b) count is 2: only the two pending expiry_check tasks (title wording ignored)",
  );
  check(
    countExpiringStockChecks(
      pending([
        { task_type: "stock_check", title: "expiring milk check", status: "pending" },
      ]),
    ) === 0,
    '(b) a stock_check task titled "expiring milk check" does NOT count',
  );
  check(
    countExpiringStockChecks(
      pending([
        { task_type: "expiry_check", title: "plain title, no expiry word", status: "pending" },
      ]),
    ) === 1,
    "(b) an expiry_check task with a plain title DOES count",
  );
  check(
    countExpiringStockChecks(
      pending([
        { task_type: "expiry_check", title: "done round", status: "completed" },
        { task_type: "expiry_check", title: "cancelled round", status: "cancelled" },
      ]),
    ) === 0,
    "(b) completed / cancelled expiry_check tasks do NOT count (pending list only)",
  );
  check(
    countExpiringStockChecks([]) === 0,
    "(b) no pending tasks => count is 0 (live data: no expiry_check tasks yet)",
  );
  check(
    countExpiringStockChecks(
      pending([
        { task_type: "expiry_check", title: "EXPIRING batch", status: "pending" },
      ]),
    ) === 1,
    "(b) title case is irrelevant — the type alone decides",
  );

  // --- (c) the Task Manager filter offers both types, separately. ---

  check(
    taskMatchesTypeFilter("expiry_check", "expiry_check") === true,
    '(c) "expiry_check" filter matches an expiry_check task',
  );
  check(
    taskMatchesTypeFilter("stock_check", "expiry_check") === false,
    '(c) "expiry_check" filter does NOT match a stock_check task',
  );
  check(
    taskMatchesTypeFilter("stock_check", "stock_check") === true,
    '(c) "stock_check" filter still matches a stock_check task',
  );
  check(
    taskMatchesTypeFilter("expiry_check", "stock_check") === false,
    '(c) "stock_check" filter does NOT match an expiry_check task',
  );
  check(
    taskMatchesTypeFilter("general", "expiry_check") === false,
    '(c) "expiry_check" filter does NOT match a general task',
  );

  // --- (d) the tile deep-links to expiry_check. ---

  check(
    taskFilterForNeedsAttentionTile("Expiring Stock Checks") === "expiry_check",
    '(d) "Expiring Stock Checks" tile -> "expiry_check" filter',
  );
  check(
    taskFilterForNeedsAttentionTile("Collection Tasks") === "payment_collection",
    '(d) "Collection Tasks" tile still -> "payment_collection"',
  );
  check(
    taskFilterForNeedsAttentionTile("Customer Follow-ups") === "follow_ups",
    '(d) "Customer Follow-ups" tile still -> "follow_ups"',
  );

  // --- (e) no title matching remains in the count path (real source). ---

  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  const countStart = pageSource.indexOf("const expiringProducts =");
  assert.ok(countStart >= 0, "count const exists in page.tsx");
  const countLine = pageSource.slice(countStart, pageSource.indexOf(";", countStart) + 1);
  check(
    countLine.includes("countExpiringStockChecks(pendingTasks)"),
    "(e) the tile count calls countExpiringStockChecks(pendingTasks)",
  );
  check(
    !countLine.includes("includes(") && !countLine.toLowerCase().includes("expir\""),
    "(e) the count line has NO title matching (no includes(), no \"expir\" string)",
  );
  check(
    !pageSource.includes('includes("expir")'),
    '(e) no includes("expir") title match remains anywhere in page.tsx',
  );
  check(
    pageSource.includes("countExpiringStockChecks"),
    "(e) page.tsx imports/uses the count helper",
  );

  // The form's type select is driven by taskTypes (so expiry_check is offered).
  const formSelectStart = pageSource.indexOf('value={taskType}');
  assert.ok(formSelectStart >= 0, "task form type select exists in page.tsx");
  const formSelectBlock = pageSource.slice(formSelectStart, formSelectStart + 400);
  check(
    formSelectBlock.includes("taskTypes.map((type)"),
    "(e) the task form type select is driven by taskTypes.map",
  );
  check(
    formSelectBlock.includes("taskTypeLabels[type]"),
    "(e) the task form type select labels come from taskTypeLabels",
  );

  // The Task Manager filter select: both options, distinct values + labels.
  const filterStart = pageSource.indexOf('<option value="stock_check">');
  assert.ok(filterStart >= 0, "stock_check filter option exists in page.tsx");
  const filterBlock = pageSource.slice(filterStart - 200, filterStart + 300);
  check(
    filterBlock.includes(`<option value="stock_check">{t('task.stockChecks')}</option>`),
    '(e) filter offers stock_check labelled "Stock Checks" (task.stockChecks)',
  );
  check(
    filterBlock.includes(`<option value="expiry_check">{t('task.expiringStockChecks')}</option>`),
    '(e) filter offers expiry_check labelled "Expiring Stock Checks"',
  );

  // --- (f) suggestions still never create stock_check / expiry_check. ---

  const literalCreations = [...pageSource.matchAll(/task_type:\s*"([a-z_]+)"/g)].map(
    (match) => match[1],
  );
  check(
    !literalCreations.includes("stock_check") &&
      !literalCreations.includes("expiry_check"),
    "(f) no literal task creation anywhere sets task_type to stock_check or expiry_check",
  );
  check(
    literalCreations.includes("payment_collection") &&
      literalCreations.includes("expense_review") &&
      literalCreations.includes("reorder"),
    "(f) suggestions still create only payment_collection / expense_review / reorder",
  );

  // --- Translation keys: stockChecks ×4, expiringStockChecks ×4. ---

  const messagesSource = readFileSync(
    new URL("../src/lib/regional/messages.ts", import.meta.url),
    "utf8",
  );
  const stockChecksCount = (messagesSource.match(/'task\.stockChecks'/g) ?? []).length;
  check(
    stockChecksCount === 4,
    "(i18n) 'task.stockChecks' exists in all 4 locale blocks",
  );
  const expiringCount = (messagesSource.match(/'task\.expiringStockChecks'/g) ?? []).length;
  check(
    expiringCount === 4,
    "(i18n) 'task.expiringStockChecks' still exists in all 4 locale blocks",
  );
  check(
    messagesSource.includes("'task.stockChecks': 'Stock Checks'"),
    "(i18n) English label is 'Stock Checks'",
  );

  console.log(`\nAll ${passed} Expiry Check Type checks passed.`);
}

void main();
