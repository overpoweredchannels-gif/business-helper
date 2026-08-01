import { MemoryStore } from "../memory/business-memory";
import { MemoryWriter } from "../memory/memory-writer";
import { PreferenceStore } from "../learning/preference-store";
import { executeSkill } from "../skills/skill-registry";
import { runSuite, test, assert, assertEqual, assertApprox } from "./helpers";
import { createMockRawData } from "./fixtures";

function bootstrap(products = 5, customers = 3, suppliers = 2, txns = 10) {
  const store = new MemoryStore();
  const prefs = new PreferenceStore();
  const writer = new MemoryWriter(store, prefs);
  writer.writeRaw(createMockRawData(products, customers, suppliers, txns));
  return { store, prefs };
}

export function validateSkills() {
  const { store, prefs } = bootstrap(10, 5, 3, 20);

  function exec(skillId: string, input: Record<string, unknown> = {}) {
    return executeSkill(skillId, input, store, prefs);
  }

  return runSuite("Business Skills Validation", [

    // ─── SK001: Health Score ───
    test("Health Score - executes with data", async () => {
      const result = exec("health_score");
      assert(result.success, "Health Score succeeded");
      assert(result.data !== null, "Data returned");
      const hs = result.data as any;
      assert(typeof hs.score === "number", "Score is number");
      assert(hs.score >= 0 && hs.score <= 100, "Score in 0-100 range");
      assert(["Critical", "Needs Attention", "Average", "Good", "Excellent"].includes(hs.label), "Valid label");
      assert(hs.breakdown.revenueHealth !== undefined, "Revenue health in breakdown");
      assert(hs.contributingFactors.length > 0, "Contributing factors present");
      assert(typeof hs.trend === "string", "Trend present");
    }),

    test("Health Score - reports correct trend", async () => {
      const result = exec("health_score");
      const hs = result.data as any;
      assert(["improving", "declining", "stable"].includes(hs.trend), "Trend is valid");
    }),

    test("Health Score - empty dataset returns fallback", async () => {
      const emptyStore = new MemoryStore();
      const emptyPrefs = new PreferenceStore();
      const result = executeSkill("health_score", {}, emptyStore, emptyPrefs);
      assert(result.success, "Empty dataset still succeeds");
      const hs = result.data as any;
      assertEqual(hs.score, 50, "Fallback score is 50");
    }),

    // ─── SK002: Analytics ───
    test("Analytics - executes with data", async () => {
      const result = exec("analytics");
      assert(result.success, "Analytics succeeded");
      const ar = result.data as any;
      assert(ar.overview !== undefined, "Overview present");
      assert(ar.overview.totalRevenue >= 0, "Revenue calculated");
      assert(ar.overview.invoiceCount > 0, "Invoice count > 0");
      assert(ar.overview.profitMargin !== null, "Profit margin present");
    }),

    test("Analytics - period breakdowns present", async () => {
      const result = exec("analytics");
      const ar = result.data as any;
      assert(ar.periods.today !== undefined, "Today period");
      assert(ar.periods.this_month !== undefined, "This month period");
      assert(ar.periods.last_30_days !== undefined, "Last 30 days period");
    }),

    test("Analytics - top products identified", async () => {
      const result = exec("analytics");
      const ar = result.data as any;
      assert(Array.isArray(ar.topProducts), "Top products is array");
    }),

    // ─── SK003: KPI ───
    test("KPI - executes with data", async () => {
      const result = exec("kpi");
      assert(result.success, "KPI succeeded");
      const kr = result.data as any;
      assert(Array.isArray(kr.kpis), "KPIs is array");
      assert(kr.kpis.length > 0, "At least one KPI");
      assert(kr.categories !== undefined, "Categories present");
    }),

    test("KPI - contains essential metrics", async () => {
      const result = exec("kpi");
      const kr = result.data as any;
      const keys = kr.kpis.map((k: any) => k.key);
      assert(keys.includes("monthly_revenue"), "Revenue KPI present");
      assert(keys.includes("monthly_profit"), "Profit KPI present");
      assert(keys.includes("profit_margin"), "Margin KPI present");
    }),

    test("KPI - values are formatted", async () => {
      const result = exec("kpi");
      const kr = result.data as any;
      for (const k of kr.kpis) {
        assert(typeof k.formatted === "string", `KPI ${k.key} has formatted string`);
        assert(k.formatted.length > 0, `KPI ${k.key} formatted is non-empty`);
      }
    }),

    test("KPI - empty dataset handles gracefully", async () => {
      const emptyStore = new MemoryStore();
      const emptyPrefs = new PreferenceStore();
      const result = executeSkill("kpi", {}, emptyStore, emptyPrefs);
      assert(!result.success, "Empty dataset reports no success");
      assert(result.error !== null, "Error returned for empty memory");
    }),

    // ─── SK004: Forecast ───
    test("Forecast - executes with data", async () => {
      const result = exec("forecast");
      assert(result.success, "Forecast succeeded");
      const fr = result.data as any;
      assert(Array.isArray(fr.forecasts), "Forecasts is array");
      assert(fr.forecasts.length > 0, "At least one forecast");
      assert(fr.forecasts[0].predictedValue > 0, "Predicted value > 0");
    }),

    test("Forecast - contains revenue, expense, profit projections", async () => {
      const result = exec("forecast");
      const fr = result.data as any;
      const metrics = fr.forecasts.map((f: any) => f.metric);
      assert(metrics.includes("revenue"), "Revenue forecast");
      assert(metrics.includes("expenses"), "Expense forecast");
      assert(metrics.includes("profit"), "Profit forecast");
    }),

    test("Forecast - confidence levels present", async () => {
      const result = exec("forecast");
      const fr = result.data as any;
      assert(fr.metadata.confidence !== undefined, "Confidence level present");
      assert(["high", "medium", "low"].includes(fr.metadata.confidence), "Valid confidence");
      for (const f of fr.forecasts) {
        assert(typeof f.confidence === "number", `Forecast ${f.metric} has numeric confidence`);
        assert(f.confidence > 0 && f.confidence <= 1, `Forecast ${f.metric} confidence in (0,1]`);
      }
    }),

    test("Forecast - provides range bounds", async () => {
      const result = exec("forecast");
      const fr = result.data as any;
      for (const f of fr.forecasts) {
        assert(f.range.lower <= f.range.upper, `Forecast ${f.metric} range valid`);
        assert(f.range.lower <= f.predictedValue, `Forecast ${f.metric} lower <= predicted`);
        assert(f.range.upper >= f.predictedValue, `Forecast ${f.metric} upper >= predicted`);
      }
    }),

    // ─── SK005: Reorder Advice ───
    test("Reorder Advice - executes with data", async () => {
      const result = exec("reorder_advice");
      assert(result.success, "Reorder advice succeeded");
      const rr = result.data as any;
      assert(Array.isArray(rr.recommendations), "Recommendations is array");
      assert(rr.summary !== undefined, "Summary present");
      assert(rr.metadata !== undefined, "Metadata present");
    }),

    test("Reorder Advice - priority ranking correct", async () => {
      const result = exec("reorder_advice");
      const rr = result.data as any;
      for (const r of rr.recommendations) {
        assert(["critical", "high", "medium", "low"].includes(r.priority), `Valid priority: ${r.priority}`);
      }
    }),

    test("Reorder Advice - empty inventory returns no reorder items", async () => {
      const emptyStore = new MemoryStore();
      const emptyPrefs = new PreferenceStore();
      const result = executeSkill("reorder_advice", {}, emptyStore, emptyPrefs);
      assert(!result.success, "Empty inventory reports no success");
    }),

    // ─── SK006: Recommendation Engine ───
    test("Recommendation Engine - executes with data", async () => {
      const result = exec("recommendation_engine");
      assert(result.success, "Recommendation Engine succeeded");
      const rr = result.data as any;
      assert(Array.isArray(rr.recommendations), "Recommendations array");
      assert(rr.summary !== undefined, "Summary present");
      assert(rr.metadata !== undefined, "Metadata present");
    }),

    test("Recommendation Engine - generates actionable recommendations", async () => {
      const result = exec("recommendation_engine");
      const rr = result.data as any;
      for (const r of rr.recommendations) {
        assert(typeof r.title === "string", `Title is string: ${r.id}`);
        assert(r.title.length > 0, `Title non-empty: ${r.id}`);
        assert(typeof r.description === "string", `Description is string: ${r.id}`);
        assert(["high", "medium", "low"].includes(r.priority), `Valid priority for ${r.id}`);
      }
    }),

    test("Recommendation Engine - priority counts accurate", async () => {
      const result = exec("recommendation_engine");
      const rr = result.data as any;
      const actualHigh = rr.recommendations.filter((r: any) => r.priority === "high").length;
      assertEqual(rr.summary.highPriority, actualHigh, `High priority count matches: ${rr.summary.highPriority} vs ${actualHigh}`);
    }),

    test("Recommendation Engine - empty dataset returns gracefully", async () => {
      const emptyStore = new MemoryStore();
      const emptyPrefs = new PreferenceStore();
      const result = executeSkill("recommendation_engine", {}, emptyStore, emptyPrefs);
      assert(!result.success, "Empty dataset reports no success");
    }),

    // ─── Skill Registry ───
    test("Skill Registry - all skills registered", async () => {
      const { listSkills } = await import("../skills/skill-registry");
      const skills = listSkills();
      const ids = skills.map((s) => s.id).sort();
      assert(ids.includes("health_score"), "health_score registered");
      assert(ids.includes("analytics"), "analytics registered");
      assert(ids.includes("kpi"), "kpi registered");
      assert(ids.includes("forecast"), "forecast registered");
      assert(ids.includes("reorder_advice"), "reorder_advice registered");
      assert(ids.includes("recommendation_engine"), "recommendation_engine registered");
    }),

    test("Skill Registry - unknown skill returns error", async () => {
      const { executeSkill: execRaw } = await import("../skills/skill-registry");
      const result = execRaw("nonexistent_skill", {}, store, prefs);
      assert(!result.success, "Unknown skill fails");
      assert(result.error !== null, "Error returned");
      assertEqual(result.error!.code, "SKILL_NOT_FOUND", "Correct error code");
    }),
  ]);
}
