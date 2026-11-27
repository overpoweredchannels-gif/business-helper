import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAssistantKpiBlock } from "../src/lib/ai/assistant-kpi-block";
import { aiAlertDedupeKey } from "../src/lib/ai/ai-alert-dedupe";
import { callAiProviderRouter } from "../src/lib/ai/provider-router";
import { buildBusinessQueryDirectPrompt } from "../src/lib/ai/business-query-direct";
import { ContextRetriever } from "../src/lib/brain/context/context-retriever";
import { MemoryStore } from "../src/lib/brain/memory/business-memory";
import { getBusinessHealthScore } from "../src/lib/dashboard/health";
import { computeInventoryValuation } from "../src/lib/inventory/valuation";
import { BELL_NOTIFICATION_LIMIT, getVisibleNotifications } from "../src/lib/notifications/visible-notifications";
import { netPurchaseInvoiceAllocation, payableBySupplierId } from "../src/lib/purchases/returns-offset";
import { messages } from "../src/lib/regional/messages";
import { computeCreditAllocationsByTransaction, summarizeCustomerCredit } from "../src/lib/sales/returns-offset";
import type { AiAlert, NotificationItem } from "../src/lib/tradeos/types";
import { buildMixedCashRuleFixture, buildPayablesReceivablesFixture } from "./fixtures/j1b-payables-receivables";

// J1b inputs: A1 = 1000 - 50 - 400 - 100 = 450, B1 cash = 0,
// D2 = 400 - 150 - 50 = 200. S1 = 500 - 50 - 200 = 250,
// S2 = 100. Inventory is 7 x 100, and Health is
// 50 + 10 sales + 20 profit - 20 stockout + 10 collections + 5 expenses.
const now = new Date("2026-11-24T22:30:00Z");
const raw = buildPayablesReceivablesFixture();
const mixed = buildMixedCashRuleFixture();
raw.suppliers.push(...mixed.suppliers);
raw.purchaseTransactions.push(...mixed.purchaseTransactions);
raw.purchaseItems.push(...mixed.purchaseItems);
raw.supplierPayments!.push(...mixed.supplierPayments!);
raw.purchaseReturns!.push(...mixed.purchaseReturns!);
raw.purchaseReturnItems!.push(...mixed.purchaseReturnItems!);
raw.supplierPaymentAllocations!.push(...mixed.supplierPaymentAllocations!);
raw.products[0].current_stock = 7;
raw.products.push({ id: 2, name: "Empty shelf", current_stock: 0 });
raw.salesItems[0].purchase_price_snapshot = 50;

const supplierBalance = (total: number, returns: number, explicit: number, pool: number, paymentType: string) =>
  netPurchaseInvoiceAllocation({
    purchaseTotal: total, returnedAmount: returns, explicitAllocatedAmount: explicit,
    legacyPoolAvailable: pool, paymentType,
  }).remainingPayableAmount;
