import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../src/lib/brain/memory/business-memory";
import { MemoryWriter } from "../src/lib/brain/memory/memory-writer";
import { PreferenceStore } from "../src/lib/brain/learning/preference-store";
import { ContextRetriever } from "../src/lib/brain/context/context-retriever";
import { createMockRawData } from "../src/lib/brain/validation/fixtures";
import { buildCustomerLedger } from "../src/lib/ai/customer-ledger";
import { buildSupplierLedger } from "../src/lib/ai/supplier-ledger";
import { buildFinancialLedger } from "../src/lib/ai/financial-ledger";
import { processCustomerQuery } from "../src/lib/ai/customer-intelligence";
import { processSupplierQuery } from "../src/lib/ai/supplier-intelligence";
import { processFinancialQuery } from "../src/lib/ai/financial-intelligence";
import { processInventoryQuery } from "../src/lib/ai/inventory-intelligence";
import { processBusinessIntelligenceQuery } from "../src/lib/ai/business-intelligence";
import { buildBusinessQueryDirectPrompt } from "../src/lib/ai/business-query-direct";
import { generateExecutiveReport, explainKPI } from "../src/lib/ai/executive-ai";
import { formatBooksMoney } from "../src/lib/tradeos/formatters";
import { execute as executeKpiSkill } from "../src/lib/brain/skills/kpi";
import { execute as executeRecEngine } from "../src/lib/brain/skills/recommendation-engine";
import type { AssistantIntent } from "../src/lib/assistant/types";

// J1a — AI currency labels (2026-11-24).
//
// Defect (J1 inventory + Claude msg 47): every AI surface labels EUR
// amounts as PKR. The brain loader already fetches the org's books
// currency (organizations.books_currency) into data.currency /
// store.meta.currency, but the text builders never read it:
//   - brain context text hardcodes "PKR ${...}" (context-retriever.ts,
//     business-memory.ts getBusinessSummary, memory-writer.ts KPI
//     `formatted` strings);
//   - every intelligence module has its own local `Rs ${...}` formatter
//     (customer/supplier/financial/inventory/business-intelligence,
//     executive-ai);
//   - the business-query direct prompt says "Use PKR currency
//     formatting.";
//   - the conversation runtime's confirmation strings hardcode
//     "PKR ${...}";
//   - the sale/purchase success messages hardcode "Total: PKR ...";
//   - the assistant's draft field formatter hardcodes "Rs ${value}".
//
// Fix (LABELS ONLY — no threshold, formula or valuation change): all AI
// text formats money with the org's books currency via one shared
// helper (formatAiMoney, books formatter, no conversion, no relabel).
// Follow-up (Claude msg 48): a currency that is present but unknown is
// NOT silently relabelled PKR — it renders its ISO code as a prefix
// ("XYZ 9,440"); a missing currency renders the bare number ("9,440");
// both cases are logged. NEVER silently fall back to PKR: that is the
// same bug J1a fixed.
//
// The test covers TWO currencies: a EUR org and a PKR org. A EUR-only
// test would hide a hardcode (the old code renders PKR for both).
//
// Run: npx tsx scripts/test-j1a-ai-currency-labels.ts

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

/** True when the text carries a PKR money label (code or "Rs"). */
function hasPkrLabel(text: string): boolean {
  // Intl renders PKR as "Rs" followed by a non-breaking space, so match
  // the bare "Rs" rather than "Rs " (regular space would never match).
  return text.includes("PKR") || text.includes("Rs");
}

function buildStore(currency: string) {
  const data = createMockRawData();
  data.currency = currency;
  const store = new MemoryStore();
  const prefs = new PreferenceStore();
  new MemoryWriter(store, prefs).writeRaw(data);
  return { store, data, prefs };
}

function skillContext(built: ReturnType<typeof buildStore>) {
  return {
    memory: built.store,
    preferences: built.prefs,
    requestId: "j1a-test",
    invokedAt: new Date().toISOString(),
  };
}

