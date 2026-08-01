// ─── Runtime Event Model ────────────────────────────────────────────────────────
// Every event emitted by the Voice Runtime across all categories.

export type RuntimeEventCategory =
  | "speech"
  | "streaming"
  | "dialogue"
  | "provider"
  | "session"
  | "sdk"
  | "telemetry";

// ─── Speech events ──────────────────────────────────────────────────────────────

export const SpeechRuntimeEventNames = {
  LIFECYCLE_INITIALIZED: "speech.initialized",
  LIFECYCLE_STARTED: "speech.started",
  LIFECYCLE_STOPPED: "speech.stopped",
  LIFECYCLE_DISPOSED: "speech.disposed",
  MIC_OPENED: "speech.microphone_opened",
  MIC_CLOSED: "speech.microphone_closed",
  INPUT_STARTED: "speech.input_started",
  INPUT_STOPPED: "speech.input_stopped",
  VAD_SPEECH_DETECTED: "speech.speech_detected",
  VAD_SPEECH_STARTED: "speech.speech_started",
  VAD_SPEECH_ENDED: "speech.speech_ended",
  VAD_SILENCE: "speech.silence_detected",
  STT_PARTIAL: "speech.stt_partial",
  STT_FINAL: "speech.stt_final",
  TTS_STARTED: "speech.tts_started",
  TTS_CHUNK: "speech.tts_chunk",
  PLAYBACK_STARTED: "speech.playback_started",
  PLAYBACK_INTERRUPTED: "speech.playback_interrupted",
  PLAYBACK_COMPLETED: "speech.playback_completed",
  AUDIO_PROCESSED: "speech.audio_processed",
  ERROR: "speech.error",
} as const;

// ─── Streaming events ───────────────────────────────────────────────────────────

export const StreamingRuntimeEventNames = {
  INPUT_CHUNK_RECEIVED: "streaming.input_chunk",
  INPUT_QUEUE_DRAINED: "streaming.input_queue_drained",
  TRANSCRIPT_PARTIAL: "streaming.transcript_partial",
  TRANSCRIPT_FINAL: "streaming.transcript_final",
  RESPONSE_PARTIAL: "streaming.response_partial",
  RESPONSE_COMPLETE: "streaming.response_complete",
  OUTPUT_CHUNK_PRODUCED: "streaming.output_chunk",
  OUTPUT_BUFFER_UNDERRUN: "streaming.output_buffer_underrun",
  BACKPRESSURE_APPLIED: "streaming.backpressure",
  RECONNECTING: "streaming.reconnecting",
  RECONNECTED: "streaming.reconnected",
  LATENCY_SAMPLE: "streaming.latency_sample",
  ERROR: "streaming.error",
} as const;

// ─── Dialogue events ────────────────────────────────────────────────────────────

export const DialogueRuntimeEventNames = {
  TURN_STARTED: "dialogue.turn_started",
  TURN_ENDED: "dialogue.turn_ended",
  TURN_TIMEOUT: "dialogue.turn_timeout",
  CLARIFICATION_REQUESTED: "dialogue.clarification_requested",
  CLARIFICATION_ANSWERED: "dialogue.clarification_answered",
  CONFIRMATION_REQUESTED: "dialogue.confirmation_requested",
  CONFIRMATION_ANSWERED: "dialogue.confirmation_answered",
  INTERRUPTED: "dialogue.interrupted",
  RECOVERY_ATTEMPTED: "dialogue.recovery_attempted",
  RECOVERY_COMPLETED: "dialogue.recovery_completed",
  ERROR: "dialogue.error",
} as const;

// ─── Provider events ────────────────────────────────────────────────────────────

