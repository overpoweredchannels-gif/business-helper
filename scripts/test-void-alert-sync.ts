import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { buildActiveAiAlertKeySet, filterNewAlertCandidates } from "../src/lib/ai/ai-alert-dedupe";
import {
  loadConfirmedVoidPartyId,
  paymentVoidAlertSync,
  shouldRegenerateAiAlertsAfterSave,
  staleAiAlertIdsForSave,
  staleAiAlertUpdateTarget,
} from "../src/lib/ai/ai-alert-sync";
import { getLocalPaymentsBackend, newLocalVoidRow } from "../src/lib/offline/local-payments";
import { drainPendingPayments } from "../src/lib/offline/payment-sync";
import { translate } from "../src/lib/regional/messages";
import { buildPayablesReceivablesFixture } from "./fixtures/j1b-payables-receivables";

// A €500 invoice less a €50 confirmed return and a €0.01 payment leaves
// €449.99. The customer's other €100 invoice makes €549.99. Voiding the
// payment restores €550.00; its still-present allocation covers nothing.
// Order cancels change order status only. Sales-order deletion is draft-only.
// Draft rejection writes a rejected order without creating an invoice.
const raw = buildPayablesReceivablesFixture();
const payment = raw.customerPayments![0];
payment.amount = 0.01;
raw.customerPaymentAllocations![0].amount = 0.01;
const before = buildCustomerLedger(raw).totals.totalOutstanding.toFixed(2);
payment.voided_at = "2026-11-27T12:00:00Z";
const after = buildCustomerLedger(raw).totals.totalOutstanding.toFixed(2);
assert.equal(before, "549.99");
assert.equal(after, "550.00");

interface AlertFixture {
  id: string;
  status: string;
  alert_type: string;
  source_type: string;
  source_entity_id: string;
  source_entity_type: string;
  figure?: string;
}

for (const kind of ["customer", "supplier"] as const) {
  const sourceType = kind === "customer" ? "customer_credit" : "supplier_ledger";
  const makeRow = (id: string, status: string, entityId = "party", source: string = sourceType): AlertFixture => ({
    id, status, alert_type: "payment", source_type: source, source_entity_id: entityId, source_entity_type: kind,
  });
  const current: AlertFixture[] = [
    { ...makeRow("prior", "active"), figure: before },
    makeRow("new", "new"), makeRow("resolved", "resolved"),
    makeRow("other-party", "active", "another"),
    makeRow("other-ledger", "active", "party", kind === "customer" ? "supplier_ledger" : "customer_credit"),
  ];
  const mutation = paymentVoidAlertSync(kind, "party");
  assert.deepEqual(staleAiAlertUpdateTarget(mutation), { sourceType, entityIds: ["party"] });
  const ids = staleAiAlertIdsForSave(mutation, current);
  assert.deepEqual(ids, ["prior", "new"]);
  assert.equal(staleAiAlertUpdateTarget(paymentVoidAlertSync(kind)), null);
  const candidate: AlertFixture = { ...makeRow("fresh", "active"), figure: after };
  assert.deepEqual(filterNewAlertCandidates([candidate], buildActiveAiAlertKeySet([current[0]])), []);
  const resolved = current.slice(0, 3).map((row) => ids.includes(row.id) ? { ...row, status: "resolved" } : row);
  const regenerated = filterNewAlertCandidates([candidate], buildActiveAiAlertKeySet(resolved));
  assert.deepEqual([...resolved, ...regenerated].filter((row) => row.status === "active"), [candidate]);
  assert.equal(resolved.filter((row) => row.status === "active").length, 0);
}

const auditWords = {
  en: ["void", "save", "AI alerts invalidated after {kind} save ({count})."],
  es: ["anular", "guardar", "Alertas de IA invalidadas después de guardar {kind} ({count})."],
  it: ["annullamento", "salvataggio", "Avvisi IA invalidati dopo il salvataggio di {kind} ({count})."],
  ur: ["منسوخ", "سیو", "{kind} سیو کے بعد AI الرٹس ختم کر دیے گئے ({count})۔"],
} as const;
for (const language of ["en", "es", "it", "ur"] as const) {
  const [voidWord, saveWord, saveLabel] = auditWords[language];
  const label = translate(language, "page.aiAlertsInvalidatedAfterVoid");
  assert.ok(label.includes(voidWord) && !label.includes(saveWord));
  assert.ok(label.includes("{kind}") && label.includes("{count}"));
  assert.equal(translate(language, "page.aiAlertsInvalidatedAfterSave"), saveLabel);
}
assert.equal(shouldRegenerateAiAlertsAfterSave("staff"), false);
assert.equal(shouldRegenerateAiAlertsAfterSave("owner"), true);
assert.equal(shouldRegenerateAiAlertsAfterSave("admin"), true);

