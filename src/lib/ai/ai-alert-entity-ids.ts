/**
 * Day-keyed ai_alert entity ids — deterministic UUIDs (P1 Area J).
 *
 * Defect (2026-11-20, live QA): the alert generator
 * (`generateAiBusinessAlerts` in page.tsx) inserts ALL candidates in ONE
 * batch into `ai_alerts`. Two candidates keyed their alert by the raw
 * date string — the expense-day candidate and the no-staff-on-duty
 * candidate both used `source_entity_id: todayDateValue` (e.g.
 * `"2026-11-20"`). But `ai_alerts.source_entity_id` is a UUID column
 * (see `docs/database/DATABASE_INVENTORY.md`, Table 28), so Postgres
 * rejected the whole batch insert — including the four qualifying
 * supplier rows (NATURA €660, BISCONNI €2,394, LAYS €1,672, NESTLE
 * €3,038, all above the €473.79 relative threshold). The failure was
 * completely silent (console-only error, `silent: true`, audit entry
 * only after a successful insert), so no NATURA alert ever appeared
 * even though the threshold rule itself was correct.
 *
 * Fix: derive a deterministic UUID from a namespaced key instead of
 * storing the date string. Deterministic matters twice:
 * - the generator's dedupe matches on (alert_type,
 *   source_entity_type, source_entity_id, title), so the same day must
 *   always map to the same id, or a second run would re-insert a
 *   duplicate;
 * - `staleAiAlertIdsForSave` (ai-alert-sync.ts) matches a stored
 *   expense alert by deriving the same id from the save's day, so the
 *   derivation must be identical on both sides.
 *
 * Scheme: four seeded FNV-1a 32-bit passes over the namespaced key
 * (`ai-alert:<kind>:<day>`), concatenated to 128 bits and formatted
 * 8-4-4-4-12 with the version nibble set to 5 (name-based) and the
 * variant bits to 10xx. It is NOT RFC 4122 v5 — true v5 needs SHA-1,
 * which is not available synchronously in the browser, and the repo
 * has no `uuid` package (do not add one for this). Postgres only
 * requires the 8-4-4-4-12 hex shape for a uuid value, which this
 * satisfies. The key space is tiny (two kinds x one id per day), so
 * hash collisions are not a practical concern, and the tests below pin
 * distinctness for the keys that matter.
 *
 * No legacy rows exist with the raw date string: such a row could
 * never be stored — the same rejection blocked every insert that
 * carried one — so no backfill or migration is needed.
 */

export type DayKeyedAlertEntityKind = "expense_day" | "staff_duty";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** FNV-1a 32-bit hash; the seed selects a different pass. */
function fnv1a32(input: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic UUID for a day-keyed alert (expense-day or staff-duty).
 * Never throws: a blank day falls back to the literal "unknown", so the
 * generator can never fail its batch insert on this input.
 */
export function dayKeyedAlertEntityId(kind: DayKeyedAlertEntityKind, day: string): string {
  const normalizedDay = typeof day === "string" && day.trim() !== "" ? day.trim() : "unknown";
  const key = `ai-alert:${kind}:${normalizedDay}`;
  const hex = (n: number): string => n.toString(16).padStart(8, "0");
  const raw = hex(fnv1a32(key, 0)) + hex(fnv1a32(key, 1)) + hex(fnv1a32(key, 2)) + hex(fnv1a32(key, 3));
  const chars = raw.split("");
  // Version nibble (first char of the third group) = 5 (name-based).
  chars[12] = "5";
  // Variant bits (first char of the fourth group) = 10xx.
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const shaped = chars.join("");
  return (
    `${shaped.slice(0, 8)}-${shaped.slice(8, 12)}-${shaped.slice(12, 16)}-` +
    `${shaped.slice(16, 20)}-${shaped.slice(20)}`
  );
}

/** True iff the value has the 8-4-4-4-12 hex shape Postgres accepts as uuid. */
export function isValidUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
