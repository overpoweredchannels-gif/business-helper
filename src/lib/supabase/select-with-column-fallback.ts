/**
 * Tolerant select for reads whose column list spans additive migrations.
 *
 * Several organization settings columns arrive with additive migrations
 * that may not have run yet on a given database (staff_sales_mode,
 * drawer_no_sale_staff_allowed, books_currency — and, on older databases,
 * regional_preferences). Selecting a column that does not exist fails the
 * WHOLE query with Postgres 42703, which turns "one new setting is not
 * there yet" into "settings do not load at all" (production incident,
 * 2026-10-23: the hand-written fallback chain's deepest level still
 * selected regional_preferences, so a pre-migration database fell through
 * every retry and the Business Settings banner showed the raw 42703).
 *
 * This helper is the single implementation of the established pattern
 * (cf. the EUR route's 42703 guards): run the widest select; while the
 * failure is an undefined-column error naming a column we can drop, drop
 * exactly that column and retry, never dropping below the caller's floor
 * list. The floor is the column list that predates every optional column,
 * so a fully pre-migration database loads EXACTLY as it did before any of
 * the optional columns existed. A database that HAS the columns succeeds
 * on the first attempt — behaviour there is unchanged.
 *
 * Non-column errors (RLS, network, …) are returned untouched on the first
 * attempt: they are never retried and never swallowed.
 */

export interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface ColumnFallbackOutcome<T> {
  data: T | null;
  error: PostgrestLikeError | null;
  /** The column list the returned outcome was produced with. */
  columns: string[];
}

/** True when the error is Postgres/PostgREST saying a column is absent. */
export function isUndefinedColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  return /column\b.*\bdoes not exist/i.test(message) || /could not find the '\w+' column/i.test(message);
}

/**
 * The column an undefined-column error names, or null when the error is
 * not an undefined-column error — or names a column in a phrasing we do
 * not recognise (callers then fall back to the floor list wholesale).
 */
export function undefinedColumnName(error: PostgrestLikeError | null | undefined): string | null {
  if (!isUndefinedColumnError(error)) return null;
  const message = error?.message ?? "";
  const postgresMatch = /column\s+(?:\w+\.)?"?(\w+)"?\s+does not exist/i.exec(message);
  if (postgresMatch) return postgresMatch[1];
  const schemaCacheMatch = /could not find the '(\w+)' column/i.exec(message);
  if (schemaCacheMatch) return schemaCacheMatch[1];
  return null;
}

export interface ColumnFallbackSelectOptions<T> {
  /** Widest column list, in select order. Attempted first, verbatim. */
  columns: string[];
  /**
   * The floor: the smallest column list that must still be attempted.
   * Must be a subset of `columns`. Floor columns are never dropped — if
   * the floor itself fails, that error is the result.
   */
  floor: string[];
  /** Runs one select with the given column list. PromiseLike, so a
   * supabase-js PostgrestBuilder can be returned directly. */
  run: (columns: string[]) => PromiseLike<{ data: T | null; error: PostgrestLikeError | null }>;
}

export async function selectWithColumnFallback<T>(
  options: ColumnFallbackSelectOptions<T>,
): Promise<ColumnFallbackOutcome<T>> {
  const floorSet = new Set(options.floor);
  let current = [...options.columns];
  // Each iteration either returns or strictly shrinks the non-floor part
  // of the list (or jumps straight to the floor), so this always ends.
  for (let attempt = 0; attempt <= options.columns.length + 1; attempt += 1) {
    const outcome = await options.run(current);
    if (!outcome.error) {
      return { data: outcome.data, error: null, columns: current };
    }
    if (!isUndefinedColumnError(outcome.error)) {
      return { data: outcome.data, error: outcome.error, columns: current };
    }
    const missing = undefinedColumnName(outcome.error);
    if (missing && floorSet.has(missing)) {
      // The missing column is one we may never drop: nothing below this
      // list can fix the query, so surface the error as-is.
      return { data: outcome.data, error: outcome.error, columns: current };
    }
    if (missing && current.includes(missing)) {
      current = current.filter((column) => column !== missing);
      continue;
    }
    // Undefined-column error we cannot attribute to a selected column
    // (or naming one we do not select): one wholesale jump to the floor.
    const atFloor =
      current.length === options.floor.length && current.every((column) => floorSet.has(column));
    if (atFloor) {
      return { data: outcome.data, error: outcome.error, columns: current };
    }
    current = [...options.floor];
  }
  // Defensive: the loop's shrink argument makes this unreachable, but a
  // caller must never be left without an outcome.
  const finalOutcome = await options.run(current);
  return { data: finalOutcome.data, error: finalOutcome.error, columns: current };
}
