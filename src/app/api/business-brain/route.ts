import { NextRequest, NextResponse } from "next/server";
import { callAiProviderRouter } from "@/lib/ai/provider-router";
import { sanitizeMessage, sanitizeHistory } from "@/lib/brain/sanitize";
import { checkRateLimit } from "@/lib/brain/rate-limit";
import { logPiiSafe, filterResponse } from "@/lib/brain/pii-filter";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`brain_chat_${ip}`);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: `Rate limit exceeded. Try again in ${Math.ceil((rl.resetAt - Date.now()) / 1000)}s.` },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const body = await req.json();
    const businessContext: string = String(body.businessContext ?? "").trim();
    const conversationHistory: Array<{ role: "user" | "assistant"; text: string }> = body.conversationHistory ?? [];

    const sanitized = sanitizeMessage(body.message);
    if (!sanitized.ok) {
      return NextResponse.json({ ok: false, error: sanitized.error }, { status: 400 });
    }
    const message = sanitized.cleaned;
    const cleanHistory = sanitizeHistory(conversationHistory);

    const historyBlock = cleanHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const prompt = [
      `You are the AI assistant for the business "${body.organizationName || "TradeOS"}" running inside TradeOS — a Pakistani retail/wholesale ERP system.`,
      ``,
      `Your role: Answer business questions using ONLY the Business Memory context below.`,
      `You have NO access to live data — everything you know is in the context.`,
      `Never fabricate numbers. If the context lacks data, say so.`,
      `Keep answers concise (2–5 sentences unless a detailed breakdown is asked).`,
      `Use PKR currency formatting.`,
      `If the user greets you, greet back briefly and offer to help.`,
      ``,
      `─── BUSINESS MEMORY CONTEXT ───`,
      businessContext || "(Business Memory is empty — no data loaded yet.)",
      ``,
      historyBlock ? `─── RECENT CONVERSATION ───\n${historyBlock}\n` : "",
      `─── USER MESSAGE ───`,
      message,
      ``,
      `Answer:`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await callAiProviderRouter({
      task: "business_chat",
      prompt,
      temperature: 0.3,
    });

    if (!result.ok || !result.text) {
      logPiiSafe("warn", "ai_response_empty", "AI provider returned empty response", { provider: result.provider });
      return NextResponse.json(
        { ok: false, error: result.error || "AI provider returned no response." },
        { status: 502 }
      );
    }

    const filteredMessage = filterResponse(result.text);
    logPiiSafe("info", "chat_success", "Chat completed", {
      messageLength: message.length,
      responseLength: filteredMessage.length,
      provider: result.provider,
    });

    return NextResponse.json({
      ok: true,
      message: filteredMessage,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    logPiiSafe("error", "chat_error", "Chat endpoint error", { error: err instanceof Error ? err.message : "Unknown" });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
