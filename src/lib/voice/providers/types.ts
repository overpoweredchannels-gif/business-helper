export type ProviderState =
  | "created"
  | "initialized"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "disposed"
  | "failed";

export interface ProviderHealth {
  healthy: boolean;
  latencyMs: number;
  lastHeartbeat: Date;
  message?: string;
}

export interface ProviderCapabilities {
  streaming: boolean;
  multilingual: boolean;
  interruption: boolean;
  partialResults: boolean;
  reconnect: boolean;
}

export interface ProviderConfiguration {
  providerId: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  metadata: Record<string, unknown>;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBackoff: boolean;
}

export interface VoiceSession {
  id: string;
  language?: string;
  sampleRate?: number;
  encoding?: string;
  metadata?: Record<string, unknown>;
}

export interface AudioChunk {
  data: ArrayBuffer;
  format: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  sequence: number;
  isFinal: boolean;
}

export interface SpeechRequest {
  text: string;
  voice?: string;
  language?: string;
  rate?: number;
  pitch?: number;
  metadata?: Record<string, unknown>;
}

export interface AudioStream {
  [Symbol.asyncIterator](): AsyncIterator<AudioChunk>;
}

export interface TransportMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
