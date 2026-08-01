// ─── Lifecycle Events ─────────────────────────────────────────────────────────

export const ProviderLifecycleEvents = {
  INITIALIZED: "ProviderInitialized",
  STARTED: "ProviderStarted",
  STOPPED: "ProviderStopped",
  DISPOSED: "ProviderDisposed",
} as const;

// ─── Health Events ────────────────────────────────────────────────────────────

export const ProviderHealthEvents = {
  HEALTHY: "ProviderHealthy",
  UNHEALTHY: "ProviderUnhealthy",
  RECOVERED: "ProviderRecovered",
} as const;

// ─── STT Events ───────────────────────────────────────────────────────────────

export const SttEvents = {
  RECOGNITION_STARTED: "RecognitionStarted",
  PARTIAL_TRANSCRIPT: "PartialTranscriptReceived",
  FINAL_TRANSCRIPT: "FinalTranscriptReceived",
  RECOGNITION_STOPPED: "RecognitionStopped",
} as const;

// ─── TTS Events ───────────────────────────────────────────────────────────────

export const TtsEvents = {
  SYNTHESIS_STARTED: "SynthesisStarted",
  AUDIO_CHUNK_PRODUCED: "AudioChunkProduced",
  PLAYBACK_COMPLETED: "PlaybackCompleted",
} as const;

// ─── Transport Events ─────────────────────────────────────────────────────────

export const TransportEvents = {
  CONNECTED: "Connected",
  DISCONNECTED: "Disconnected",
  RECONNECTED: "Reconnected",
  MESSAGE_SENT: "MessageSent",
  MESSAGE_RECEIVED: "MessageReceived",
} as const;

// ─── Error Events ─────────────────────────────────────────────────────────────

export const ProviderErrorEvents = {
  PROVIDER_ERROR: "ProviderError",
  AUTH_FAILED: "AuthenticationFailed",
  TIMEOUT: "TimeoutOccurred",
  CONNECTION_LOST: "ConnectionLost",
} as const;

// ─── Event data map ───────────────────────────────────────────────────────────

export interface ProviderEventDataMap {
  // Lifecycle
  ProviderInitialized: Record<string, never>;
  ProviderStarted: Record<string, never>;
  ProviderStopped: { reason?: string };
  ProviderDisposed: Record<string, never>;

  // Health
  ProviderHealthy: { latencyMs: number };
  ProviderUnhealthy: { error: string };
  ProviderRecovered: Record<string, never>;

  // STT
  RecognitionStarted: { sessionId: string };
  PartialTranscriptReceived: { text: string; confidence: number; isFinal: boolean };
  FinalTranscriptReceived: { text: string; confidence: number };
  RecognitionStopped: { reason?: string };

  // TTS
  SynthesisStarted: { requestId: string };
  AudioChunkProduced: { sequence: number; durationMs: number };
  PlaybackCompleted: { requestId: string };

  // Transport
  Connected: { sessionId: string };
  Disconnected: { reason?: string };
  Reconnected: { sessionId: string };
  MessageSent: { messageId: string };
  MessageReceived: { messageId: string; type: string };

  // Error
  ProviderError: { code: string; message: string };
  AuthenticationFailed: Record<string, never>;
  TimeoutOccurred: { operation: string; timeoutMs: number };
  ConnectionLost: Record<string, never>;
}

export type ProviderEventName = keyof ProviderEventDataMap;

export interface ProviderEvent<T extends ProviderEventName = ProviderEventName> {
  name: T;
  timestamp: Date;
  data: ProviderEventDataMap[T];
  providerId: string;
}

export interface ProviderEventHandler {
  (event: ProviderEvent): void;
}
