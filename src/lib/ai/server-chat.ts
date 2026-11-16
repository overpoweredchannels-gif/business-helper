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

import type { ChatResponse } from "@/lib/conversation/contracts";

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

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function chatWithBusinessBrain(
  input: ServerChatInput,
  fetchImpl: typeof fetch = fetch
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
      error: "Could not reach the AI service. Please check your connection and try again.",
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
