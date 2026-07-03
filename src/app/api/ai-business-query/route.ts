import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type BusinessQueryResult = {
  answer: string;
  query_type: string;
  language: string;
  key_points: string[];
  warnings: string[];
};

const temporaryGeminiStatuses = new Set([429, 500, 502, 503, 504]);

const safeText = (value: unknown, maxLength = 4000) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const stripJsonFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const parseResponseText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const extractGeminiText = (rawResponse: any) =>
  safeText(rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text, 12000);

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

const getGeminiErrorDetails = (rawResponse: any) => {
  const message = safeText(rawResponse?.error?.message, 600);
  const status = safeText(rawResponse?.error?.status, 100);
  const code = rawResponse?.error?.code === undefined ? "" : safeText(rawResponse.error.code, 50);
  return [message, status ? `Status: ${status}` : "", code ? `Code: ${code}` : ""]
    .filter(Boolean)
    .join(" | ") || "Gemini returned an error without a readable message.";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callGemini = (model: string, apiKey: string, prompt: string) =>
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
      },
    }),
  });

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

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MARKET_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "AI business query is not configured. Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

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

    let response = await callGemini(model, apiKey, prompt);
    if (temporaryGeminiStatuses.has(response.status)) {
      await sleep(800);
      response = await callGemini(model, apiKey, prompt);
    }

    const rawResponseText = await response.text();
    const rawResponse = parseResponseText(rawResponseText);

    if (!response.ok) {
      const details = getGeminiErrorDetails(rawResponse);
      console.error("Gemini business query error:", { status: response.status, details });
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "Gemini request failed",
          status: response.status,
          details,
        },
        { status: 502 }
      );
    }

    const outputText = extractGeminiText(rawResponse);
    if (!outputText) {
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          error: "Gemini did not return analyzable text.",
          details: "The model returned an empty response. Try shortening or rewording the question.",
        },
        { status: 502 }
      );
    }

    const parsed = parseJsonObject(outputText);
    const fallbackResult = sanitizeResult(
      { answer: outputText, query_type: queryType, language, key_points: [], warnings: ["Model response was not valid JSON, so TradeOS used the text answer."] },
      outputText,
      queryType,
      language
    );
    const result = parsed
      ? sanitizeResult(parsed, outputText, queryType, language)
      : fallbackResult;

    return NextResponse.json({
      ok: true,
      provider: "gemini",
      model,
      result,
      raw: rawResponse,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown Gemini connection error";
    console.error("Gemini business query route error:", details);
    return NextResponse.json(
      {
        ok: false,
        provider: "gemini",
        error: "Could not connect to Gemini API",
        details,
      },
      { status: 500 }
    );
  }
}
