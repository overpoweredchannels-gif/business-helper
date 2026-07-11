import { NextRequest, NextResponse } from "next/server";
import { callAiProviderRouter } from "@/lib/ai/provider-router";

export const runtime = "nodejs";

const marketCategories = [
  "cooking_oil_ghee",
  "sugar",
  "wheat_flour",
  "rice",
  "pulses",
  "spices",
  "beverages",
  "dairy",
  "fuel_transport",
  "packaging",
  "currency_imports",
  "taxes_policy",
  "weather_agriculture",
  "general_fmcg",
];

const impactDirections = [
  "price_up",
  "price_down",
  "supply_shortage",
  "supply_improvement",
  "demand_up",
  "demand_down",
  "neutral",
];

const impactLevels = ["low", "medium", "high", "critical"];
const confidenceLevels = ["low", "medium", "high"];
const affectedAreas = ["buying", "selling", "inventory", "transport", "pricing", "cashflow", "business"];

type AnalysisResult = {
  summary: string;
  reasoning: string;
  market_category: string;
  impact_direction: string;
  impact_level: string;
  confidence_level: string;
  affected_area: string;
  suggested_action: string;
  risks: string;
  owner_questions: string;
};

const safeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const safeLimitedText = (value: unknown, maxLength: number) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const pickAllowed = (value: unknown, allowed: string[], fallback: string) => {
  const text = safeText(value);
  return allowed.includes(text) ? text : fallback;
};

const sanitizeAnalysis = (analysis: any): AnalysisResult => ({
  summary: safeText(analysis?.summary) || "No clear summary was returned.",
  reasoning: safeText(analysis?.reasoning) || "No reasoning was returned.",
  market_category: pickAllowed(analysis?.market_category, marketCategories, "general_fmcg"),
  impact_direction: pickAllowed(analysis?.impact_direction, impactDirections, "neutral"),
  impact_level: pickAllowed(analysis?.impact_level, impactLevels, "medium"),
  confidence_level: pickAllowed(analysis?.confidence_level, confidenceLevels, "medium"),
  affected_area: pickAllowed(analysis?.affected_area, affectedAreas, "business"),
  suggested_action: safeText(analysis?.suggested_action) || "Review this signal before taking action.",
  risks: safeText(analysis?.risks) || "AI analysis may be incomplete or incorrect.",
  owner_questions: safeText(analysis?.owner_questions) || "What supplier, inventory, or price data should be checked before acting?",
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const inputTitle = safeLimitedText(body?.title, 300);
    const inputSummary = safeLimitedText(body?.summary, 1200);
    const inputRawText = safeLimitedText(body?.raw_text, 3000);
    const inputSourceName = safeLimitedText(body?.source_name, 200);
    const inputSourceUrl = safeLimitedText(body?.source_url, 500);
    const inputMarketCategory = safeLimitedText(body?.market_category, 100);
    const inputCountry = safeLimitedText(body?.context_country, 100) || "Pakistan";
    const inputBusinessContext =
      safeLimitedText(body?.business_context, 1200) || "Small wholesale and trading business";

    if (!inputTitle && !inputSummary && !inputRawText) {
      return NextResponse.json(
        {
          ok: false,
          error: "No analyzable content was provided.",
          details: "Please add a title, summary, or note before running AI analysis.",
        },
        { status: 400 }
      );
    }

    const prompt = `
Analyze this market signal for a Pakistani wholesaler/trader/distributor.
Focus context: FMCG, cooking oil/ghee, sugar, wheat/flour, rice, pulses, spices, beverages, dairy, fuel/transport, packaging, imports/currency, taxes/policy, weather/agriculture.
Return JSON only, no markdown.

Allowed enums:
market_category: ${marketCategories.join(", ")}
impact_direction: ${impactDirections.join(", ")}
impact_level: ${impactLevels.join(", ")}
confidence_level: ${confidenceLevels.join(", ")}
affected_area: ${affectedAreas.join(", ")}

Exact JSON shape:
{
  "summary": string,
  "reasoning": string,
  "market_category": string,
  "impact_direction": string,
  "impact_level": string,
  "confidence_level": string,
  "affected_area": string,
  "suggested_action": string,
  "risks": string,
  "owner_questions": string
}

Avoid guaranteed forecasts, exact price predictions, or automatic buy/sell decisions. Explain uncertainty briefly.

Input:
Title: ${inputTitle || "-"}
Summary: ${inputSummary || "-"}
Raw text: ${inputRawText || "-"}
Source name: ${inputSourceName || "-"}
Source URL: ${inputSourceUrl || "-"}
Existing category: ${inputMarketCategory || "-"}
Country: ${inputCountry}
Business context: ${inputBusinessContext}
`;

    const routerResult = await callAiProviderRouter({
      task: "market_intelligence_analysis",
      prompt,
      jsonMode: true,
      temperature: 0.2,
      expectedJsonShapeDescription: `{
  "summary": string,
  "reasoning": string,
  "market_category": string,
  "impact_direction": string,
  "impact_level": string,
  "confidence_level": string,
  "affected_area": string,
  "suggested_action": string,
  "risks": string,
  "owner_questions": string
}`,
    });

    if (!routerResult.ok) {
      console.error("AI market analysis provider router error:", {
        error: routerResult.error,
        attempts: routerResult.attempts,
      });
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

    return NextResponse.json({
      ok: true,
      provider: routerResult.provider,
      model: routerResult.model,
      analysis: sanitizeAnalysis(routerResult.json),
      raw: routerResult.raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI market analysis error";
    console.error("AI market analysis route error:", message);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not run AI market analysis",
        details: message,
      },
      { status: 500 }
    );
  }
}
