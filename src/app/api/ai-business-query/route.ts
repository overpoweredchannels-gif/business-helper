import { NextRequest, NextResponse } from "next/server";
import { callAiProviderRouter } from "@/lib/ai/provider-router";

export const runtime = "nodejs";

type BusinessQueryResult = {
  answer: string;
  query_type: string;
  language: string;
  key_points: string[];
  warnings: string[];
};

const safeText = (value: unknown, maxLength = 4000) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => safeText(item, 500)).filter(Boolean).slice(0, 8)
    : [];

const sanitizeResult = (value: any, fallbackAnswer: string, queryType: string, language: string): BusinessQueryResult => ({
  answer: safeText(value?.answer, 8000) || fallbackAnswer,
  query_type: safeText(value?.query_type, 100) || queryType || "general",
  language: safeText(value?.language, 50) || language || "auto",
  key_points: normalizeStringArray(value?.key_points),
  warnings: normalizeStringArray(value?.warnings),
});

const getSummarySection = (summary: any, key: string) =>
  summary && typeof summary === "object" && summary[key] && typeof summary[key] === "object"
    ? summary[key]
    : {};

const buildLocalFallbackResult = (
  question: string,
  language: string,
  queryType: string,
  businessSummary: any
): BusinessQueryResult => {
  const sales = getSummarySection(businessSummary, "sales");
  const purchases = getSummarySection(businessSummary, "purchases");
  const customerPayments = getSummarySection(businessSummary, "customer_payments");
  const supplierPayments = getSummarySection(businessSummary, "supplier_payments");
  const expenses = getSummarySection(businessSummary, "expenses");
  const tasks = getSummarySection(businessSummary, "tasks");
  const inventory = getSummarySection(businessSummary, "inventory");
  const marketIntelligence = getSummarySection(businessSummary, "market_intelligence");

  const keyPoints = [
    `Sales: ${safeNumber(sales.count)} invoice(s), total ${safeNumber(sales.total_amount).toLocaleString("en-PK")}.`,
    `Purchases: ${safeNumber(purchases.count)} invoice(s), total ${safeNumber(purchases.total_amount).toLocaleString("en-PK")}.`,
    `Customer payments: ${safeNumber(customerPayments.count)} payment(s), total ${safeNumber(customerPayments.total_amount).toLocaleString("en-PK")}.`,
    `Supplier payments: ${safeNumber(supplierPayments.count)} payment(s), total ${safeNumber(supplierPayments.total_amount).toLocaleString("en-PK")}.`,
    `Expenses: ${safeNumber(expenses.count)} entry/entries, total ${safeNumber(expenses.total_amount).toLocaleString("en-PK")}.`,
    `Tasks: ${safeNumber(tasks.pending)} pending, ${safeNumber(tasks.completed)} completed, ${safeNumber(tasks.overdue)} overdue.`,
  ];

  const lowStockCount = Array.isArray(inventory.low_stock_products) ? inventory.low_stock_products.length : 0;
  const outOfStockCount = Array.isArray(inventory.out_of_stock_products) ? inventory.out_of_stock_products.length : 0;
  if (lowStockCount || outOfStockCount) {
    keyPoints.push(`Inventory alerts: ${outOfStockCount} out of stock, ${lowStockCount} low stock.`);
  }

  const highImpactCount = Array.isArray(marketIntelligence.high_impact_items)
    ? marketIntelligence.high_impact_items.length
    : 0;
  const criticalCount = Array.isArray(marketIntelligence.critical_items)
    ? marketIntelligence.critical_items.length
    : 0;
  if (highImpactCount || criticalCount) {
    keyPoints.push(`Market alerts: ${criticalCount} critical, ${highImpactCount} high impact.`);
  }

  return {
    answer: `AI providers are unavailable, but here is a local TradeOS summary for "${question}". ${keyPoints.join(" ")}`,
    query_type: queryType || "general",
    language: language || "auto",
    key_points: keyPoints,
    warnings: ["This is a local fallback summary. It is not a Gemini/OpenAI/Groq generated answer."],
  };
};

const localFallbackEnabled = () => safeText(process.env.AI_ENABLE_LOCAL_FALLBACK).toLowerCase() === "true";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const question = safeText(body?.question, 1000);
    const language = safeText(body?.language, 50) || "auto";
    const queryType = safeText(body?.query_type, 100) || "general";
    const dateRangeStart = safeText(body?.date_range_start, 50);
    const dateRangeEnd = safeText(body?.date_range_end, 50);
    const businessSummary = body?.business_summary && typeof body.business_summary === "object"
      ? body.business_summary
      : {};

    if (!question) {
      return NextResponse.json(
        { ok: false, error: "Question is required." },
        { status: 400 }
      );
    }

    const summaryText = safeText(JSON.stringify(businessSummary), 24000);
    const prompt = `
You are TradeOS Business Assistant for Pakistani wholesalers, traders, distributors, and general store suppliers.
Answer only from the provided business_summary. Do not invent data. If data is missing, say it is not available.
Do not execute actions or suggest that you changed records.

Language setting: ${language}
If language is auto, reply in the same language style as the question. For Urdu or Roman Urdu, keep business terms understandable for Pakistani traders.

Question: ${question}
Query type: ${queryType}
Date range: ${dateRangeStart || "-"} to ${dateRangeEnd || "-"}

Mention totals, staff, customers, products, payments, expenses, stock, duty sessions, and market alerts when available and relevant. Keep the answer practical for the owner.

Return JSON only:
{
  "answer": string,
  "query_type": string,
  "language": string,
  "key_points": string[],
  "warnings": string[]
}

business_summary:
${summaryText}
`;

    const routerResult = await callAiProviderRouter({
      task: "ai_business_query",
      prompt,
      jsonMode: true,
      temperature: 0.2,
      expectedJsonShapeDescription: `{
  "answer": string,
  "query_type": string,
  "language": string,
  "key_points": string[],
  "warnings": string[]
}`,
    });

    if (!routerResult.ok) {
      console.error("AI business query provider router error:", {
        error: routerResult.error,
        attempts: routerResult.attempts,
      });

      if (localFallbackEnabled()) {
        return NextResponse.json({
          ok: true,
          provider: "local_fallback",
          model: "local_summary",
          result: buildLocalFallbackResult(question, language, queryType, businessSummary),
          raw: { attempts: routerResult.attempts, fallback: true },
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: "AI providers are temporarily unavailable. Tried configured providers.",
          details: routerResult.error,
          attempts: routerResult.attempts,
        },
        { status: 502 }
      );
    }

    const fallbackAnswer = routerResult.text || "AI returned an empty answer.";
    const result = sanitizeResult(routerResult.json, fallbackAnswer, queryType, language);

    return NextResponse.json({
      ok: true,
      provider: routerResult.provider,
      model: routerResult.model,
      result,
      raw: routerResult.raw,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown AI business query error";
    console.error("AI business query route error:", details);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not run AI business query",
        details,
      },
      { status: 500 }
    );
  }
}
