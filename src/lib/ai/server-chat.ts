// Server-routed AI chat (AI chat fix, 2026-11-16).
//
// The browser AI chat used to call the LLM provider router directly
// (the conversation runtime invoked it from client code). That can never
// work from a "use client" page: the router reads server-only env keys
// (GEMINI_API_KEY, OPENAI_API_KEY, GROQ_API_KEY), none of which exist in the
// browser, so every provider yielded zero models and every chat message
// failed with "No configured AI providers…".
//
// This helper is the only thing the browser chat path is allowed to call.
// It POSTs to /api/business-brain, the server route that holds the keys and
// already carries rate limiting, input sanitisation and PII filtering.
// It deliberately never imports the provider router.
//
// Auth (P0-5, 2026-11-16): /api/business-brain now requires a signed-in
// user, so the default transport attaches the browser session's access
// token as a Bearer header. A caller may still inject its own fetch
// (tests do) — an unauthenticated request is answered 401 by the route
// and surfaces here as an honest error.
//
// HYBRID Slice 6: the default transport is cloudFetch, not
// authorizedFetch — on desktop the call goes to the Vercel endpoint
// (the local server has no AI key and would fail every message) with
// the same 60s timeout the chat already had. A network failure still
// surfaces as SERVER_CHAT_UNREACHABLE_ERROR, which the page maps to
// the localized internet-required message.

import type { ChatResponse } from "@/lib/conversation/contracts";
import { cloudFetchAi } from "@/lib/desktop/cloud-endpoint";

export type ServerChatHistoryEntry = {
  role: "user" | "assistant";
  text: string;
};

export type ServerChatInput = {
  message: string;
  organizationName?: string;
  businessContext?: string;
  conversationHistory?: ServerChatHistoryEntry[];
  // The org's books currency (header-selected, e.g. EUR) so the server
  // formats money answers in the currency the UI shows.
  booksCurrency?: string;
};

export type ServerChatResult = {
  ok: boolean;
  message: string;
  provider?: string;
  model?: string;
  error?: string;
};

export const BUSINESS_BRAIN_ENDPOINT = "/api/business-brain";
export const SERVER_CHAT_TIMEOUT_MS = 60000;

/**
 * Network-failure error text (HYBRID Slice 6). The page maps this exact
 * string to the localized `offline.internetRequired` message, so the
 * chat shows "Internet chahiye" instead of a generic failure when the
 * device is offline. Keep the text stable — page.tsx matches on it.
 */
export const SERVER_CHAT_UNREACHABLE_ERROR =
  "Could not reach the AI service. Please check your connection and try again.";

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function chatWithBusinessBrain(
  input: ServerChatInput,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = cloudFetchAi,
): Promise<ServerChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_CHAT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(BUSINESS_BRAIN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        organizationName: input.organizationName ?? "",
        businessContext: input.businessContext ?? "",
        conversationHistory: input.conversationHistory ?? [],
        booksCurrency: input.booksCurrency ?? "",
      }),
      signal: controller.signal,
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data || typeof data !== "object") {
      const serverError =
        data && typeof data === "object" && "error" in data
          ? asNonEmptyString((data as { error?: unknown }).error)
          : undefined;
      return {
        ok: false,
        message: "",
        error:
          serverError ??
          `The AI service returned HTTP ${response.status}. Please try again.`,
      };
    }

    const body = data as {
      ok?: unknown;
      message?: unknown;
      provider?: unknown;
      model?: unknown;
      error?: unknown;
    };
    if (body.ok !== true || typeof body.message !== "string" || !body.message) {
      return {
        ok: false,
        message: "",
        error:
          asNonEmptyString(body.error) ??
          "The AI service returned no answer. Please try again.",
      };
    }

    return {
      ok: true,
      message: body.message,
      provider: asNonEmptyString(body.provider),
      model: asNonEmptyString(body.model),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "", error: "The AI request timed out. Please try again." };
    }
    return {
      ok: false,
      message: "",
      error: SERVER_CHAT_UNREACHABLE_ERROR,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildChatResponse(
  result: ServerChatResult,
  ids: { conversationId: string; correlationId?: string; requestId?: string }
): ChatResponse {
  return {
    version: "1.0",
    correlationId: ids.correlationId ?? generateId("corr"),
    requestId: ids.requestId ?? generateId("req"),
    timestamp: new Date().toISOString(),
    ok: result.ok,
    message: result.ok ? result.message : "",
    conversationId: ids.conversationId,
    provider: result.provider,
    model: result.model,
    error: result.ok ? undefined : result.error ?? "Chat request failed.",
  };
}