const supplierRows = [
  { supplierId: "sup-a", remainingPayable: supplierBalance(1000, 50, 400, 100, "credit") },
  { supplierId: "sup-b", remainingPayable: supplierBalance(500, 0, 0, 0, "cash") },
  { supplierId: "sup-d", remainingPayable: supplierBalance(400, 0, 150, 50, "credit") },
];
const payables = Object.values(payableBySupplierId(supplierRows)).reduce((sum, value) => sum + value, 0);
const allocation = computeCreditAllocationsByTransaction([
  { id: "st-s1", customerId: "cus-c1", invoiceTotal: 500, returnedAmount: 50, explicitAllocatedAmount: 200, sortDate: "2026-11-10", createdAt: raw.salesTransactions[0].created_at },
  { id: "st-s2", customerId: "cus-c1", invoiceTotal: 100, returnedAmount: 0, explicitAllocatedAmount: 0, sortDate: "2026-10-01", createdAt: raw.salesTransactions[1].created_at },
], { "cus-c1": 0 });
const receivables = summarizeCustomerCredit(Object.values(allocation)).outstanding;
const inventoryValue = computeInventoryValuation([{ productId: 1, currentStock: 7, lastPurchasePrice: 100 }]).totalValue;
const health = {
  totalSalesAmount: 500, estimatedNetProfit: 250, outOfStockCount: 1,
  lowStockCount: 0, customerCollectionsTotal: 500, expensesTotal: 0,
};
const server = buildAssistantKpiBlock(raw, raw.currency, raw.timezone, now);
const dashboard = buildAssistantKpiBlock({ payables, receivables, customersOwing: 1, inventoryValue, health }, raw.currency, raw.timezone, now);
assert.ok(server && dashboard);
assert.deepEqual(server, dashboard);
assert.equal(server.payables, 650);
assert.equal(server.receivables, 350);
assert.equal(server.inventoryValue, 700);
assert.equal(server.health.score, getBusinessHealthScore(health).score);
assert.deepEqual(server.health, { score: 75, label: "Good" });
assert.equal(server.customersOwing, 1);
assert.equal(server.computedAt, "2026-11-25 03:30:00 Asia/Karachi");
assert.match(server.text, /Outstanding Payables: €650\.00\nOutstanding Receivables: €350\.00/);
assert.match(server.text, /Inventory Value: €700\.00\nHealth: 75\/100 \(Good\)\nBooks currency: EUR/);
assert.doesNotMatch(server.text, /cash balance|net cash movement|\b(?:PKR|Rs)\b/i);
assert.match(buildAssistantKpiBlock(raw, "XYZ", raw.timezone, now)!.text, /Outstanding Payables: XYZ 650/);
assert.match(buildAssistantKpiBlock(raw, null, raw.timezone, now)!.text, /Outstanding Payables: 650\n/);
assert.equal(buildAssistantKpiBlock(null, "EUR", raw.timezone, now), null);
assert.equal(buildAssistantKpiBlock({ ...raw, assistantKpiReady: false }, "EUR", raw.timezone, now), null);
const store = new MemoryStore();
assert.equal(new ContextRetriever(store).getBusinessContext(), "(No business data loaded)");
store.meta.organizationId = raw.organizationId;
assert.ok(new ContextRetriever(store).getBusinessContext(server).includes(server.text));
assert.ok(buildBusinessQueryDirectPrompt({ question: "Balances?", language: "auto", businessContext: server.text, history: "" }).includes(server.text));
const page = readFileSync("src/app/page.tsx", "utf8");
const runtime = readFileSync("src/lib/ai/conversation-runtime.ts", "utf8");
const queryRoute = readFileSync("src/app/api/ai-business-query/route.ts", "utf8");
assert.match(page, /getBusinessContext\(buildCurrentAssistantKpiBlock\(\)\)/);
assert.match(page, /balances: \{\s*assistant_kpis: buildCurrentAssistantKpiBlock\(\)/);
assert.match(runtime, /return \[kpis\?\.text, summary\]/);
assert.match(queryRoute, /businessSummary\.balances\?\.assistant_kpis\?\.text/);
assert.match(queryRoute, /kpiText, keyPoints\.join/);

const note = { id: "newer", category: "draft_sale", title: "Draft", is_read: false, created_at: "2026-11-24T15:00:00Z" } as NotificationItem;
const alert = { id: "payables", status: "active", severity: "high", title: "Supplier payable", created_at: "2026-11-24T09:00:00Z" } as AiAlert;
// Sources are grouped: real rows by newest first, then alerts by severity
// and recency, and finally the synthetic inventory rollup.
const input = {
  realNotifications: [{ ...note, id: "older", created_at: "2026-11-24T08:00:00Z", is_read: true }, note],
  aiAlerts: [{ ...alert, id: "staff", severity: "medium", created_at: note.created_at }, alert],
  lowStock: { productIds: ["2", "1"], title: "Stock", description: "Two products" },
};
const list = getVisibleNotifications(input);
assert.equal(JSON.stringify(list), JSON.stringify(getVisibleNotifications(input)));
assert.deepEqual(list.map((item) => item.id), [
  "notification:newer", "notification:older", "ai_alert:payables", "ai_alert:staff", 'derived_low_stock:["1","2"]',
]);
assert.equal(list.filter((item) => !item.is_read).length, 4);
assert.equal(list.slice(0, BELL_NOTIFICATION_LIMIT).length, list.length);
assert.match(page, /notificationCount=\{unreadNotificationCount\}/);
assert.match(page, /visibleNotifications\.slice\(0, BELL_NOTIFICATION_LIMIT\)/);
assert.match(page, /<NotificationCenter\s+notifications=\{visibleNotifications\}\s+unreadCount=\{unreadNotificationCount\}/);
assert.equal(getVisibleNotifications({ ...input, readDerivedIds: new Set(["ai_alert:payables"]) })[2].is_read, true);

for (const [language, word] of [["en", "outstanding"], ["es", "pendiente"], ["it", "residuo"], ["ur", "بقایا"]] as const) {
  const labels = messages[language];
  const supplier = labels["page.currentPayableMsg"].replace("{supplier}", "Supplier A").replace("{amount}", "€650.00");
  const customer = labels["page.overdueSummary"].replace("{customer}", "Customer One").replace("{amount}", "€350.00");
  assert.ok(supplier.includes("Supplier A") && supplier.includes(word));
  assert.ok(customer.includes("Customer One") && customer.includes(word));
}
const key = { alert_type: "payment", source_entity_type: "supplier", source_entity_id: "supplier-a" };
const rewritten = { ...key, title: "Supplier A", summary: "Supplier A has an outstanding payable" };
assert.equal(aiAlertDedupeKey(key), aiAlertDedupeKey(rewritten));

async function providerFailures() {
  const env = { ...process.env };
  const fetchBefore = globalThis.fetch;
  try {
    process.env.AI_PROVIDER_ORDER = "groq";
    delete process.env.GROQ_API_KEY;
    const request = { task: "j2_test", prompt: "Fixture" };
    const unconfigured = await callAiProviderRouter(request);
    assert.match(unconfigured.error ?? "", /No configured AI providers/);
    assert.equal(unconfigured.attempts.length, 0);

    process.env.AI_PROVIDER_ORDER = "openai";
    process.env.OPENAI_PRIMARY_MODEL = "gpt-5.6-luna";
    delete process.env.EXPLABS_API_KEY;
    const early = await callAiProviderRouter(request);
    assert.match(early.error ?? "", /EXPLABS_API_KEY is required/);
    assert.equal(early.attempts.length, 0);

    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.GROQ_API_KEY = "fixture";
    globalThis.fetch = async () => new Response('{"error":{"message":"Fixture failure"}}', { status: 503 });
    const attempted = await callAiProviderRouter(request);
    assert.match(attempted.error ?? "", /temporarily unavailable/);
    assert.ok(attempted.attempts.length > 0);
    assert.ok(attempted.attempts.every((result) => result.status === 503));
    for (const route of [queryRoute, readFileSync("src/app/api/market-intelligence/analyze/route.ts", "utf8")]) {
      assert.match(route, /error: routerResult\.error \?\?/);
      assert.match(route, /attempts: routerResult\.attempts/);
    }
  } finally {
    process.env = env;
    globalThis.fetch = fetchBefore;
  }
}

void providerFailures().then(() => console.log("J2: KPI parity, all context seams, notification ordering, localized alerts, and provider errors passed."))
  .catch((error) => { console.error(error); process.exitCode = 1; });
