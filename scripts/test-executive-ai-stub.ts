import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateBusinessIntelligence } from "../src/lib/ai/business-intelligence";
import { analyzeProactiveAlerts, explainKPI, prioritizeAIRecommendations } from "../src/lib/ai/executive-ai";
import { getExecutiveAIResponse, getExecutiveDashboardData } from "../src/lib/ai/executive-conversation";
import { MemoryStore } from "../src/lib/brain/memory/business-memory";
import { MemoryWriter } from "../src/lib/brain/memory/memory-writer";
import { PreferenceStore } from "../src/lib/brain/learning/preference-store";
import { buildPayablesReceivablesFixture } from "./fixtures/j1b-payables-receivables";

async function main() {
  const data = buildPayablesReceivablesFixture();
  const outOfStock = { id: 987, name: "Empty shelf product", current_stock: 0, reorder_level: 5 };
  data.products.push(outOfStock);
  const store = new MemoryStore();
  new MemoryWriter(store, new PreferenceStore()).writeRaw(data);
  const organizationId = data.organizationId;
  const real = calculateBusinessIntelligence(store, data);
  assert.ok(Number.isFinite(real.businessHealth.score));
  assert.ok(Number.isFinite(real.salesForecasting.tomorrow));

  // The Executive GET and POST routes delegate to these entry points.
  const dashboard = await getExecutiveDashboardData(organizationId, undefined, "english", "morning", store, data);
  assert.equal(dashboard.success, true);
  assert.equal(dashboard.executiveReport.summary.healthScore, real.businessHealth.score);
  assert.equal(dashboard.executiveReport.summary.revenue, real.salesForecasting.tomorrow);
  assert.equal(dashboard.executiveReport.summary.profit, real.salesForecasting.tomorrow * 0.15);
  assert.ok(dashboard.executiveReport.summary.priorityActions.includes("Immediate inventory procurement needed"));
  const briefing = await getExecutiveAIResponse(organizationId, "Morning briefing", undefined, "english", undefined, undefined, store, data);
  assert.equal(briefing.ok, true);
  assert.equal(briefing.type, "executive_briefing");
  assert.equal(briefing.message, dashboard.executiveReport.detailedReports.morningBriefing);
  assert.ok(briefing.message.includes(`Health Score: ${real.businessHealth.score}`));
  assert.ok(briefing.message.includes("€"));

  const kpi = await getExecutiveAIResponse(organizationId, "Explain the health score", undefined, "english", undefined, undefined, store, data);
  assert.equal(kpi.ok, true);
  assert.equal(kpi.type, "executive_kpi");
  assert.equal(kpi.kpi.value, real.businessHealth.score);
  assert.deepEqual(kpi.kpi, explainKPI(store, data, "health_score", organizationId, "english"));
  const revenue = await getExecutiveAIResponse(organizationId, "", undefined, "english", undefined, { module: "bi", queryType: "revenue" }, store, data);
  assert.equal(revenue.kpi.value, real.salesForecasting.tomorrow);

  // These two exports have no Executive conversation caller.
  const alerts = analyzeProactiveAlerts(store, data, organizationId);
  assert.ok(alerts.some((alert) => alert.category === "inventory_shortage" && alert.description.includes(outOfStock.name)));
  assert.ok(alerts.every((alert) => !alert.description.includes("undefined")));
  const recommendations = prioritizeAIRecommendations(store, data, organizationId);
  assert.ok(recommendations.length > 0);
  assert.ok(recommendations.every((rec) => rec.title && Number.isFinite(rec.potentialImpact.revenueImpact)));
  assert.ok(real.recommendations.some((rec) => recommendations.some((candidate) => candidate.title === rec.title)));

  const route = readFileSync("src/app/api/ai/executive/route.ts", "utf8");
  assert.match(route, /await getExecutiveAIResponse\(/);
  assert.match(route, /await getExecutiveDashboardData\(/);
  console.log("Executive GET report, POST briefing and KPI, proactive alerts and recommendations passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
