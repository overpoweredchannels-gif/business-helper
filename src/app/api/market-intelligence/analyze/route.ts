import { NextRequest, NextResponse } from "next/server";

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

const extractGeminiResponseText = (rawResponse: any) =>
  safeText(rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text);

const stripJsonFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const parseJsonObject = (text: string) => {
  const cleanText = stripJsonFences(text);
  try {
    return JSON.parse(cleanText);
  } catch {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseResponseText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const getGeminiErrorDetails = (rawResponse: any) => {
  const message = safeLimitedText(rawResponse?.error?.message, 600);
  const status = safeLimitedText(rawResponse?.error?.status, 100);
  const code = rawResponse?.error?.code === undefined ? "" : safeLimitedText(rawResponse.error.code, 50);
  const parts = [
    message,
    status ? `Status: ${status}` : "",
    code ? `Code: ${code}` : "",
  ].filter(Boolean);
  return parts.join(" | ") || "Gemini returned an error without a readable message.";
};

const callGemini = async (model: string, apiKey: string, prompt: string) =>
  fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

const temporaryGeminiStatuses = new Set([429, 500, 502, 503, 504]);

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
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MARKET_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "AI analysis is not configured. Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

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
          provider: "gemini",
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

    let response = await callGemini(model, apiKey, prompt);
    if (temporaryGeminiStatuses.has(response.status)) {
      await sleep(800);
      response = await callGemini(model, apiKey, prompt);
    }

    const rawResponseText = await response.text();
    const rawResponse = parseResponseText(rawResponseText);

    if (!response.ok) {
      const safeDetails = getGeminiErrorDetails(rawResponse);
      console.error("Gemini market analysis error:", {
        status: response.status,
        details: safeDetails,
      });
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "Gemini request failed",
          status: response.status,
          details: safeDetails,
        },
        { status: 502 }
      );
    }

    const firstCandidate = rawResponse?.candidates?.[0];
    const finishReason = safeText(firstCandidate?.finishReason);
    if (!firstCandidate || ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION"].includes(finishReason)) {
      console.error("Gemini market analysis empty or blocked response:", {
        finishReason: finishReason || "missing_candidate",
      });
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "Gemini did not return analyzable text.",
          details: "The model returned an empty or blocked response. Try shortening or rewording the item.",
        },
        { status: 502 }
      );
    }

    const outputText = extractGeminiResponseText(rawResponse);
    if (!outputText) {
      console.error("Gemini market analysis missing text:", { finishReason: finishReason || "unknown" });
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "Gemini did not return analyzable text.",
          details: "The model returned an empty or blocked response. Try shortening or rewording the item.",
        },
        { status: 502 }
      );
    }

    const parsed = parseJsonObject(outputText);
    if (!parsed) {
      console.error("Gemini market analysis parse error:", { outputText, rawResponse });
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "AI response could not be parsed",
          details: "Gemini returned a response that was not valid JSON.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      provider: "gemini",
      model,
      analysis: sanitizeAnalysis(parsed),
      raw: rawResponse,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gemini connection error";
    console.error("Gemini market analysis route error:", message);
    return NextResponse.json(
      {
        ok: false,
        provider: "gemini",
        error: "Could not connect to Gemini API",
        details: message,
      },
      { status: 500 }
    );
  }
}