export const ProviderRuntimeEventNames = {
  REGISTERED: "provider.registered",
  INITIALIZED: "provider.initialized",
  STARTED: "provider.started",
  STOPPED: "provider.stopped",
  HEALTHY: "provider.healthy",
  UNHEALTHY: "provider.unhealthy",
  RECOVERED: "provider.recovered",
  FAILOVER_PRIMARY: "provider.failover_to_primary",
  FAILOVER_BACKUP: "provider.failover_to_backup",
  RECONNECTED: "provider.reconnected",
  RECOGNITION_STARTED: "provider.recognition_started",
  RECOGNITION_STOPPED: "provider.recognition_stopped",
  PARTIAL_TRANSCRIPT: "provider.partial_transcript",
  FINAL_TRANSCRIPT: "provider.final_transcript",
  SYNTHESIS_STARTED: "provider.synthesis_started",
  SYNTHESIS_COMPLETED: "provider.synthesis_completed",
  ERROR: "provider.error",
} as const;

// ─── Session events ─────────────────────────────────────────────────────────────

export const SessionRuntimeEventNames = {
  CREATED: "session.created",
  ACTIVATED: "session.activated",
  STARTED: "session.started",
  PAUSED: "session.paused",
  RESUMED: "session.resumed",
  TIMED_OUT: "session.timed_out",
  RECOVERY_ATTEMPTED: "session.recovery_attempted",
  RECOVERY_COMPLETED: "session.recovery_completed",
  ENDED: "session.ended",
  ERROR: "session.error",
} as const;

// ─── SDK events ─────────────────────────────────────────────────────────────────

export const SdkRuntimeEventNames = {
  CREATED: "sdk.created",
  CONFIGURATION_UPDATED: "sdk.configuration_updated",
  PROVIDER_CONFIGURED: "sdk.provider_configured",
  SESSION_STARTED: "sdk.session_started",
  SESSION_ENDED: "sdk.session_ended",
  AUDIO_RECEIVED: "sdk.audio_received",
  GATEWAY_SENT: "sdk.gateway_sent",
  ERROR: "sdk.error",
} as const;

// ─── Telemetry events ───────────────────────────────────────────────────────────

export const TelemetryRuntimeEventNames = {
  LOG: "telemetry.log",
  METRIC: "telemetry.metric",
  SPAN_STARTED: "telemetry.span_started",
  SPAN_ENDED: "telemetry.span_ended",
  PROVIDER_METRIC: "telemetry.provider_metric",
  SESSION_METRIC: "telemetry.session_metric",
  LATENCY_METRIC: "telemetry.latency_metric",
} as const;

// ─── Unified event name + data map ──────────────────────────────────────────────

export interface RuntimeEventDataMap {
  // Speech
  "speech.initialized": { runtimeId: string };
  "speech.started": { runtimeId: string };
  "speech.stopped": { runtimeId: string; reason?: string };
  "speech.disposed": { runtimeId: string };
  "speech.microphone_opened": { deviceId: string };
  "speech.microphone_closed": Record<string, never>;
  "speech.input_started": { chunkSizeBytes: number };
  "speech.input_stopped": { reason?: string };
  "speech.speech_detected": { energy: number };
  "speech.speech_started": Record<string, never>;
  "speech.speech_ended": { reason?: string };
  "speech.silence_detected": { silenceMs: number };
  "speech.stt_partial": { text: string; confidence: number };
  "speech.stt_final": { text: string; confidence: number };
  "speech.tts_started": { requestId: string };
  "speech.tts_chunk": { sequence: number; durationMs: number };
  "speech.playback_started": { requestId: string };
  "speech.playback_interrupted": Record<string, never>;
  "speech.playback_completed": { requestId: string };
  "speech.audio_processed": { sequence: number; energy: number; noiseSuppressed: boolean };
  "speech.error": { code: string; message: string };

  // Streaming
  "streaming.input_chunk": { sequence: number; bytes: number };
  "streaming.input_queue_drained": Record<string, never>;
  "streaming.transcript_partial": { text: string; confidence: number };
  "streaming.transcript_final": { text: string; confidence: number };
  "streaming.response_partial": { text: string };
  "streaming.response_complete": { text: string; durationMs: number };
  "streaming.output_chunk": { sequence: number; durationMs: number };
  "streaming.output_buffer_underrun": { bufferMs: number };
  "streaming.backpressure": { queue: "input" | "output"; size: number; limit: number };
  "streaming.reconnecting": { attempt: number };
  "streaming.reconnected": { attempt: number };
  "streaming.latency_sample": { phase: string; latencyMs: number };
  "streaming.error": { code: string; message: string };

