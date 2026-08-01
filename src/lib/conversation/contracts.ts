import type { Channel, ChannelMetadata } from "./types";

// ─── Error Codes ────────────────────────────────────────────────────────────

export type ErrorCode =
  | "BRAIN_NOT_INITIALIZED"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "CONVERSATION_NOT_FOUND"
  | "UNSUPPORTED_VERSION";

// ─── TCGP v1.0 — Request Envelope ───────────────────────────────────────────

export interface ChatRequest {
  version?: string;
  correlationId?: string;
  timestamp?: string;

  message: string;
  conversationId?: string;
  sessionId?: string;
  userId?: string;
  organizationId?: string;
  channel: Channel;
  metadata?: ChannelMetadata;
}

// ─── TCGP v1.0 — Response Envelope ──────────────────────────────────────────

export interface ChatResponse {
  version: string;
  correlationId: string;
  requestId: string;
  timestamp: string;

  ok: boolean;
  message: string;
  conversationId: string;
  provider?: string;
  model?: string;
  error?: string;
}

// ─── TCGP v1.0 — Error Model ────────────────────────────────────────────────

export interface GatewayError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
}

// ─── TCGP v1.0 — Confirmation Protocol ──────────────────────────────────────

export interface ConfirmationRequest {
  type: "confirmation";
  conversationId: string;
  summary: string;
  requiredFields: string[];
  timeoutMs: number;
}

export interface ConfirmationResponse {
  type: "confirmation";
  conversationId: string;
  confirmed: boolean;
  amendments?: Record<string, unknown>;
}

// ─── TCGP v1.0 — Streaming Contract ─────────────────────────────────────────

export type StreamEventType = "start" | "text" | "done" | "error";

export interface StreamEvent {
  type: StreamEventType;
  requestId: string;
  conversationId: string;
  correlationId: string;
  version: string;
  timestamp: string;
  text?: string;
  error?: string;
  provider?: string;
  model?: string;
}

export interface ChatStream {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
}

// ─── TCGP v1.0 — Version Constants ──────────────────────────────────────────

export const TCGP_VERSION = "1.0";
export const SUPPORTED_VERSIONS = ["1.0"];
export const VERSION_HEADER = "x-tcgp-version";
export const CORRELATION_ID_HEADER = "x-correlation-id";
