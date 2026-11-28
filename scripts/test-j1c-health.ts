import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAssistantKpiBlock } from "../src/lib/ai/assistant-kpi-block";
import { calculateBusinessIntelligence, processBusinessIntelligenceQuery } from "../src/lib/ai/business-intelligence";
import { explainKPI, generateExecutiveReport } from "../src/lib/ai/executive-ai";
import { todayInTimezone } from "../src/lib/ai/confirmation-content";
import { MemoryStore } from "../src/lib/brain/memory/business-memory";
import { MemoryWriter } from "../src/lib/brain/memory/memory-writer";
import { PreferenceStore } from "../src/lib/brain/learning/preference-store";
import { execute } from "../src/lib/brain/skills/health-score";
import { getBusinessHealthScore } from "../src/lib/dashboard/health";
import { buildBusinessHealthOverview } from "../src/lib/dashboard/health-overview";
import { buildPayablesReceivablesFixture } from "./fixtures/j1b-payables-receivables";

// Base 50 + sales 10 + profit 20 - stockout 20 + collections 10
// + expenses 5 = 75. Old sales must not change the last-30-days score.
const raw = buildPayablesReceivablesFixture();
const now = new Date();
const today = todayInTimezone(raw.timezone, now);
raw.salesTransactions[0].sale_date = today;
raw.salesTransactions[1].sale_date = "2000-01-01";
for (const payment of raw.customerPayments ?? []) payment.payment_date = today;
raw.salesItems[0].purchase_price_snapshot = 50;
raw.products[0].current_stock = 7;
raw.products.push({ id: 99, name: "Empty shelf", current_stock: 0 });

const overview = buildBusinessHealthOverview(raw, raw.timezone, now);
assert.equal(overview.totalSalesAmount, 500);
assert.equal(overview.estimatedNetProfit, 250);
const boundary = buildBusinessHealthOverview({
  ...raw, salesTransactions: [{ ...raw.salesTransactions[0], sale_date: undefined, created_at: "2026-10-28T22:00:00Z" }],
}, "Asia/Karachi", new Date("2026-11-27T02:00:00Z"));
assert.equal(boundary.totalSalesAmount, 500, "the timestamp is Oct 29 in the organization timezone");
const tile = getBusinessHealthScore(overview);
assert.equal(tile.score, 75);
assert.deepEqual(tile.breakdown, { sales: 10, profit: 20, stock: -20, collections: 10, expenses: 5 });
const browser = buildAssistantKpiBlock({ payables: 0, receivables: 0, customersOwing: 0, inventoryValue: 0, health: overview }, raw.currency, raw.timezone, now);
const server = buildAssistantKpiBlock(raw, raw.currency, raw.timezone, now);
assert.equal(browser?.health.score, 75);
assert.deepEqual(server?.health, browser?.health);
const store = new MemoryStore();
const preferences = new PreferenceStore();
new MemoryWriter(store, preferences).writeRaw(raw);
assert.equal(store.analytics.healthScore.score, 75);
assert.equal(execute({}, { memory: store, preferences, requestId: "fixture", invokedAt: now.toISOString() }).data?.score, 75);
assert.equal(calculateBusinessIntelligence(store, raw).businessHealth.score, 75);
assert.match(processBusinessIntelligenceQuery("health_score", store, raw, "business health").message, /75\/100[\s\S]*Last 30 days/);
assert.equal(generateExecutiveReport(store, raw, "morning", raw.organizationId).summary.healthScore, 75);
assert.equal(explainKPI(store, raw, "health_score", raw.organizationId).value, 75);
const page = readFileSync("src/app/page.tsx", "utf8");
assert.match(page, /const healthOverview = buildBusinessHealthOverview\(\s*\{ products, salesTransactions, salesItems, customerPayments, expenses \}/);
assert.match(page, /const businessHealthScore = getBusinessHealthScore\(healthOverview/);
assert.match(page, /health: healthOverview/);
console.log("J1c whole-org Health parity passed for dashboard, browser/server KPI blocks, BI, Executive and brain skill");
