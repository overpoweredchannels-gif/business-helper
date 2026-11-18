/**
 * Voice Command (P1 Area J) — Unit Tests.
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
 * functions — mic start/stop, live listening state, transcript preview
 * + captured input, Send, the operator's reply / loading / error, and
 * the session/message history. The section-routing and listening state
 * machine live in `src/lib/ai/voice-operator.ts` as pure helpers, and
 * page.tsx imports and uses them (no mirroring). The other three AI
 * sections (ai-analytics, ai-business-query, ai-assistant) still render
 * `<AIAssistant>` exactly as before.
 *
 * Run: npx tsx scripts/test-voice-command.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accumulateVoiceTranscript,
  aiSectionKind,
  floatingAiDestination,
  voiceListenEndOutcome,
  voiceListenStartDecision,
  voiceOperatorCleanupOnLeave,
} from "../src/lib/ai/voice-operator";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function main(): void {
  // --- (a) Section routing: only ai-voice-operator renders the voice UI. ---
  console.log("Section routing (aiSectionKind):");
  check(aiSectionKind("ai-voice-operator") === "voice", "(a) ai-voice-operator renders the voice UI");
  check(aiSectionKind("ai-analytics") === "chat", "(a) ai-analytics still renders text chat");
  check(aiSectionKind("ai-business-query") === "chat", "(a) ai-business-query still renders text chat");
  check(aiSectionKind("ai-assistant") === "chat", "(a) ai-assistant still renders text chat");
  check(aiSectionKind("dashboard") === "other", "(a) unrelated section is neither voice nor chat");
  check(aiSectionKind("") === "other", "(a) empty section id is neither voice nor chat");

  // --- (c) FloatingAI routing: voice and chat go to distinct sections. ---
  console.log("FloatingAI routing (floatingAiDestination):");
  check(
    floatingAiDestination("voice") === "ai-voice-operator",
    "(c) FloatingAI Voice Command routes to ai-voice-operator",
  );
  check(
    floatingAiDestination("chat") === "ai-assistant",
    "(c) FloatingAI AI Chat routes to ai-assistant",
  );
  check(
    floatingAiDestination("voice") !== floatingAiDestination("chat"),
    "(c) voice and chat destinations are distinct (the old bug routed both to the same text chat)",
  );

  // --- (d) Listen-start guard: no SpeechRecognition ⇒ honest error, never a crash. ---
  console.log("Listen-start decision (voiceListenStartDecision):");
  check(
    voiceListenStartDecision(false) === "not-supported",
    "(d) no SpeechRecognition constructor => 'not-supported' (UI shows the honest error)",
  );
  check(
    voiceListenStartDecision(true) === "start",
    "(d) SpeechRecognition present => 'start'",
  );

  // --- (e) Transcript flow: interim preview, final captured. ---
  console.log("Transcript flow (accumulateVoiceTranscript / voiceListenEndOutcome):");
  const interimOnly = accumulateVoiceTranscript([{ transcript: "show my ", isFinal: false }]);
  check(interimOnly.transcript === "show my", "(e) interim result feeds the live preview");
  check(interimOnly.finalTranscript === "", "(e) interim result is NOT captured as a final command");
  const mixed = accumulateVoiceTranscript([
    { transcript: "show my ", isFinal: false },
    { transcript: "daily briefing", isFinal: true },
  ]);
  check(mixed.transcript === "show my daily briefing", "(e) mixed results accumulate the full transcript");
  check(mixed.finalTranscript === "daily briefing", "(e) only final results are captured");
  const empty = accumulateVoiceTranscript([]);
  check(empty.transcript === "" && empty.finalTranscript === "", "(e) no results => empty transcripts");
  const whitespace = accumulateVoiceTranscript([{ transcript: "   ", isFinal: true }]);
  check(whitespace.transcript === "" && whitespace.finalTranscript === "", "(e) whitespace-only transcript trims to empty");

  const autoSend = voiceListenEndOutcome({
    finalTranscript: "daily briefing",
    preview: "",
    input: "",
    autoSendEnabled: true,
  });
  check(
    autoSend.action === "schedule-auto-send" && autoSend.transcript === "daily briefing",
    "(e) auto-send on + transcript => schedule-auto-send with the captured text",
  );
  const captured = voiceListenEndOutcome({
    finalTranscript: "",
    preview: "check stock",
    input: "",
    autoSendEnabled: false,
  });
  check(
    captured.action === "captured",
    "(e) auto-send off + preview text => 'captured' (user sends it manually)",
  );
  const emptyEnd = voiceListenEndOutcome({
    finalTranscript: "",
    preview: "",
    input: "",
    autoSendEnabled: true,
  });
  check(
    emptyEnd.action === "ended-empty",
    "(e) auto-send on but nothing heard => 'ended-empty' (no phantom send)",
  );
  const inputFallback = voiceListenEndOutcome({
    finalTranscript: "",
    preview: "",
    input: "typed command",
    autoSendEnabled: true,
  });
  check(
    inputFallback.action === "schedule-auto-send" && inputFallback.transcript === "typed command",
    "(e) no transcript, typed input present => input is the send text",
  );
  const precedence = voiceListenEndOutcome({
    finalTranscript: "final wins",
    preview: "preview loses",
    input: "input loses",
    autoSendEnabled: false,
  });
  check(
    precedence.action === "captured",
    "(e) final transcript takes precedence over preview and input",
  );

  // --- (f) Leave-section cleanup: leaving stops listening/speaking. ---
  console.log("Leave-section cleanup (voiceOperatorCleanupOnLeave):");
  check(
    voiceOperatorCleanupOnLeave("ai-voice-operator") === false,
    "(f) staying on the voice operator does NOT stop listening",
  );
  check(
    voiceOperatorCleanupOnLeave("ai-assistant") === true,
    "(f) leaving to ai-assistant stops listening/speaking",
  );
  check(
    voiceOperatorCleanupOnLeave("dashboard") === true,
    "(f) leaving to any other section stops listening/speaking",
  );

  // --- Source assertions on the real page.tsx. ---
  console.log("page.tsx wiring:");
  const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  check(
    pageSource.includes(
      'import { accumulateVoiceTranscript, aiSectionKind, floatingAiDestination, voiceListenEndOutcome, voiceListenStartDecision, voiceOperatorCleanupOnLeave, type VoiceRecognitionResult } from "@/lib/ai/voice-operator";',
    ),
    "page.tsx imports the voice-operator helpers",
  );
  check(
    pageSource.includes('import { AiVoiceOperator } from "@/components/ai/AiVoiceOperator";'),
    "page.tsx imports the AiVoiceOperator component",
  );

  const aiBlockStart = pageSource.indexOf('activeSection === "ai-voice-operator"');
  const staffDutyStart = pageSource.indexOf('activeSection === "staff-duty"', aiBlockStart);
  check(aiBlockStart >= 0 && staffDutyStart > aiBlockStart, "AI sections block exists before the staff-duty section");
  const aiBlock = pageSource.slice(aiBlockStart, staffDutyStart);
  check(aiBlock.includes('activeSection === "ai-analytics"'), "(b) ai-analytics still opens the AI section");
  check(aiBlock.includes('activeSection === "ai-business-query"'), "(b) ai-business-query still opens the AI section");
  check(aiBlock.includes('activeSection === "ai-assistant"'), "(b) ai-assistant still opens the AI section");
  check(aiBlock.includes('aiSectionKind(activeSection) === "voice"'), "(a) the voice branch is gated on aiSectionKind === 'voice'");
  check(aiBlock.includes("<AiVoiceOperator"), "(a) ai-voice-operator renders <AiVoiceOperator>");
  check(aiBlock.includes("<AIAssistant"), "(b) the other three AI sections still render <AIAssistant>");
  check(
    aiBlock.indexOf("<AiVoiceOperator") < aiBlock.indexOf("<AIAssistant"),
    "(a) the voice render is the first branch — the voice section never falls through to text chat",
  );

  check(
    pageSource.includes('onAiVoice={() => handleSectionChange(floatingAiDestination("voice"))}'),
    "(c) FloatingAI onAiVoice routes via floatingAiDestination('voice')",
  );
  check(
    pageSource.includes('onAiChat={() => handleSectionChange(floatingAiDestination("chat"))}'),
    "(c) FloatingAI onAiChat routes via floatingAiDestination('chat')",
  );

  const cleanupStart = pageSource.indexOf("if (voiceOperatorCleanupOnLeave(sectionId)) {");
  check(cleanupStart >= 0, "(f) handleSectionChange uses voiceOperatorCleanupOnLeave");
  const cleanupBlock = pageSource.slice(cleanupStart, cleanupStart + 400);
  check(cleanupBlock.includes("stopAiVoiceListening();"), "(f) leave-section cleanup stops listening");
  check(cleanupBlock.includes("stopAiVoiceOperatorReply();"), "(f) leave-section cleanup stops the spoken reply");
  check(cleanupBlock.includes("cancelAiVoiceAutoSend("), "(f) leave-section cleanup cancels any pending auto-send");
  check(
    !pageSource.includes('if (sectionId !== "ai-voice-operator") {'),
    "(f) the old inline cleanup condition is gone (single helper owns the rule)",
  );

  check(
    pageSource.includes("voiceListenStartDecision("),
    "(d) startAiVoiceListening consults voiceListenStartDecision",
  );
  check(
    pageSource.includes("accumulateVoiceTranscript("),
    "(e) the onresult handler accumulates transcripts via accumulateVoiceTranscript",
  );
  check(
    pageSource.includes("voiceListenEndOutcome("),
    "(e) the onend handler decides the outcome via voiceListenEndOutcome",
  );

  // --- Source assertions on the real FloatingAI component. ---
  console.log("FloatingAI component:");
  const floatingSource = readFileSync(
    new URL("../src/components/dashboard/FloatingAI.tsx", import.meta.url),
    "utf8",
  );
  const voiceItemStart = floatingSource.indexOf("Voice Command");
  const chatItemStart = floatingSource.indexOf("AI Chat");
  check(voiceItemStart >= 0 && chatItemStart > voiceItemStart, "FloatingAI has Voice Command and AI Chat items");
  const onVoiceAt = floatingSource.indexOf("onVoice?.()");
  const onChatAt = floatingSource.indexOf("onChat?.()");
  check(onVoiceAt >= 0 && onVoiceAt < voiceItemStart, "Voice Command item calls onVoice");
  check(
    onChatAt > voiceItemStart && onChatAt < chatItemStart,
    "AI Chat item calls onChat (and the Voice Command item does not)",
  );

  // --- Source assertions on the real AiVoiceOperator component. ---
  console.log("AiVoiceOperator component:");
  const componentSource = readFileSync(
    new URL("../src/components/ai/AiVoiceOperator.tsx", import.meta.url),
    "utf8",
  );
  check(!componentSource.includes("AIAssistant"), "voice operator component never renders the text chat");
  check(
    componentSource.includes("onClick={props.isListening ? props.onStopListening : props.onStartListening}"),
    "mic control toggles start/stop listening",
  );
  check(
    componentSource.includes("ai.voiceOperator.startListening") &&
      componentSource.includes("ai.voiceOperator.stopListening"),
    "mic control has a start/stop listening label",
  );
  check(
    componentSource.includes("props.operatorError") && componentSource.includes('role="alert"'),
    "operator error is rendered as an alert (the 'not supported' error is shown, not swallowed)",
  );
  check(
    componentSource.includes("props.transcriptPreview"),
    "live transcript preview is rendered",
  );
  check(
    componentSource.includes("props.onSend()"),
    "Send action calls the operator send handler",
  );
  check(
    componentSource.includes("props.messages.map"),
    "operator session/message history is rendered",
  );
  check(
    componentSource.includes("props.sessions.map"),
    "operator sessions are listed for selection",
  );
  check(
    componentSource.includes("props.isListening") && componentSource.includes("page.aiListening"),
    "live listening state is shown",
  );
  check(
    componentSource.includes("inputRef.current = node"),
    "the passed input ref is attached via a callback ref (page.tsx can focus the input; no ref read during render)",
  );
  check(
    componentSource.includes("min-h-11 min-w-11"),
    "mic/send controls are 44px targets",
  );
  check(
    !componentSource.includes("#") || !/#[0-9a-fA-F]{3,6}\b/.test(componentSource),
    "component uses design-system tokens only (no hex colours)",
  );

  // --- Translation keys exist in all four locales. ---
  console.log("Translation keys (en/es/it/ur):");
  const messagesSource = readFileSync(
    new URL("../src/lib/regional/messages.ts", import.meta.url),
    "utf8",
  );
  const voiceKeys = [
    "ai.voiceOperator.title",
    "ai.voiceOperator.startListening",
    "ai.voiceOperator.stopListening",
    "ai.voiceOperator.inputPlaceholder",
    "ai.voiceOperator.send",
    "ai.voiceOperator.historyTitle",
    "ai.voiceOperator.sessionsTitle",
    "ai.voiceOperator.newSession",
    "ai.voiceOperator.emptyHint",
    "ai.voiceOperator.autoSpeak",
    "ai.voiceOperator.autoSend",
    "ai.voiceOperator.language",
    "ai.voiceOperator.languageAuto",
    "ai.voiceOperator.languageEnglish",
    "ai.voiceOperator.languageUrdu",
    "ai.voiceOperator.languageRomanUrdu",
    "ai.voiceOperator.stopReply",
    "ai.voiceOperator.speaking",
    "ai.voiceOperator.transcriptLabel",
    "ai.voiceOperator.cancelAutoSend",
    "ai.voiceOperator.editBeforeSend",
  ];
  for (const key of voiceKeys) {
    check(
      countOccurrences(messagesSource, `'${key}':`) === 4,
      `key '${key}' exists in all 4 locales`,
    );
  }

  console.log(`\nAll ${passed} Voice Command checks passed.\n`);
}

main();
