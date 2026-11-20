// Create-sale confirmation content (Area J, 2026-11-20).
//
// Live defect (Business Query run #4, 2026-11-19 11:42): the confirmation
// text read "Customer: {customer_name} • Product: {product_name} ...
// Invoice Date: 2024-05-22 • Batch: no batch • Expiry: no expiry" even
// though the user had given "COCA COLA 1L" + "Walk-in customer" first.
//
// Three distinct failures, all fixed at the conversation layer (never in
// the LLM prompt, so no model can reintroduce them):
//   1. The renderer only substituted schema field keys, but the template
//      uses {customer_name} / {product_name} — names, not ids.
//   2. "today" was extracted by the LLM, which invented a stale date
//      (2024-05-22). It is now resolved server-side from now() in the
//      ORG timezone (organizations.regional_preferences.timeZone).
//   3. Skip phrases ("no batch", "none", "nahi", ...) were stored raw.
//      They now normalize to NULL, and NULL on an OPTIONAL field counts
//      as "answered with nothing" (see getNextRequiredField /
//      getMissingRequiredFields) so the flow does not re-ask forever.
//      The renderer shows skipped optionals as "—", never a literal
//      "{...}" placeholder (fail-safe sweep in formatConfirmationSummary).
//
// Pure helpers — no store, no network — so the slice test can pin them
// with fixed instants (including instants where the UTC day differs
// from the org-timezone day).

/** Answers that mean "leave this optional field empty". Matched on the
 *  trimmed, lower-cased message. The six phrases are UMAIR's list
 *  (2026-11-19); "no notes" is the same class from the live 7-message
 *  sequence ("no notes" was the notes answer). Bare "no" is deliberately
 *  NOT here: it is also a negative answer to "Did you mean ...?" prompts.
 */
export const SKIP_PHRASES: ReadonlySet<string> = new Set([
  "no batch",
  "no expiry",
  "no notes",
  "none",
  "skip",
  "nahi",
  "koi nahi",
]);

export function isSkipPhrase(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return SKIP_PHRASES.has(value.trim().toLowerCase());
}

/** A skip phrase (or blank) becomes NULL; anything else passes through
 *  unchanged. Use at every point a conversational answer is stored, so
 *  no downstream writer can ever persist the raw phrase.
 */
export function normalizeSkipPhrase(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && (value.trim() === "" || isSkipPhrase(value))) return null;
  return value;
}

/** Words that mean "today" in the languages the classifier accepts. */
const TODAY_WORDS: ReadonlySet<string> = new Set(["today", "aaj", "aj"]);

export function isTodayWord(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return TODAY_WORDS.has(value.trim().toLowerCase());
}

const FALLBACK_TIMEZONE = "Asia/Karachi";

/**
 * The calendar day of `now` in the given IANA timezone, as YYYY-MM-DD.
 * Server-side only: the caller passes now() — never a date the LLM
 * produced. An invalid zone falls back to Asia/Karachi (the org
 * default) rather than throwing, so a corrupt stored preference can
 * never break the confirmation flow.
 */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(now);
  } catch {
    zone = FALLBACK_TIMEZONE;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
