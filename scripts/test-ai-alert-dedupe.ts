/**
 * ai_alerts dedupe — title is display text, never part of the key
 * (P1 Area J, Fanta duplicate 2026-11-23).
 *
 * Defect (proven by production SQL): the old Fanta alert row's title is
 * 29 chars, the new row's 28 — one extra invisible character (trailing
 * whitespace) — so the generator's exact-match dedupe on
 * (alert_type, source_entity_type, source_entity_id, title) missed it
 * and inserted a second ACTIVE alert for the same product. RLS is
 * org-gated only (single policy ai_alerts_org_access), not the cause.
 *
 * Second hole, same duplicate: the dedupe read was `fetchAiAlerts`,
 * the UI fetch capped at the 100 newest rows (`.limit(100)`, newest
 * first). An active alert older than the newest 100 rows is invisible
 * to that read, so the generator treats its entity as new and
 * re-inserts it.
 *
 * Fix: the dedupe key is now (alert_type, source_entity_type,
 * source_entity_id) — see `src/lib/ai/ai-alert-dedupe.ts` — and the
 * dedupe read is a dedicated key-only query with NO limit
 * (`fetchActiveAiAlertKeys` in page.tsx). A product rename must not
 * defeat dedupe, and an old alert must not fall out of the read.
 *
 * The generator itself lives in page.tsx and cannot be imported in
 * tsx, so this test pins the extracted dedupe logic it calls
 * (`filterNewAlertCandidates` / `aiAlertDedupeKey` /
 * `buildActiveAiAlertKeySet`) plus the wiring that page.tsx calls it
 * with the uncapped key read — the same pattern as
 * test-ai-stale-sync.ts. No SQL, no production data: the rows below
 * are fixtures shaped like the two server reads (capped UI read vs
 * key-only read).
 *
 * Run: npx tsx scripts/test-ai-alert-dedupe.ts
 *
 * Stale-state veto (37→36, 2026-11-23): the filter used to take the
 * rendered-state list AND the server keys and union them, so a
 * same-tick invalidate→generate vetoed the fresh candidate from the
 * closed-over state (the NATURA payable alert was resolved by a
 * payment save and never recreated). The filter now takes ONE
 * known-keys set (`filterNewAlertCandidates(candidates, knownKeys)`);
 * the caller picks the server keys, or rendered state only when the
 * server read FAILS (null). The invalidation is one atomic UPDATE,
 * not read-then-write, and a failed dedupe read writes an Audit Log
 * entry. See section (h).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aiAlertDedupeKey,
  buildActiveAiAlertKeySet,
  filterNewAlertCandidates,
  type AiAlertDedupeLike,
} from "../src/lib/ai/ai-alert-dedupe";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

type FixtureRow = AiAlertDedupeLike & { id: string; title: string; created_at: string };
type FixtureCandidate = AiAlertDedupeLike & { title: string };

const FANTA_PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";

// The pre-fix dedupe predicate, replicated here ONLY to prove the bug:
// it matched on title too, so a one-char title drift defeated it.
function oldTitleKeyedWouldInsert(candidate: FixtureCandidate, known: ReadonlyArray<FixtureRow>): boolean {
  return !known.some(
    (alert) =>
      alert.status === "active" &&
      alert.alert_type === candidate.alert_type &&
      alert.source_entity_type === candidate.source_entity_type &&
      alert.source_entity_id === candidate.source_entity_id &&
      alert.title === candidate.title,
  );
}

function main(): void {
  // The production evidence, pinned: old title 29 chars (trailing
  // space), new title 28 chars. The strings below are fixtures with
  // those exact lengths and the generator's shape (status + product
  // name), not the literal production titles.
  const oldFantaTitle = "Urgent Reorder: Fanta Orange ";
  const newFantaTitle = "Urgent Reorder: Fanta Orange";
  check(oldFantaTitle.length === 29, "old Fanta title is 29 chars (trailing space, per production SQL)");
  check(newFantaTitle.length === 28, "new Fanta title is 28 chars");

  const oldFantaRow: FixtureRow = {
    id: "old-fanta-alert",
    alert_type: "inventory",
    title: oldFantaTitle,
    source_entity_type: "product",
    source_entity_id: FANTA_PRODUCT_ID,
    status: "active",
    created_at: "2026-07-23T10:00:00.000Z", // ~4 months old
  };
  const fantaCandidate: FixtureCandidate = {
    alert_type: "inventory",
    title: newFantaTitle, // renamed title (trailing space gone)
    source_entity_type: "product",
    source_entity_id: FANTA_PRODUCT_ID,
    status: "active",
  };

  console.log("(a) a renamed title must not defeat dedupe (Fanta, 29 vs 28 chars)");
  check(
    aiAlertDedupeKey(oldFantaRow) === aiAlertDedupeKey(fantaCandidate),
    "old row and renamed candidate share one dedupe key — title is not in the key",
  );
  check(
    oldTitleKeyedWouldInsert(fantaCandidate, [oldFantaRow]),
    "the OLD title-keyed check would have inserted a duplicate (this is the bug)",
  );
  check(
    filterNewAlertCandidates([fantaCandidate], buildActiveAiAlertKeySet([oldFantaRow])).length === 0,
    "the new filter drops the renamed Fanta candidate — zero new rows, active count stays 1",
  );

  console.log("(b) the dedupe read must be age-independent (>100 newer rows)");
  const fillerRows: FixtureRow[] = Array.from({ length: 150 }, (_, i) => ({
    id: `filler-alert-${i}`,
    alert_type: "inventory",
    title: `Urgent Reorder: Filler Product ${i}`,
    source_entity_type: "product",
    source_entity_id: `00000000-0000-4000-8000-${String(100000 + i).padStart(12, "0")}`,
    status: "active",
    created_at: new Date(Date.UTC(2026, 10, 22, 12, 0, 0) - i * 60_000).toISOString(), // all newer than Fanta
  }));
  const allRows = [oldFantaRow, ...fillerRows];
  // The old capped UI read: newest 100 by created_at — the 4-month-old
  // Fanta row falls out of it.
  const cappedRead = [...allRows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100);
  check(cappedRead.length === 100, "the capped read returns exactly 100 rows");
  check(
    !cappedRead.some((row) => row.source_entity_id === FANTA_PRODUCT_ID),
    "the capped read does NOT contain the 4-month-old Fanta row",
  );
  check(
    oldTitleKeyedWouldInsert(fantaCandidate, cappedRead),
    "with the capped read the old code would insert a duplicate (second hole)",
  );
  // The new key-only read: no limit — every active row's key is present.
  const keyOnlyRead = buildActiveAiAlertKeySet(allRows);
  check(keyOnlyRead.size === 151, "the key-only read holds all 151 active keys (no 100 cap)");
  check(
    keyOnlyRead.has(aiAlertDedupeKey(fantaCandidate)),
    "the key-only read contains the old Fanta row's key",
  );
  check(
    filterNewAlertCandidates([fantaCandidate], keyOnlyRead).length === 0,
    "with the key-only read the renamed Fanta candidate is dropped",
  );

  console.log("(c) genuinely-new candidates still insert");
  const newProductCandidate: FixtureCandidate = {
    alert_type: "inventory",
    title: "Urgent Reorder: Other Product",
    source_entity_type: "product",
    source_entity_id: OTHER_PRODUCT_ID,
    status: "active",
  };
  const newSupplierCandidate: FixtureCandidate = {
    alert_type: "supplier",
    title: "Supplier payable pressure: NEW SUPPLIER",
    source_entity_type: "supplier_ledger",
    source_entity_id: SUPPLIER_ID,
    status: "active",
  };
  const inserted = filterNewAlertCandidates(
    [fantaCandidate, newProductCandidate, newSupplierCandidate],
    buildActiveAiAlertKeySet(allRows),
  );
  check(inserted.length === 2, "two genuinely-new candidates pass the filter");
  check(
    inserted.some((c) => c.source_entity_id === OTHER_PRODUCT_ID),
    "the new product candidate inserts",
  );
  check(
    inserted.some((c) => c.source_entity_id === SUPPLIER_ID),
    "the new supplier candidate inserts",
  );
  check(
    !inserted.some((c) => c.source_entity_id === FANTA_PRODUCT_ID),
    "the Fanta candidate still does not insert alongside them",
  );

  console.log("(d) resolved / archived / new rows never block a fresh alert");
  const resolvedSameKey: FixtureRow = { ...oldFantaRow, id: "resolved-fanta", status: "resolved" };
  const archivedSameKey: FixtureRow = { ...oldFantaRow, id: "archived-fanta", status: "archived" };
  const newStatusSameKey: FixtureRow = { ...oldFantaRow, id: "new-fanta", status: "new" };
  check(
    filterNewAlertCandidates([fantaCandidate], buildActiveAiAlertKeySet([resolvedSameKey])).length === 1,
    "a resolved row for the same entity does not block a fresh alert",
  );
  check(
    filterNewAlertCandidates([fantaCandidate], buildActiveAiAlertKeySet([archivedSameKey])).length === 1,
    "an archived row for the same entity does not block a fresh alert",
  );
  check(
    filterNewAlertCandidates([fantaCandidate], buildActiveAiAlertKeySet([newStatusSameKey])).length === 1,
    "a 'new' row does not block either — only 'active' counts (server query filters status='active')",
  );
  check(
    buildActiveAiAlertKeySet([resolvedSameKey, archivedSameKey, newStatusSameKey]).size === 0,
    "the active-key set is empty when no row is active",
  );

  console.log("(e) the key is the entity, not the kind of alert text");
  const marketCandidateSameProduct: FixtureCandidate = {
    alert_type: "market",
    title: "Market signal: Fanta Orange",
    source_entity_type: "market_intelligence_item",
    source_entity_id: FANTA_PRODUCT_ID,
    status: "active",
  };
  check(
    filterNewAlertCandidates([marketCandidateSameProduct], buildActiveAiAlertKeySet([oldFantaRow])).length === 1,
    "a different alert_type for the same product still inserts",
  );
  check(
    aiAlertDedupeKey({ alert_type: "inventory", source_entity_type: "product", source_entity_id: FANTA_PRODUCT_ID }) ===
      aiAlertDedupeKey({ alert_type: "inventory", source_entity_type: "product", source_entity_id: FANTA_PRODUCT_ID, title: "anything" } as FixtureCandidate),
    "two rows differing ONLY in title produce the same key",
  );
  check(
    aiAlertDedupeKey({ alert_type: "inventory", source_entity_type: "product", source_entity_id: null }) ===
      aiAlertDedupeKey({ alert_type: "inventory", source_entity_type: "product", source_entity_id: "" }),
    "a null entity id normalises the same as an empty one",
  );

  console.log("(f) page.tsx wiring: the generator uses the key helper + the uncapped key read");
  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  check(
    pageSource.includes('import { aiAlertDedupeKey, buildActiveAiAlertKeySet, filterNewAlertCandidates } from "@/lib/ai/ai-alert-dedupe";'),
    "page.tsx imports the dedupe helpers (key, active-key set for the read-failure fallback, filter)",
  );
  const keyReadUses = pageSource.split("fetchActiveAiAlertKeys(currentOrganizationId)").length - 1;
  check(keyReadUses >= 2, `the key-only read is used in both dedupe paths (main + retry), found ${keyReadUses} uses`);
  check(
    !pageSource.includes("alert.title === candidate.title"),
    "no title comparison remains in the dedupe paths",
  );
  check(
    pageSource.includes('aiAlertDedupeKey(item) === aiAlertDedupeKey(candidate)'),
    "the within-run candidate dedupe uses the key, not title",
  );
  check(
    pageSource.includes("filterNewAlertCandidates(uniqueCandidates, knownKeys)"),
    "the main dedupe filters through the helper with ONE known-keys set — no rendered-state argument",
  );
  check(
    pageSource.includes("const knownKeys = serverKeys ?? buildActiveAiAlertKeySet(aiAlerts);"),
    "the caller picks the keys in one place: server keys, or rendered state only when the server read failed",
  );
  check(
    !pageSource.includes("filterNewAlertCandidates(uniqueCandidates, aiAlerts, serverKeys)"),
    "the old three-argument call (state unioned with server keys) is gone",
  );
  check(
    pageSource.includes("Promise<Set<string> | null>"),
    "the key-only read returns null on failure, so 'no active alerts' and 'read failed' stay distinct",
  );
  check(
    pageSource.includes("AI alert dedupe read failed"),
    "a failed dedupe read writes an Audit Log entry, not just console.error",
  );
  check(
    pageSource.includes('storedKeys.has(aiAlertDedupeKey(candidate))'),
    "the retry path skips rows the failed batch already stored, by key",
  );
  check(
    pageSource.includes('.select("alert_type, source_entity_type, source_entity_id")'),
    "the dedupe read selects key columns only",
  );
  const keyReadStart = pageSource.indexOf("const fetchActiveAiAlertKeys");
  const keyReadEnd = pageSource.indexOf("\n  };", keyReadStart);
  const keyReadBody = pageSource.slice(keyReadStart, keyReadEnd);
  check(keyReadBody.length > 0, "the key-only read helper exists in page.tsx");
  check(!keyReadBody.includes(".limit("), "the key-only read has NO limit (age-independent)");
  check(keyReadBody.includes('.eq("status", "active")'), "the key-only read filters status='active' server-side");
  check(keyReadBody.includes("return null"), "the key-only read returns null (not an empty set) on error");
  check(!keyReadBody.includes("setAiAlerts"), "the key-only read does not touch rendered state");
  const uiReadStart = pageSource.indexOf("const fetchAiAlerts");
  const uiReadEnd = pageSource.indexOf("\n  };", uiReadStart);
  const uiReadBody = pageSource.slice(uiReadStart, uiReadEnd);
  check(uiReadBody.includes(".limit(100)"), "the UI read still caps at 100 newest rows (unchanged — only the dedupe read is uncapped)");

  console.log("(h) the stale-state veto must not block regeneration (37→36, 2026-11-23)");
  // Production evidence: the NATURA payable alert was resolved by a
  // €0.01 payment save at 03:21 PKT, but no fresh alert was created —
  // the generator ran in the same tick, and the dedupe unioned the
  // closed-over rendered state (still showing NATURA 'active') with
  // the fresh server keys, so the candidate was vetoed and the
  // generator returned silently with no audit entry. The fix: the
  // filter takes ONE known-keys set, chosen by the caller from the
  // server read alone; rendered state is only the fallback when that
  // read FAILS (null), never a second veto on the success path.
  const NATURA_SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
  const naturaCandidate: FixtureCandidate = {
    alert_type: "payment",
    title: "Supplier payable pressure: NATURA HARVERST",
    source_entity_type: "supplier_ledger",
    source_entity_id: NATURA_SUPPLIER_ID,
    status: "active",
  };
  const staleNaturaRow: FixtureRow = {
    id: "stale-natura-alert",
    alert_type: "payment",
    title: "Supplier payable pressure: NATURA HARVERST",
    source_entity_type: "supplier_ledger",
    source_entity_id: NATURA_SUPPLIER_ID,
    status: "active",
    created_at: "2026-11-22T19:54:58.000Z",
  };
  // The pre-fix dedupe predicate, replicated here ONLY to prove the
  // bug: it unioned rendered state with the server keys.
  function oldUnionWouldDrop(
    candidate: FixtureCandidate,
    knownAlerts: ReadonlyArray<FixtureRow>,
    extraKnownKeys: ReadonlySet<string>,
  ): boolean {
    const knownKeys = new Set<string>([...buildActiveAiAlertKeySet(knownAlerts), ...extraKnownKeys]);
    return knownKeys.has(aiAlertDedupeKey(candidate));
  }
  // The server has already resolved NATURA, so its key set is empty;
  // the rendered state still shows it active (same-tick closure).
  const serverKeysAfterResolve = new Set<string>();
  check(
    oldUnionWouldDrop(naturaCandidate, [staleNaturaRow], serverKeysAfterResolve),
    "the OLD union drops the NATURA candidate when rendered state is stale (this is the bug)",
  );
  check(
    filterNewAlertCandidates([naturaCandidate], serverKeysAfterResolve).length === 1,
    "with server-only keys the resolved NATURA candidate passes — rendered state is never consulted",
  );
  check(
    filterNewAlertCandidates([naturaCandidate], new Set([aiAlertDedupeKey(naturaCandidate)])).length === 0,
    "a key that IS still active on the server still blocks the candidate",
  );
  check(
    filterNewAlertCandidates([naturaCandidate], buildActiveAiAlertKeySet([staleNaturaRow])).length === 0,
    "the state fallback still blocks when the server read failed and state is all the caller has",
  );
  // Case 4 (Claude msg 43/44): a resolved row for the same key must
  // not block a fresh alert on a fresh generator call.
  const resolvedNaturaRow: FixtureRow = { ...staleNaturaRow, id: "resolved-natura", status: "resolved" };
  check(
    filterNewAlertCandidates([naturaCandidate], buildActiveAiAlertKeySet([resolvedNaturaRow])).length === 1,
    "a resolved NATURA row does not block a fresh alert (server read filters status='active')",
  );
  console.log("  (h2) the invalidation is one atomic update, not read-then-write from state");
  check(
    pageSource.includes("staleAiAlertUpdateTarget(save)"),
    "the save hook computes the invalidation target from the save, not from a row list",
  );
  check(
    !pageSource.includes("staleAiAlertIdsForSave(save, freshAlerts)"),
    "the save hook no longer reads rows and then updates by id (a second tab could create one in between)",
  );
  check(
    pageSource.includes('.eq("source_type", target.sourceType)'),
    "the atomic update matches the source type in the WHERE clause",
  );
  check(
    pageSource.includes('.in("source_entity_id", target.entityIds)'),
    "the atomic update matches the entity ids in the WHERE clause",
  );
  check(
    pageSource.includes('.in("status", [...SHOWN_AI_ALERT_STATUSES])'),
    "the atomic update only resolves shown (active/new) alerts",
  );

  console.log("(g) the test is wired into the suite");
  const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  check(
    packageSource.includes('"test:ai-alert-dedupe": "tsx scripts/test-ai-alert-dedupe.ts"'),
    "package.json has the test:ai-alert-dedupe script",
  );
  check(
    packageSource.includes("npm run test:ai-alert-dedupe"),
    "the npm test chain runs test:ai-alert-dedupe",
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main();
