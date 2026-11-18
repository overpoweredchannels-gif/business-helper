/**
 * AI Voice Operator (P1 Area J) — pure helpers.
 *
 * Defect (tracker Area J line 135): the FloatingAI "Voice Command" menu
 * item was a dead end — it navigated to the ai-voice-operator section,
 * which rendered the same text-chat `<AIAssistant>` as the AI Chat item,
 * with no voice capability at all. The voice pipeline itself (Speech
 * Recognition + spoken replies + intent routing + operator sessions) was
 * fully built in page.tsx; only the UI to drive it was missing.
 *
 * Fix: the ai-voice-operator section renders a real Voice Operator UI
 * (`src/components/ai/AiVoiceOperator.tsx`) wired to the existing
 * functions. These helpers are the testable core of that wiring:
 * which section renders the voice UI, where each FloatingAI item goes,
 * the listen-start guard, the transcript accumulation from recognition
 * results, the listen-end outcome, and the leave-section cleanup rule.
 * page.tsx imports and uses every helper below — nothing here is a
 * mirror copy.
 */

/** Which UI an AI section renders. */
export type AiSectionKind = "voice" | "chat" | "other";

export function aiSectionKind(sectionId: string): AiSectionKind {
  if (sectionId === "ai-voice-operator") return "voice";
  if (
    sectionId === "ai-analytics" ||
    sectionId === "ai-business-query" ||
    sectionId === "ai-assistant"
  ) {
    return "chat";
  }
  return "other";
}

/** Where each FloatingAI menu item navigates. Voice and chat go to
 * distinct sections — the old bug routed both to the same text chat. */
export function floatingAiDestination(
  item: "voice" | "chat",
): "ai-voice-operator" | "ai-assistant" {
  return item === "voice" ? "ai-voice-operator" : "ai-assistant";
}

/** Listen-start decision. Without a SpeechRecognition constructor the
 * operator must surface the honest "not supported" error — never crash,
 * never listen silently. */
export type VoiceListenStartDecision = "start" | "not-supported";

export function voiceListenStartDecision(
  hasRecognition: boolean,
): VoiceListenStartDecision {
  return hasRecognition ? "start" : "not-supported";
}

/** One recognition result, as the browser reports it. */
export interface VoiceRecognitionResult {
  transcript: string;
  isFinal: boolean;
}

/**
 * Accumulate the running + final transcript from recognition results
 * (the onresult handler's loop). Interim results feed the live preview;
 * only final results are kept as the captured command.
 */
export function accumulateVoiceTranscript(results: VoiceRecognitionResult[]): {
  transcript: string;
  finalTranscript: string;
} {
  let transcript = "";
  let finalTranscript = "";
  for (const result of results) {
    transcript += result.transcript;
    if (result.isFinal) finalTranscript += result.transcript;
  }
  return { transcript: transcript.trim(), finalTranscript: finalTranscript.trim() };
}

/** What happens when listening ends (the onend handler's rule). */
export type VoiceListenEndOutcome =
  | { action: "schedule-auto-send"; transcript: string }
  | { action: "captured" }
  | { action: "ended-empty" };

export function voiceListenEndOutcome(args: {
  finalTranscript: string;
  preview: string;
  input: string;
  autoSendEnabled: boolean;
}): VoiceListenEndOutcome {
  const transcript = (args.finalTranscript || args.preview || args.input).trim();
  if (args.autoSendEnabled && transcript) {
    return { action: "schedule-auto-send", transcript };
  }
  if (transcript) return { action: "captured" };
  return { action: "ended-empty" };
}

/**
 * Leave-section cleanup rule (handleSectionChange): leaving any section
 * other than the voice operator stops listening and cancels the spoken
 * reply and any pending auto-send. Staying on the operator never stops
 * it.
 */
export function voiceOperatorCleanupOnLeave(sectionId: string): boolean {
  return sectionId !== "ai-voice-operator";
}
