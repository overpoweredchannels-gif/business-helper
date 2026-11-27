import { NextRequest, NextResponse } from "next/server";
import { callAiProviderRouter } from "@/lib/ai/provider-router";
import { aiCurrencyPromptLine } from "@/lib/ai/ai-money";
import { LIVE_MATCH_INSTRUCTION } from "@/lib/ai/entity-match";
import { liveEntityContext } from "@/lib/ai/live-entity-context";
import { cleanChatHistoryForPrompt } from "@/lib/ai/chat-history-hygiene";
import { sanitizeMessage, sanitizeHistory } from "@/lib/brain/sanitize";
import { checkRateLimit } from "@/lib/brain/rate-limit";
import { logPiiSafe, filterResponse } from "@/lib/brain/pii-filter";
import { requireAuthenticatedOrg } from "@/lib/identity/authorization";
import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";

export const runtime = "nodejs";
// The provider router times out a single attempt after 20s by default;
// Vercel's 10s Hobby default would kill the function first. Give the
// route room to finish (and to fail honestly) instead.
export const maxDuration = 60;

// HYBRID Slice 6: the desktop calls this CLOUD route on the Vercel
// endpoint (cloudFetch), so preflight + CORS for the loopback desktop
// origin — same pattern as provision / staff/me / purchases.
export async function OPTIONS(req: NextRequest) {
  return desktopPreflightResponse(req, "POST");
}

export async function POST(req: NextRequest) {
  return applyCors(await runPost(req), corsHeadersFor(req));
}

async function runPost(req: NextRequest) {
  try {
    // Auth first (P0-5): this route spends LLM calls and reads business
    // data, so it must never answer an unauthenticated request. Any
    // signed-in user with an org (owner or staff) may chat; the browser
    // sends its session token via authorizedFetch.
    const auth = await requireAuthenticatedOrg(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

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
    // Books currency drives money formatting in the answer (the org's
    // header-selected currency, e.g. EUR — never a hardcoded PKR).
    const currencyInstruction = aiCurrencyPromptLine(body.booksCurrency);

    const sanitized = sanitizeMessage(body.message);
    if (!sanitized.ok) {
      return NextResponse.json({ ok: false, error: sanitized.error }, { status: 400 });
    }
    const message = sanitized.cleaned;
    const sanitizedHistory = sanitizeHistory(conversationHistory);
    const live = await liveEntityContext(message, auth.actor.organizationId, String(body.booksCurrency ?? ""), true, sanitizedHistory);
    if (live.reply) return NextResponse.json({ ok: true, message: filterResponse(live.reply), provider: "live_catalogue" });
    // History hygiene (2026-11-16): stored history can contain the legacy
    // runtime's verbatim failure replies ("Sorry, I couldn't process
    // that…", "The previous operation failed…", "Please confirm with yes
    // or no."). Pasted verbatim into the prompt, the model continues that
    // failure voice instead of answering from Business Memory — and each
    // echoed failure is saved and re-sent, so the loop self-reinforces.
    // Drop every pair with no real answer before building the prompt.
    const cleanHistory = cleanChatHistoryForPrompt(sanitizedHistory);

    const historyBlock = cleanHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const prompt = [
      `You are the AI assistant for the business "${body.organizationName || "Aankh"}" running inside Aankh — a Pakistani retail/wholesale ERP system.`,
      ``,
      `Answer business questions using the live entity search results and Business Memory context below.`,
      `Use the current KPI block for the totals it covers, even when older memory or conversation history differs.`,
      LIVE_MATCH_INSTRUCTION,
      `Never fabricate numbers. If the context lacks data, say so.`,
      `Sale confirmations are rendered by the live catalogue flow. Never compose, repeat, or ask the user to approve a sale confirmation. If a sale needs clarification, ask the user to restate the full sale request.`,
      `Ignore stale error messages and timeouts in history. Answer the current question using the supplied context and live search results.`,
      `Keep answers concise (2–5 sentences unless a detailed breakdown is asked).`,
      currencyInstruction,
      `If the user greets you, greet back briefly and offer to help.`,
      ``,
      `─── BUSINESS MEMORY CONTEXT ───`,
      businessContext || "(Business Memory is empty — no data loaded yet.)",
      live.block,
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
        { ok: false, error: result.error || "AI provider returned no response.", attempts: result.attempts },
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
