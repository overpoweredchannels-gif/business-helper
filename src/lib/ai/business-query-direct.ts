/**
 * Business Query direct answer (P1 Area J) — pure helpers.
 *
 * Defect: a classified `business_query` was driven through the
 * create-action gauntlet in `handleNewIntent`
 * (src/lib/ai/conversation-runtime.ts). Its schema requires the field
 * `question`, but nothing in the entity-filling block ever fills it —
 * the user's raw message IS the question, yet it was never stored —
 * so `getNextRequiredField` returned "question" and the user was asked
 * "What would you like to know about your business?" and had to REPEAT
 * the question. Then `getMissingRequiredFields` also returned the
 * missing OPTIONAL fields, so the user was interrogated for language,
 * query_type and date_range. Only then did `presentConfirmation` fire:
 * "Ask Business Question: ... Please confirm with yes or no." — for a
 * question that needs no confirmation at all. Worse, confirming never
 * produced an answer: `executeBusinessQuery` maps to "TODO"
 * (EXECUTION_FUNCTIONS, conversation-engine.ts) and `executeAction`
 * has no `business_query` branch, so a "yes" fell through to the
 * generic "Done! What would you like to do next?" with no answer.
 *
 * Fix: `handleNewIntent` answers a classified `business_query`
 * DIRECTLY, following the `inventory_query` / `staff_query` /
 * `location_query` early-return pattern in the same function — the raw
 * message is the question, the answer comes from the runtime's existing
 * business-chat path (`callAiProviderRouter`, task "business_chat",
 * grounded on the store's business context, the same transport
 * `fallbackToChat` already uses for unknown intents), and the session
 * returns to idle with actionType null. No field collection, no
 * confirmation. The classifier's detected language is preserved into
 * the prompt so Roman Urdu / Urdu questions get answers in kind.
 *
 * Why not the server route /api/ai-business-query here: that route is
 * the answering path for the voice operator and the ai-business-query
 * section, but it answers from a structured `business_summary` built
 * by page-local helpers (`buildAiBusinessSummary` and friends live
 * only in page.tsx) — the runtime has no structured summary, and
 * calling the route with an empty summary would produce ungrounded
 * "not available" answers. The runtime is also transport-agnostic
 * (it runs in the browser via bootstrap AND on the server via
 * /api/conversation/chat → gateway), so it must not depend on the
 * browser-only `authorizedFetch`. Its established answering primitive
 * in both contexts is `callAiProviderRouter`, which is what this fix
 * reuses. The voice operator path is unaffected — it never used this
 * runtime (regex intent + `runAiBusinessQueryFromOperator`).
 *
 * Deliberately NOT fixed here: `market_intelligence` has the same
 * class of bug (required title/raw_text + confirmation, and
 * `executeAction` has no market_intelligence branch either) — it is a
 * separate tracker item.
 *
 * The `business_query` schema (`requiredFields: ["question"]`) is
 * left untouched: the runtime simply never routes a business question
 * through field collection any more, exactly like the other direct-
 * answer `*_query` intents.
 */

import type { ActionType } from "./conversation-engine";
import { resolveAiCurrency } from "./ai-money";

export type BusinessQueryLanguage = "auto" | "english" | "urdu" | "roman_urdu";

/** A classified business question is answered directly, never confirmed. */
export function shouldAnswerBusinessQueryDirectly(intent: ActionType | string): boolean {
  return intent === "business_query";
}

/**
 * The user's raw message IS the question — trimmed, never re-asked.
 * Returns null for a blank message so the caller can fall back to the
 * honest "couldn't process that" path instead of the field gauntlet.
 */
export function resolveBusinessQueryQuestion(message: string): string | null {
  const question = message.trim();
  return question.length > 0 ? question : null;
}

/** Normalise a classifier language value to the prompt's language set. */
export function resolveBusinessQueryLanguage(language: unknown): BusinessQueryLanguage {
  if (language === "urdu") return "urdu";
  if (language === "roman_urdu") return "roman_urdu";
  if (language === "english") return "english";
  return "auto";
}

/** One prompt line steering the reply language; "auto" mirrors the question. */
export function businessQueryLanguageLine(language: BusinessQueryLanguage): string {
  if (language === "urdu") return "Reply in Urdu.";
  if (language === "roman_urdu") return "Reply in Roman Urdu (Urdu written in Latin letters).";
  if (language === "english") return "Reply in English.";
  return "Reply in the same language style as the question.";
}

/**
 * Prompt for the direct business-question answer. Mirrors the prompt
 * `fallbackToChat` (conversation-runtime.ts) already uses for unknown
 * intents, plus the detected-language line.
 */

export function buildBusinessQueryDirectPrompt(input: {
  question: string;
  language: BusinessQueryLanguage;
  businessContext: string;
  history: string;
  currency?: unknown;
}): string {
  return [
    `You are the AI assistant for a Pakistani retail/wholesale business called Aankh.`,
    `Answer the user's question concisely using the business context below.`,
    `If the user greets you, greet back and ask how you can help.`,
    `Use ${resolveAiCurrency(input.currency)} currency formatting.`,
    businessQueryLanguageLine(input.language),
    ``,
    `BUSINESS CONTEXT:`,
    input.businessContext || "(No business data loaded)",
    ``,
    input.history ? `RECENT CONVERSATION:\n${input.history}\n` : "",
    `USER: ${input.question}`,
    ``,
    `You can help with: creating sales, purchases, expenses, checking analytics, inventory status, etc.`,
    `If the user wants to create something, guide them to provide the details.`,
    `Response:`,
  ].join("\n");
}
