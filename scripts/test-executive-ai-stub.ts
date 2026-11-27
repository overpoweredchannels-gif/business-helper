import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "../src/components/ai/MarkdownRenderer";
import { buildAssistantKpiBlock, buildDefaultAssistantKpiInputs } from "../src/lib/ai/assistant-kpi-block";
import { calculateBusinessIntelligence } from "../src/lib/ai/business-intelligence";
import { analyzeProactiveAlerts, executiveQuestionType, explainKPI, formatExecutiveOverview, prioritizeAIRecommendations } from "../src/lib/ai/executive-ai";
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
  const actuals = buildDefaultAssistantKpiInputs(data);
  const tile = buildAssistantKpiBlock(data, data.currency, data.timezone)!;
  assert.ok(Number.isFinite(real.businessHealth.score));
  assert.ok(Number.isFinite(real.salesForecasting.tomorrow));

  // The Executive GET and POST routes delegate to these entry points.
  const dashboard = await getExecutiveDashboardData(organizationId, undefined, "english", "morning", store, data);
  assert.equal(dashboard.success, true);
  assert.equal(dashboard.executiveReport.summary.healthScore, tile.health.score);
  assert.equal(dashboard.executiveReport.summary.revenue, actuals.health.totalSalesAmount);
  assert.equal(dashboard.executiveReport.summary.profit, actuals.health.estimatedNetProfit);
  assert.equal(dashboard.executiveReport.summary.cashFlow, tile.receivables - tile.payables);
  assert.ok(dashboard.executiveReport.summary.priorityActions.includes("Immediate inventory procurement needed"));
  const briefing = await getExecutiveAIResponse(organizationId, "Morning briefing", undefined, "english", undefined, undefined, store, data);
  assert.equal(briefing.ok, true);
  assert.equal(briefing.type, "executive_briefing");
  assert.equal(briefing.message, dashboard.executiveReport.detailedReports.morningBriefing);
  assert.ok(briefing.message.includes(`Health Score:** ${tile.health.score}`));
  assert.match(briefing.message, /BI Last 30 Days/);
  assert.doesNotMatch(briefing.message, /expected sales|forecast/i);
  assert.ok(briefing.message.includes("€"));

  const kpi = await getExecutiveAIResponse(organizationId, "Explain the health score", undefined, "english", undefined, undefined, store, data);
  assert.equal(kpi.ok, true);
  assert.equal(kpi.type, "executive_kpi");
  assert.equal(kpi.kpi.value, tile.health.score);
  assert.match(kpi.kpi.explanation, /starts at 50; sales [+-]\d+, profit [+-]\d+, stock [+-]\d+, collections [+-]\d+, expenses [+-]\d+/);
  assert.deepEqual(kpi.kpi, explainKPI(store, data, "health_score", organizationId, "english"));
  const revenue = await getExecutiveAIResponse(organizationId, "", undefined, "english", undefined, { module: "bi", queryType: "revenue" }, store, data);
  assert.equal(revenue.kpi.value, actuals.health.totalSalesAmount);
  const cash = explainKPI(store, data, "cash_flow", organizationId);
  assert.equal(cash.value, tile.cashFlow);
  assert.equal(executiveQuestionType("Please give me the executive report for OP TRADERS"), "report");
  assert.equal(executiveQuestionType("Sell one Aylo to Walk-in"), null);
  const chatRoute = readFileSync("src/app/api/business-brain/route.ts", "utf8");
  assert.ok(chatRoute.indexOf("const executive = executiveQuestionType(message)") < chatRoute.indexOf("await liveEntityContext"));
  const fixedReport = formatExecutiveOverview(data, new Date("2026-11-27T12:00:00Z"));
  assert.match(fixedReport, /2026-10-29 to 2026-11-27/);
  assert.match(fixedReport, /Estimated Net Profit.*known line costs/);
  assert.match(formatExecutiveOverview({ ...data, assistantKpiReady: false }), /unavailable/);
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: "- **Business Health Score:** 75\n• **Cash Flow:** €187.72" }));
  assert.match(html, /<strong>Business Health Score:<\/strong>/);
  assert.match(html, /<strong>Cash Flow:<\/strong>/);

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
