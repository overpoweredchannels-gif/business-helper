// ─── Lifecycle Events ─────────────────────────────────────────────────────────

export const SpeechLifecycleEvents = {
  INITIALIZED: "SpeechRuntimeInitialized",
  STARTED: "SpeechRuntimeStarted",
  STOPPED: "SpeechRuntimeStopped",
  DISPOSED: "SpeechRuntimeDisposed",
} as const;

// ─── Audio Input Events ───────────────────────────────────────────────────────

export const AudioInputEvents = {
  MICROPHONE_OPENED: "MicrophoneOpened",
  MICROPHONE_CLOSED: "MicrophoneClosed",
  INPUT_STARTED: "AudioInputStarted",
  INPUT_STOPPED: "AudioInputStopped",
} as const;

// ─── Recognition Events ───────────────────────────────────────────────────────

export const RecognitionEvents = {
  SPEECH_DETECTED: "SpeechDetected",
  SPEECH_STARTED: "SpeechStarted",
  PARTIAL_TRANSCRIPT: "PartialTranscriptReceived",
  FINAL_TRANSCRIPT: "FinalTranscriptReceived",
  SPEECH_ENDED: "SpeechEnded",
} as const;

// ─── Playback Events ──────────────────────────────────────────────────────────

export const PlaybackEvents = {
  STARTED: "PlaybackStarted",
  PAUSED: "PlaybackPaused",
  RESUMED: "PlaybackResumed",
  INTERRUPTED: "PlaybackInterrupted",
  COMPLETED: "PlaybackCompleted",
} as const;

// ─── Provider Events ──────────────────────────────────────────────────────────

export const ProviderEvents = {
  STT_CONNECTED: "STTProviderConnected",
  STT_DISCONNECTED: "STTProviderDisconnected",
  TTS_CONNECTED: "TTSProviderConnected",
  TTS_DISCONNECTED: "TTSProviderDisconnected",
} as const;

// ─── Monitoring Events ────────────────────────────────────────────────────────

export const MonitoringEvents = {
  HEALTHY: "RuntimeHealthy",
  UNHEALTHY: "RuntimeUnhealthy",
} as const;

// ─── Error Events ─────────────────────────────────────────────────────────────

export const ErrorEvents = {
  RUNTIME_ERROR: "RuntimeError",
  AUDIO_DEVICE_ERROR: "AudioDeviceError",
  RECOGNITION_ERROR: "RecognitionError",
  PLAYBACK_ERROR: "PlaybackError",
  PROVIDER_ERROR: "ProviderError",
} as const;

// ─── Event data map ───────────────────────────────────────────────────────────

export interface SpeechEventDataMap {
  // Lifecycle
  SpeechRuntimeInitialized: Record<string, never>;
  SpeechRuntimeStarted: Record<string, never>;
  SpeechRuntimeStopped: { reason?: string };
  SpeechRuntimeDisposed: Record<string, never>;

  // Audio Input
  MicrophoneOpened: { deviceId: string };
  MicrophoneClosed: Record<string, never>;
  AudioInputStarted: Record<string, never>;
  AudioInputStopped: Record<string, never>;

  // Recognition
  SpeechDetected: { energy: number };
  SpeechStarted: Record<string, never>;
  PartialTranscriptReceived: { text: string; confidence: number; isFinal: boolean };
  FinalTranscriptReceived: { text: string; confidence: number };
  SpeechEnded: { reason?: string };

  // Playback
  PlaybackStarted: { requestId: string };
  PlaybackPaused: Record<string, never>;
  PlaybackResumed: Record<string, never>;
  PlaybackInterrupted: Record<string, never>;
  PlaybackCompleted: { requestId: string };

  // Provider
  STTProviderConnected: Record<string, never>;
  STTProviderDisconnected: { reason?: string };
  TTSProviderConnected: Record<string, never>;
  TTSProviderDisconnected: { reason?: string };

  // Monitoring
  RuntimeHealthy: { uptimeMs: number };
  RuntimeUnhealthy: { error: string };

  // Error
  RuntimeError: { code: string; message: string };
  AudioDeviceError: { code: string; message: string };
  RecognitionError: { code: string; message: string };
  PlaybackError: { code: string; message: string };
  ProviderError: { code: string; message: string };
}

export type SpeechEventName = keyof SpeechEventDataMap;

export interface SpeechEvent<T extends SpeechEventName = SpeechEventName> {
  name: T;
  timestamp: Date;
  data: SpeechEventDataMap[T];
}

export interface SpeechEventHandler {
  (event: SpeechEvent): void;
}