/** Seed one overdue customer so the recommendation engine emits money text. */
function seedOverdueCustomer(built: ReturnType<typeof buildStore>): void {
  const first = Array.from(built.store.customers.values())[0];
  if (first) {
    first.overdueAmount = 250;
    first.totalSales30d = 5000;
  }
}

function financialIntent(): AssistantIntent {
  return {
    module: "financial",
    actionType: "financial_query",
    queryType: "financial_summary",
    entities: {},
    raw: "Give me a financial summary",
    confidence: 1,
    unresolvedNames: [],
  } as unknown as AssistantIntent;
}

async function main(): Promise<void> {
  // --- (a) The shared helper: books currency, no conversion. ---
  console.log("(a) formatAiMoney labels with the org's books currency");
  // The helper module does not exist yet on unmodified code — record the
  // missing export as a failed check and keep running the behavioural
  // sections, so RED shows the hardcoded labels, not just an import error.
  let aiMoney: { formatAiMoney?: unknown; resolveAiCurrency?: unknown } = {};
  try {
    aiMoney = (await import("../src/lib/ai/ai-money")) as {
      formatAiMoney?: unknown;
      resolveAiCurrency?: unknown;
    };
  } catch {
    aiMoney = {};
  }
  check(typeof aiMoney.formatAiMoney === "function", "src/lib/ai/ai-money.ts exports formatAiMoney");
  check(typeof aiMoney.resolveAiCurrency === "function", "src/lib/ai/ai-money.ts exports resolveAiCurrency");
  if (typeof aiMoney.formatAiMoney === "function") {
    const formatAiMoney = aiMoney.formatAiMoney as (amount: number, currency: unknown) => string;
    // EUR: the euro sign, and the amount is NOT converted (1000 stays 1,000.00).
    check(formatAiMoney(1000, "EUR") === "€1,000.00", `formatAiMoney(1000, "EUR") is €1,000.00 (got ${formatAiMoney(1000, "EUR")})`);
    check(!hasPkrLabel(formatAiMoney(9475.86, "EUR")), "EUR formatting carries no PKR/Rs label");
    // PKR: the legacy label, no euro sign.
    const pkr = formatAiMoney(1000, "PKR");
    check((pkr.includes("PKR") || pkr.includes("Rs")) && !pkr.includes("€"), `formatAiMoney(1000, "PKR") labels PKR (got ${pkr})`);
    // Unknown currency present: ISO code prefix, NEVER a silent PKR
    // relabel (Claude msg 48 — the silent fallback is the same bug J1a
    // fixed). The number uses plain en-PK grouping with no forced
    // fraction digits, so 9,440 renders as "9,440" and 9,440.5 as "9,440.5".
    check(formatAiMoney(9440, "XYZ") === "XYZ 9,440", `formatAiMoney(9440, "XYZ") is XYZ 9,440 (got ${formatAiMoney(9440, "XYZ")})`);
    check(formatAiMoney(1000, "XXX") === "XXX 1,000", `formatAiMoney(1000, "XXX") is XXX 1,000 (got ${formatAiMoney(1000, "XXX")})`);
    check(formatAiMoney(9440.5, "XYZ") === "XYZ 9,440.5", `formatAiMoney(9440.5, "XYZ") keeps the fraction (got ${formatAiMoney(9440.5, "XYZ")})`);
    check(!hasPkrLabel(formatAiMoney(9440, "XYZ")), "unknown currency never renders a PKR/Rs label");
    check(!formatAiMoney(9440, "XYZ").includes("€"), "unknown currency never renders €");
    // Missing currency: bare number only, NEVER a silent PKR relabel.
    check(formatAiMoney(9440, undefined) === "9,440", `formatAiMoney(9440, undefined) is the bare number 9,440 (got ${formatAiMoney(9440, undefined)})`);
    check(formatAiMoney(9440, null) === "9,440", `formatAiMoney(9440, null) is the bare number 9,440 (got ${formatAiMoney(9440, null)})`);
    check(formatAiMoney(9440, "") === "9,440", `formatAiMoney(9440, "") is the bare number 9,440 (got ${formatAiMoney(9440, "")})`);
    check(!hasPkrLabel(formatAiMoney(9440, undefined)), "missing currency never renders a PKR/Rs label");
    // Both fallback cases are logged.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      formatAiMoney(9440, "XYZ");
      formatAiMoney(9440, undefined);
      formatAiMoney(9440, null);
    } finally {
      console.warn = origWarn;
    }
    check(warnings.some((w) => w.includes("XYZ")), "unknown currency logs the unknown code");
    check(warnings.some((w) => /missing/i.test(w)), "missing currency logs the missing case");
  }
  if (typeof aiMoney.resolveAiCurrency === "function") {
    type AiCurrencyResolution =
      | { kind: "known"; currency: string }
      | { kind: "unknown"; code: string }
      | { kind: "missing" };
    const resolveAiCurrency = aiMoney.resolveAiCurrency as (
      currency: unknown
    ) => AiCurrencyResolution;
    const eurResolved = resolveAiCurrency("EUR");
    check(eurResolved.kind === "known" && eurResolved.currency === "EUR", "resolveAiCurrency reports EUR as known");
    const pkrResolved = resolveAiCurrency("PKR");
    check(pkrResolved.kind === "known" && pkrResolved.currency === "PKR", "resolveAiCurrency reports PKR as known");
    const lowerResolved = resolveAiCurrency("eur");
    check(lowerResolved.kind === "known" && lowerResolved.currency === "EUR", "resolveAiCurrency normalises lowercase eur to known EUR");
    const xyzResolved = resolveAiCurrency("XYZ");
    check(xyzResolved.kind === "unknown" && xyzResolved.code === "XYZ", "resolveAiCurrency reports XYZ as unknown with its code");
    check(resolveAiCurrency(undefined).kind === "missing", "resolveAiCurrency reports undefined as missing, never PKR");
    check(resolveAiCurrency(null).kind === "missing", "resolveAiCurrency reports null as missing, never PKR");
  }

  // --- (b) Brain context text: EUR org. ---
  console.log("(b) brain context on a EUR org labels EUR");
  const eur = buildStore("EUR");
  const eurContext = new ContextRetriever(eur.store).getBusinessContext();
  check(eurContext.includes("€"), "EUR brain context carries the euro sign");
  check(!hasPkrLabel(eurContext), "EUR brain context carries no PKR/Rs money label");
  const eurSummary = eur.store.getBusinessSummary();
  check(eurSummary.includes("€"), "EUR business summary carries the euro sign");
  check(!hasPkrLabel(eurSummary), "EUR business summary carries no PKR/Rs money label");
  const eurKpis = eur.store.analytics.kpis.filter((k) => k.unit === "currency");
  check(eurKpis.length > 0, "EUR fixture has currency KPIs to check");
  for (const kpi of eurKpis) {
    check(kpi.formatted.includes("€"), `EUR KPI ${kpi.key} formatted with € (got ${kpi.formatted})`);
    check(!hasPkrLabel(kpi.formatted), `EUR KPI ${kpi.key} formatted carries no PKR/Rs label`);
  }

  // --- (c) Brain context text: PKR org (mirror — must still say PKR). ---
  console.log("(c) brain context on a PKR org still labels PKR");
  const pkrOrg = buildStore("PKR");
  const pkrContext = new ContextRetriever(pkrOrg.store).getBusinessContext();
  check(!pkrContext.includes("€"), "PKR brain context carries no euro sign");
  check(hasPkrLabel(pkrContext), "PKR brain context labels PKR");
  const pkrSummary = pkrOrg.store.getBusinessSummary();
  check(!pkrSummary.includes("€"), "PKR business summary carries no euro sign");
  check(hasPkrLabel(pkrSummary), "PKR business summary labels PKR");

  // --- (d) Intelligence modules: EUR org. ---
  console.log("(d) intelligence modules on a EUR org label EUR");
  const eurNow = new Date();
  const eurCustomerLedger = buildCustomerLedger(eur.data, eurNow);
  const eurSupplierLedger = buildSupplierLedger(eur.data, eurNow);
  const eurFinancialLedger = buildFinancialLedger(eur.data, eurNow);
  const eurCustomer = processCustomerQuery("summary", null, eur.store, eurCustomerLedger);
  check(eurCustomer.ok && eurCustomer.message.includes("€"), "EUR customer summary carries €");
  check(!hasPkrLabel(eurCustomer.message), "EUR customer summary carries no PKR/Rs label");
  const eurSupplier = processSupplierQuery("summary", null, eur.store, eurSupplierLedger);
  check(eurSupplier.ok && eurSupplier.message.includes("€"), "EUR supplier summary carries €");
  check(!hasPkrLabel(eurSupplier.message), "EUR supplier summary carries no PKR/Rs label");
  const eurFinancial = processFinancialQuery("financial_summary", eurFinancialLedger, financialIntent(), "summary", "EUR");
  check(eurFinancial.ok && eurFinancial.message.includes("€"), "EUR financial summary carries €");
  check(!hasPkrLabel(eurFinancial.message), "EUR financial summary carries no PKR/Rs label");
  const eurInventory = processInventoryQuery("inventory_value", null, eur.store);
  check(eurInventory.ok && eurInventory.message.includes("€"), "EUR inventory value carries €");
  check(!hasPkrLabel(eurInventory.message), "EUR inventory value carries no PKR/Rs label");
  const eurKpiSkill = executeKpiSkill({}, skillContext(eur));
  check(eurKpiSkill.success === true, "EUR KPI skill runs");
  const eurSkillKpis = (
    (eurKpiSkill.data as unknown as { kpis?: Array<{ unit: string; formatted: string }> } | null)?.kpis ?? []
  ).filter((k) => k.unit === "currency");
  check(eurSkillKpis.length > 0, "EUR KPI skill has currency KPIs to check");
  for (const k of eurSkillKpis) {
    check(k.formatted.includes("€"), `EUR KPI skill formatted with € (got ${k.formatted})`);
    check(!hasPkrLabel(k.formatted), `EUR KPI skill formatted carries no PKR/Rs label`);
  }
  seedOverdueCustomer(eur);
  const eurRecs = executeRecEngine({ categories: ["customers"] }, skillContext(eur));
  const eurRecText = (
    (eurRecs.data as unknown as { recommendations?: Array<{ title: string; description: string }> } | null)
      ?.recommendations ?? []
  )
    .map((r) => `${r.title} ${r.description}`)
    .join(" ");
  check(eurRecText.includes("€"), "EUR recommendation text carries €");
  check(!hasPkrLabel(eurRecText), "EUR recommendation text carries no PKR/Rs label");
  const eurBi = processBusinessIntelligenceQuery("sales_forecast", eur.store, eur.data, "forecast");
  check(eurBi.ok && eurBi.message.includes("€"), "EUR sales forecast carries €");
  check(!hasPkrLabel(eurBi.message), "EUR sales forecast carries no PKR/Rs label");
  const execAiSource = readFileSync("src/lib/ai/executive-ai.ts", "utf8");
  check(
    execAiSource.includes("generateMorningBriefing(payload, language, data.currency)"),
    "executive report passes the org currency into the morning briefing"
  );
  check(
    execAiSource.includes("formatRs(payload.salesForecasting.tomorrow, currency)"),
    "morning briefing formats the forecast with the passed currency"
  );
  check(
    execAiSource.includes("formatRs(value, data.currency)"),
    "explainKPI formats the KPI value with the org currency"
  );
  const report = generateExecutiveReport(eur.store, eur.data, "morning", "org-eur", "english");
  check(report.detailedReports.morningBriefing.includes("€"), "EUR executive briefing carries €");
  const kpi = explainKPI(eur.store, eur.data, "revenue", "org-eur", "english");
  check(kpi.explanation.includes("€"), "EUR executive revenue explanation carries €");

  // --- (e) Intelligence modules: PKR org (mirror). ---
  console.log("(e) intelligence modules on a PKR org still label PKR");
  const pkrNow = new Date();
  const pkrCustomerLedger = buildCustomerLedger(pkrOrg.data, pkrNow);
  const pkrFinancialLedger = buildFinancialLedger(pkrOrg.data, pkrNow);
  const pkrCustomer = processCustomerQuery("summary", null, pkrOrg.store, pkrCustomerLedger);
  check(!pkrCustomer.message.includes("€"), "PKR customer summary carries no euro sign");
  check(hasPkrLabel(pkrCustomer.message), "PKR customer summary labels PKR");
  const pkrFinancial = processFinancialQuery("financial_summary", pkrFinancialLedger, financialIntent(), "summary", "PKR");
  check(!pkrFinancial.message.includes("€"), "PKR financial summary carries no euro sign");
  check(hasPkrLabel(pkrFinancial.message), "PKR financial summary labels PKR");
  const pkrInventory = processInventoryQuery("inventory_value", null, pkrOrg.store);
  check(!pkrInventory.message.includes("€"), "PKR inventory value carries no euro sign");
  check(hasPkrLabel(pkrInventory.message), "PKR inventory value labels PKR");
  const pkrKpiSkill = executeKpiSkill({}, skillContext(pkrOrg));
  check(pkrKpiSkill.success === true, "PKR KPI skill runs");
  const pkrSkillKpis = (
    (pkrKpiSkill.data as unknown as { kpis?: Array<{ unit: string; formatted: string }> } | null)?.kpis ?? []
  ).filter((k) => k.unit === "currency");
  check(pkrSkillKpis.length > 0, "PKR KPI skill has currency KPIs to check");
  for (const k of pkrSkillKpis) {
    check(!k.formatted.includes("€"), `PKR KPI skill formatted carries no euro sign (got ${k.formatted})`);
    check(hasPkrLabel(k.formatted), `PKR KPI skill formatted labels PKR`);
  }
  seedOverdueCustomer(pkrOrg);
  const pkrRecs = executeRecEngine({ categories: ["customers"] }, skillContext(pkrOrg));
  const pkrRecText = (
    (pkrRecs.data as unknown as { recommendations?: Array<{ title: string; description: string }> } | null)
      ?.recommendations ?? []
  )
    .map((r) => `${r.title} ${r.description}`)
    .join(" ");
  check(!pkrRecText.includes("€"), "PKR recommendation text carries no euro sign");
  check(hasPkrLabel(pkrRecText), "PKR recommendation text labels PKR");

  // --- (f) Business-query direct prompt: currency line follows the org. ---
  console.log("(f) business-query direct prompt uses the org currency");
  const eurPrompt = buildBusinessQueryDirectPrompt({
    question: "What are my payables?",
    language: "english",
    businessContext: eurContext,
    history: "",
    currency: "EUR",
  });
  check(eurPrompt.includes("Use EUR currency formatting."), "EUR direct prompt says EUR formatting");
  check(!eurPrompt.includes("Use PKR currency formatting."), "EUR direct prompt never says PKR formatting");
  const pkrPrompt = buildBusinessQueryDirectPrompt({
    question: "What are my payables?",
    language: "english",
    businessContext: pkrContext,
    history: "",
    currency: "PKR",
  });
  check(pkrPrompt.includes("Use PKR currency formatting."), "PKR direct prompt says PKR formatting");
  check(!pkrPrompt.includes("Use EUR currency formatting."), "PKR direct prompt never says EUR formatting");
  const xyzPrompt = buildBusinessQueryDirectPrompt({
    question: "What are my payables?",
    language: "english",
    businessContext: eurContext,
    history: "",
    currency: "XYZ",
  });
  check(xyzPrompt.includes("Use XYZ currency formatting."), "unknown-code direct prompt says XYZ formatting");
  check(!xyzPrompt.includes("Use PKR currency formatting."), "unknown-code direct prompt never says PKR formatting");
  const missingPrompt = buildBusinessQueryDirectPrompt({
    question: "What are my payables?",
    language: "english",
    businessContext: eurContext,
    history: "",
  });
  check(!missingPrompt.includes("Use PKR currency formatting."), "missing-currency direct prompt never says PKR formatting");
  check(missingPrompt.includes("bare numbers"), "missing-currency direct prompt tells the model to render bare numbers");

  // --- (g) Sale/purchase success messages: EUR vs PKR. ---
  console.log("(g) sale/purchase success messages label the org currency");
  let salesExec: Record<string, unknown> = {};
  let purchaseExec: Record<string, unknown> = {};
  try {
    salesExec = (await import("../src/lib/ai/sales-executor")) as Record<string, unknown>;
  } catch {
    salesExec = {};
  }
  try {
    purchaseExec = (await import("../src/lib/ai/purchase-executor")) as Record<string, unknown>;
  } catch {
    purchaseExec = {};
  }
  check(typeof salesExec.formatSaleSuccessMessage === "function", "sales executor exposes formatSaleSuccessMessage");
  check(
    typeof purchaseExec.formatPurchaseSuccessMessage === "function",
    "purchase executor exposes formatPurchaseSuccessMessage"
  );
  if (typeof salesExec.formatSaleSuccessMessage === "function") {
    const formatSaleSuccessMessage = salesExec.formatSaleSuccessMessage as (
      result: { total?: number },
      currency?: unknown
    ) => string;
    const eurSale = formatSaleSuccessMessage({ total: 1000 }, "EUR");
    check(eurSale.includes("€1,000.00"), `EUR sale message shows €1,000.00 (got ${eurSale})`);
    check(!hasPkrLabel(eurSale), "EUR sale message carries no PKR/Rs label");
    const pkrSale = formatSaleSuccessMessage({ total: 1000 }, "PKR");
    check(!pkrSale.includes("€"), "PKR sale message carries no euro sign");
    check(hasPkrLabel(pkrSale), "PKR sale message labels PKR");
  }
  if (typeof purchaseExec.formatPurchaseSuccessMessage === "function") {
    const formatPurchaseSuccessMessage = purchaseExec.formatPurchaseSuccessMessage as (
      result: { total?: number },
      currency?: unknown
    ) => string;
    const eurPurchase = formatPurchaseSuccessMessage({ total: 1000 }, "EUR");
    check(eurPurchase.includes("€1,000.00"), `EUR purchase message shows €1,000.00 (got ${eurPurchase})`);
    check(!hasPkrLabel(eurPurchase), "EUR purchase message carries no PKR/Rs label");
  }

  // --- (h) Wiring: callers pass the org currency; no hardcoded labels remain. ---
  console.log("(h) callers pass the currency; no hardcoded money labels remain in AI text");
  const runtimeSource = readFileSync("src/lib/ai/conversation-runtime.ts", "utf8");
  check(
    runtimeSource.includes("currency: this.orgCurrency()"),
    "conversation runtime passes orgCurrency() into the direct business-query prompt"
  );
  check(!runtimeSource.includes("`PKR ${"), "conversation-runtime.ts has no hardcoded `PKR ${` money label");
  const executorSource = readFileSync("src/lib/assistant/executor.ts", "utf8");
  check(
    executorSource.includes("data?.currency") || executorSource.includes("data.currency"),
    "assistant executor passes the org currency into processFinancialQuery"
  );
  const financialQueryRoute = readFileSync("src/app/api/ai/financial/query/route.ts", "utf8");
  check(
    financialQueryRoute.includes("rawData.currency"),
    "financial query route passes rawData.currency into processFinancialQuery"
  );
  const financialSummaryRoute = readFileSync("src/app/api/ai/financial/summary/route.ts", "utf8");
  check(
    financialSummaryRoute.includes("rawData.currency"),
    "financial summary route passes rawData.currency into processFinancialQuery"
  );
  const pageSource = readFileSync("src/app/page.tsx", "utf8");
  const onBrainChatStart = pageSource.indexOf("const onBrainChat");
  const onBrainChatBlock = pageSource.slice(onBrainChatStart, pageSource.indexOf("\n  const buildAnalyticsContext", onBrainChatStart));
  check(onBrainChatBlock.includes("booksCurrency"), "onBrainChat sends booksCurrency to the business-brain route");
  for (const rel of [
    "src/lib/ai/customer-intelligence.ts",
    "src/lib/ai/supplier-intelligence.ts",
    "src/lib/ai/financial-intelligence.ts",
    "src/lib/ai/inventory-intelligence.ts",
    "src/lib/ai/business-intelligence.ts",
    "src/lib/ai/executive-ai.ts",
    "src/lib/ai/business-query-direct.ts",
    "src/lib/ai/conversation-runtime.ts",
    "src/lib/ai/purchase-executor.ts",
    "src/lib/ai/sales-executor.ts",
    "src/lib/assistant/assistant.ts",
    "src/lib/brain/context/context-retriever.ts",
    "src/lib/brain/memory/business-memory.ts",
    "src/lib/brain/memory/memory-writer.ts",
    "src/lib/brain/skills/kpi.ts",
    "src/lib/brain/skills/recommendation-engine.ts",
    "src/lib/assistant/executor.ts",
  ]) {
    const src = readFileSync(rel, "utf8");
    check(!src.includes("`Rs ${"), rel + " has no hardcoded `Rs ${` money label");
    check(!src.includes("`PKR ${"), rel + " has no hardcoded `PKR ${` money label");
  }
  const directPromptSource = readFileSync("src/lib/ai/business-query-direct.ts", "utf8");
  check(
    !directPromptSource.includes('"Use PKR currency formatting."') &&
      !directPromptSource.includes("`Use PKR currency formatting.`"),
    "business-query-direct.ts never hardcodes the PKR prompt line"
  );

  // --- (i) AI amounts equal the dashboard books formatter string. ---
  // The dashboard renders money with formatBooksMoney (tradeos/formatters,
  // backed by formatBooksAmount with the active number locale, en-PK in
  // this test process). The AI formatter must produce EXACTLY that
  // string on both a EUR org and a PKR org (Claude msg 48) — any drift
  // in locale, digits or symbol fails here, not on a live screen.
  console.log("(i) AI amounts equal the dashboard books formatter string");
  const aiMoneyForSectionI = (await import("../src/lib/ai/ai-money")) as {
    formatAiMoney: (amount: number, currency: unknown) => string;
  };
  const formatAiMoney = aiMoneyForSectionI.formatAiMoney;
  check(
    formatAiMoney(9440, "EUR") === formatBooksMoney(9440, "EUR"),
    `AI EUR 9440 equals dashboard books string (AI ${formatAiMoney(9440, "EUR")} vs dashboard ${formatBooksMoney(9440, "EUR")})`
  );
  check(
    formatAiMoney(9475.86, "EUR") === formatBooksMoney(9475.86, "EUR"),
    `AI EUR 9475.86 equals dashboard books string (AI ${formatAiMoney(9475.86, "EUR")} vs dashboard ${formatBooksMoney(9475.86, "EUR")})`
  );
  check(
    formatAiMoney(9440, "PKR") === formatBooksMoney(9440, "PKR"),
    `AI PKR 9440 equals dashboard books string (AI ${formatAiMoney(9440, "PKR")} vs dashboard ${formatBooksMoney(9440, "PKR")})`
  );
  check(
    formatAiMoney(8220, "PKR") === formatBooksMoney(8220, "PKR"),
    `AI PKR 8220 equals dashboard books string (AI ${formatAiMoney(8220, "PKR")} vs dashboard ${formatBooksMoney(8220, "PKR")})`
  );
  // NBSP after "Rs": Intl renders PKR with a non-breaking space, so the
  // literal must spell it out (\u00A0) — a regular space never matches.
  check(
    formatAiMoney(8220, "PKR") === "Rs\u00A08,220.00",
    `PKR renders exactly the dashboard string Rs 8,220.00 (got ${formatAiMoney(8220, "PKR")})`
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main();
