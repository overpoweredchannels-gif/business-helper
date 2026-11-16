// History hygiene for the server-routed AI chat (follow-up, 2026-11-16).
//
// Live QA on 947d92d showed the LLM echoing the legacy conversation
// runtime's failure replies ("Sorry, I couldn't process that…",
// "The previous operation failed…", "Please confirm with yes or no.")
// instead of answering from Business Memory. The transport was fine — the
// model was being seeded with poisoned history: the last 10 on-screen
// turns, stored in localStorage, already contained those verbatim runtime
// failure strings from pre-fix attempts, and every send pasted them into
// the prompt as a genuine prior conversation. Each echoed failure was then
// saved and re-sent, so the loop was self-reinforcing.
//
// The route must therefore never trust stored history verbatim: drop any
// user→assistant pair whose assistant reply is a known stale failure /
// confirmation string, drop pairs with no successful answer, and cap the
// history so a long poisoned tail cannot dominate the prompt. This module
// is pure (no Next.js / env imports) so the route and the slice test can
// both import it.

export type ChatHistoryEntry = {
  role: "user" | "assistant";
  text: string;
};

// Verbatim failure / boilerplate replies emitted by the legacy
// conversation runtime (src/lib/ai/conversation-runtime.ts). They are
// stale errors, never real answers — an assistant turn containing one of
// these must never reach the model as history.
export const STALE_ASSISTANT_REPLIES: readonly string[] = [
  "Sorry, I couldn't process that. Can you please rephrase?",
  "The conversation timed out. Please tell me what you'd like to do again.",
  "The previous operation failed. Would you like to try again? Say yes to restart or tell me something else.",
  "Please confirm with yes or no.",
];

// The model is asked to answer from Business Memory, so it only ever
// needs the last few real turns. Six turns (three pairs) is enough for
// follow-ups and small enough that a poisoned tail cannot dominate.
export const MAX_CHAT_HISTORY_TURNS = 6;

export function isStaleAssistantReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Substring match, not exact: presentConfirmation appends the yes/no
  // line to a summary ("…\n\nPlease confirm with yes or no."), so a
  // stale reply can carry extra framing around the known string.
  return STALE_ASSISTANT_REPLIES.some((stale) => trimmed.includes(stale));
}

// Drop every user→assistant pair whose assistant reply is stale (or
// missing), keep only pairs with a real answer, and cap to the last
// maxTurns turns without splitting a pair.
export function cleanChatHistoryForPrompt(
  history: readonly ChatHistoryEntry[],
  maxTurns: number = MAX_CHAT_HISTORY_TURNS,
): ChatHistoryEntry[] {
  const kept: ChatHistoryEntry[] = [];
  let pendingUser: ChatHistoryEntry | null = null;
  for (const entry of history) {
    const text = entry.text.trim();
    if (!text) continue;
    if (entry.role === "user") {
      // A previous user turn with no kept assistant reply is dropped with
      // it: the pair contains no successful answer.
      pendingUser = { role: "user", text };
      continue;
    }
    if (isStaleAssistantReply(text)) {
      // Drop the pair: the question that got a stale failure reply goes
      // with it, so the model never sees the failure voice at all.
      pendingUser = null;
      continue;
    }
    if (pendingUser) kept.push(pendingUser);
    kept.push({ role: "assistant", text });
    pendingUser = null;
  }
  // A trailing user turn with no assistant reply is dropped (pendingUser).

  if (kept.length <= maxTurns) return kept;
  const capped = kept.slice(-maxTurns);
  // If the cut starts on an assistant turn, its question was cut off —
  // drop it so the history never opens mid-pair.
  if (capped[0]?.role === "assistant") capped.shift();
  return capped;
}