const page = readFileSync("src/app/page.tsx", "utf8");
const online = page.slice(page.indexOf("const applyVoidPayment"), page.indexOf("const handleCheckBalances"));
assert.equal(online.match(/refreshAiAlertsAfterConfirmedVoid\(kind, confirmed\.payment_id, confirmed\.party_id\)/g)?.length, 2);
assert.equal(online.split("await refreshAfterVoid(true)").slice(0, -1).every((part) => part.includes("confirmed.party_id")), true);
assert.doesNotMatch(online.slice(0, online.indexOf("const confirmed = await voidPaymentAtomic")), /refreshAiAlertsAfterConfirmedVoid/);
const hook = page.slice(page.indexOf("const refreshAiAlertsAfterSave"), page.indexOf("// AI Insight cross-tab sync:"));
assert.ok(hook.indexOf('.update({ status: "resolved"') < hook.indexOf("await (confirmedVoid"));
assert.match(hook, /shouldRegenerateAiAlertsAfterSave\(currentProfile\?\.role/);
assert.match(hook, /void \(async \(\) => \{/);
assert.match(hook, /catch \(err\)[\s\S]*?console\.error\(confirmedVoid/);
assert.match(hook, /await loadConfirmedVoidPartyId[\s\S]*return paymentVoidAlertSync\(kind, partyId\)/);
assert.match(page, /onPaymentsDrained:[\s\S]*?action === "void" && kind && serverId[\s\S]*?refreshAiAlertsAfterConfirmedVoid\(kind, serverId\)/);
assert.match(page, /retrySyncIssue\(supabase, scope, issue\.id, \(row, serverId\)[\s\S]*?row\.action === "void"[\s\S]*?refreshAiAlertsAfterConfirmedVoid\(kind, serverId\)/);
assert.match(page, /await loadRawBusinessData[\s\S]*?liveLedger\?\.assistantKpiReady/);
assert.match(page, /if \(serverKeys === null\)[\s\S]*?if \(options\?\.confirmedVoid\) throw[\s\S]*?filterNewAlertCandidates/);
for (const [kind, count] of Object.entries({
  sale: 2, purchase: 1, customer_payment: 1, supplier_payment: 1, sales_return: 2, purchase_return: 2, expense: 1,
})) {
  assert.equal(page.split(`refreshAiAlertsAfterSave({ kind: "${kind}"`).length - 1, count);
}
assert.match(page, /handleCancelPurchaseOrder[\s\S]*?po\.status === "received"[\s\S]*?\.from\("purchase_orders"\)\s*\.update\(\{ status: "cancelled"/);
assert.match(page, /const applySalesOrderStatus[\s\S]*?\.from\("sales_orders"\)\s*\.update\(\{ status: nextStatus/);
assert.match(page, /const handleDeleteSalesOrder[\s\S]*?order\.status !== "draft"/);
const reject = readFileSync("src/lib/sales/services/draft-sale-service.ts", "utf8").split("async rejectDraft(")[1];
assert.match(reject, /\.from\("sales_orders"\)\s*\.update\(\{\s*status: "rejected"/);

async function testDrain() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    dispatchEvent: () => true,
  } });
  const filters: string[][] = [];
  const query = {
    select(column: string) { filters.push(["select", column]); return this; },
    eq(column: string, value: string) { filters.push([column, value]); return this; },
    not(column: string, operator: string, value: null) { filters.push([column, operator, String(value)]); return this; },
    async maybeSingle() { return { data: { supplier_id: "resolved-party" }, error: null }; },
  };
  const supabase = { from(table: string) { filters.push(["table", table]); return query; } } as unknown as SupabaseClient;
  const scope = "org:profile";
  const row = newLocalVoidRow({ kind: "supplier", paymentId: "payment-nine", reason: null });
  await getLocalPaymentsBackend().upsert(scope, row);
  const drained = await drainPendingPayments(supabase, scope, { server: {
    checkStatus: async () => ({ status: "unknown" }),
    submit: async () => { throw new Error("Unexpected payment insert"); },
    submitVoid: async () => ({
      payment_id: "payment-nine", kind: "supplier", party_id: "resolved-party", amount: 0.01,
      voided: true, replayed: false, restored_balance: 550, restored_from: "ledger",
    }),
  } });
  assert.equal(drained.confirmedCount, 1);
  const [confirmed] = drained.confirmed;
  assert.deepEqual(confirmed, { action: "void", kind: "supplier", serverId: "payment-nine", localId: row.id });
  const party = await loadConfirmedVoidPartyId(supabase, "org", "supplier", confirmed.serverId!);
  assert.deepEqual(filters, [["table", "supplier_payments"], ["select", "supplier_id"], ["organization_id", "org"], ["id", "payment-nine"], ["voided_at", "is", "null"]]);
  assert.deepEqual(staleAiAlertUpdateTarget(paymentVoidAlertSync("supplier", party)), {
    sourceType: "supplier_ledger", entityIds: ["resolved-party"],
  });
  assert.deepEqual(await getLocalPaymentsBackend().list(scope), []);
}

void testDrain().then(() => console.log("Payment void alert sync checks passed")).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
