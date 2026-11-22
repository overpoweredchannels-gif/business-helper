/**
 * ai_alerts dedupe key — title is display text, never part of the key
 * (P1 Area J, Fanta duplicate 2026-11-23).
 *
 * Defect (proven by production SQL): the old Fanta alert row's title is
 * 29 chars, the new row's 28 — one extra invisible character (trailing
 * whitespace) — so the generator's exact-match dedupe on
 * (alert_type, source_entity_type, source_entity_id, title) missed it
 * and inserted a second active alert for the same product. A product
 * rename must not defeat dedupe either: the title is rendered text,
 * the identity of an alert is its entity.
 *
 * A second, independent hole fed the same duplicate: the dedupe read
 * was `fetchAiAlerts`, the UI fetch capped at the 100 newest rows
 * (`.limit(100)`, newest first). An active alert older than the newest
 * 100 rows is invisible to that read, so the generator treats its
 * entity as new and re-inserts it. The dedupe read must therefore be a
 * dedicated key-only query with NO limit (see `fetchActiveAiAlertKeys`
 * in page.tsx) — this module only defines the key and the pure filter
 * over whatever rows that read returns.
 *
 * Key: (alert_type, source_entity_type, source_entity_id), active rows
 * only. `organization_id` is enforced by the query itself
 * (`.eq("organization_id", orgId)`), so it is not part of the key
 * string. A null entity id / type normalises to "" — no stored row
 * carries an empty-string id, so the two cannot collide.
 */

export interface AiAlertDedupeLike {
  alert_type: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  status?: string | null;
}

/** Dedupe key for one alert row or candidate. Title is deliberately absent. */
export function aiAlertDedupeKey(alert: AiAlertDedupeLike): string {
  return `${alert.alert_type}|${alert.source_entity_type ?? ""}|${alert.source_entity_id ?? ""}`;
}

/** Keys of the ACTIVE rows in a list — resolved/archived rows never block. */
export function buildActiveAiAlertKeySet(alerts: ReadonlyArray<AiAlertDedupeLike>): Set<string> {
  const keys = new Set<string>();
  for (const alert of alerts) {
    if (alert.status === "active") keys.add(aiAlertDedupeKey(alert));
  }
  return keys;
}

/**
 * Candidates with no active alert for the same key. `knownKeys` is ONE
 * set, chosen by the caller — normally the keys from the dedicated
 * key-only server read (`fetchActiveAiAlertKeys` in page.tsx), which
 * is NOT capped at 100 rows and therefore also covers alerts older
 * than the newest 100. The caller falls back to rendered-state keys
 * ONLY when that server read FAILED (null) — never as a second veto
 * on the success path.
 *
 * Why one set (37→36, 2026-11-23): the filter used to take the
 * rendered-state list AND the server keys and union them. A
 * same-tick invalidate→generate runs from the closure of the render
 * that started the save, so the state still showed the just-resolved
 * alert as 'active' and vetoed its fresh candidate — the generator
 * returned silently with no audit entry, and the alert never came
 * back (NATURA payable, resolved 03:21 PKT, never regenerated).
 * A `setAiAlerts` re-read cannot fix the running closure: it only
 * schedules a re-render. So the state must not be an input here at
 * all; the caller decides the single source of truth in one place.
 */
export function filterNewAlertCandidates<T extends AiAlertDedupeLike>(
  candidates: ReadonlyArray<T>,
  knownKeys: ReadonlySet<string>,
): T[] {
  return candidates.filter((candidate) => !knownKeys.has(aiAlertDedupeKey(candidate)));
}