  // Dialogue
  "dialogue.turn_started": { turnId: string; sequence: number };
  "dialogue.turn_ended": { turnId: string; durationMs: number };
  "dialogue.turn_timeout": { turnId: string; timeoutMs: number };
  "dialogue.clarification_requested": { turnId: string; field: string; question: string };
  "dialogue.clarification_answered": { turnId: string; field: string; value: string };
  "dialogue.confirmation_requested": { turnId: string; summary: string };
  "dialogue.confirmation_answered": { turnId: string; confirmed: boolean };
  "dialogue.interrupted": { turnId: string };
  "dialogue.recovery_attempted": { turnId: string; attempt: number; error: string };
  "dialogue.recovery_completed": { turnId: string; attempts: number };
  "dialogue.error": { code: string; message: string };

  // Provider
  "provider.registered": { providerId: string; kind: "stt" | "tts" };
  "provider.initialized": { providerId: string };
  "provider.started": { providerId: string };
  "provider.stopped": { providerId: string; reason?: string };
  "provider.healthy": { providerId: string; latencyMs: number };
  "provider.unhealthy": { providerId: string; error: string };
  "provider.recovered": { providerId: string };
  "provider.failover_to_primary": { providerId: string };
  "provider.failover_to_backup": { providerId: string };
  "provider.reconnected": { providerId: string; attempt: number };
  "provider.recognition_started": { providerId: string; sessionId: string };
  "provider.recognition_stopped": { providerId: string; reason?: string };
  "provider.partial_transcript": { providerId: string; text: string; confidence: number };
  "provider.final_transcript": { providerId: string; text: string; confidence: number };
  "provider.synthesis_started": { providerId: string; requestId: string };
  "provider.synthesis_completed": { providerId: string; requestId: string };
  "provider.error": { providerId: string; code: string; message: string };

  // Session
  "session.created": { sessionId: string };
  "session.activated": { sessionId: string };
  "session.started": { sessionId: string };
  "session.paused": { sessionId: string; reason?: string };
  "session.resumed": { sessionId: string };
  "session.timed_out": { sessionId: string; idleMs: number };
  "session.recovery_attempted": { sessionId: string; error: string };
  "session.recovery_completed": { sessionId: string };
  "session.ended": { sessionId: string; reason?: string };
  "session.error": { sessionId: string; code: string; message: string };

  // SDK
  "sdk.created": { sdkId: string };
  "sdk.configuration_updated": { key: string };
  "sdk.provider_configured": { providerId: string; kind: "stt" | "tts" };
  "sdk.session_started": { sessionId: string };
  "sdk.session_ended": { sessionId: string };
  "sdk.audio_received": { sessionId: string; bytes: number };
  "sdk.gateway_sent": { sessionId: string; messageLength: number };
  "sdk.error": { code: string; message: string };

  // Telemetry
  "telemetry.log": { level: string; source: string; message: string };
  "telemetry.metric": { metric: string; value: number };
  "telemetry.span_started": { spanId: string; name: string };
  "telemetry.span_ended": { spanId: string; name: string; durationMs: number };
  "telemetry.provider_metric": { providerId: string; metric: string; value: number };
  "telemetry.session_metric": { sessionId: string; metric: string; value: number };
  "telemetry.latency_metric": { phase: string; latencyMs: number };
}

export type RuntimeEventName = keyof RuntimeEventDataMap;

export interface VoiceRuntimeEvent<T extends RuntimeEventName = RuntimeEventName> {
  name: T;
  category: RuntimeEventCategory;
  timestamp: Date;
  data: RuntimeEventDataMap[T];
  sessionId?: string;
}

export type VoiceRuntimeEventHandler = (event: VoiceRuntimeEvent) => void;
