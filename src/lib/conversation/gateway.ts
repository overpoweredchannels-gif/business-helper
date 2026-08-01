import { getBusinessBrain } from "@/lib/brain";
import type { ChatRequest, ChatResponse, StreamEvent } from "./contracts";
import type { Channel } from "./types";
import { TCGP_VERSION, SUPPORTED_VERSIONS } from "./contracts";
import { gatewayLogger } from "./logger";

// ─── Internal state ──────────────────────────────────────────────────────────

interface ConversationState {
  conversationId: string;
  channel: Channel;
  createdAt: number;
  messageCount: number;
  lastActivityAt: number;
}

interface SessionState {
  sessionId: string;
  channel: Channel;
  createdAt: number;
  lastActivityAt: number;
  conversationIds: string[];
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface GatewayMetrics {
  startedAt: number;
  uptimeMs: number;
  requestCount: number;
  errorCount: number;
  validationErrorCount: number;
  brainErrorCount: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
  conversationsCreated: number;
  sessionsCreated: number;
  activeConversations: number;
  activeSessions: number;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: ConversationGateway | null = null;

export function getGateway(): ConversationGateway {
  if (!_instance) {
    _instance = new ConversationGateway();
  }
  return _instance;
}

// ─── ID generation ───────────────────────────────────────────────────────────

let requestCounter = 0;

function generateRequestId(): string {
  requestCounter++;
  return `req_${Date.now()}_${requestCounter}`;
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function trackDuration(metrics: GatewayMetrics, durationMs: number): void {
  metrics.totalDurationMs += durationMs;
  if (durationMs < metrics.minDurationMs) metrics.minDurationMs = durationMs;
  if (durationMs > metrics.maxDurationMs) metrics.maxDurationMs = durationMs;
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

export class ConversationGateway {
  private conversations: Map<string, ConversationState> = new Map();
  private sessions: Map<string, SessionState> = new Map();
  private startedAt: number = Date.now();

  private metrics: GatewayMetrics = {
    startedAt: Date.now(),
    uptimeMs: 0,
    requestCount: 0,
    errorCount: 0,
    validationErrorCount: 0,
    brainErrorCount: 0,
    totalDurationMs: 0,
    minDurationMs: Infinity,
    maxDurationMs: 0,
    avgDurationMs: 0,
    conversationsCreated: 0,
    sessionsCreated: 0,
    activeConversations: 0,
    activeSessions: 0,
  };

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const requestId = generateRequestId();
    const correlationId = request.correlationId || generateCorrelationId();
    const timestamp = request.timestamp || new Date().toISOString();

    // 1. Version negotiation
    const version = request.version || TCGP_VERSION;
    if (!SUPPORTED_VERSIONS.includes(version)) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("version.unsupported", {
        correlationId, requestId, version,
        message: `Unsupported version ${version}`,
      });
      return this.errorResponse(
        "UNSUPPORTED_VERSION",
        `Protocol version ${version} is not supported. Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
        requestId, correlationId, version,
      );
    }

    // 2. Message validation
    if (!request.message || typeof request.message !== "string" || !request.message.trim()) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("validation.failed", {
        correlationId, requestId, channel: request.channel,
        message: "Message is required and must be a non-empty string",
      });
      return this.errorResponse(
        "VALIDATION_ERROR",
        "Message is required and must be a non-empty string.",
        requestId, correlationId, version,
      );
    }

    // 3. Channel validation
    if (!request.channel) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("validation.failed", {
        correlationId, requestId,
        message: "Channel is required",
      });
      return this.errorResponse(
        "VALIDATION_ERROR",
        "Channel is required.",
        requestId, correlationId, version,
      );
    }

    // 4. Resolve identities
    const conversationId = this.resolveConversation(request);
    this.resolveSession(request, conversationId);

    // 5. Log request
    gatewayLogger.info("chat.request", {
      correlationId,
      requestId,
      conversationId,
      channel: request.channel,
      version,
      details: {
        messageLength: request.message.length,
        hasSessionId: !!request.sessionId,
        hasUserId: !!request.userId,
        hasOrganizationId: !!request.organizationId,
      },
    });

    // 6. Delegate to BusinessBrain
    const brain = getBusinessBrain();
    if (!brain) {
      this.metrics.brainErrorCount++;
      gatewayLogger.error("brain.unavailable", {
        correlationId, requestId, conversationId,
        message: "Business Brain is not initialized",
      });
      return this.errorResponse(
        "BRAIN_NOT_INITIALIZED",
        "Business Brain is not initialized. Load business data first.",
        requestId, correlationId, version, conversationId,
      );
    }

    const startTime = performance.now();
    try {
      const result = await brain.chat(request.message);
      const durationMs = Math.round(performance.now() - startTime);

      this.metrics.requestCount++;
      trackDuration(this.metrics, durationMs);

      const response: ChatResponse = {
        version,
        correlationId,
        requestId,
        timestamp: new Date().toISOString(),
        ok: result.ok,
        message: result.message,
        conversationId,
        provider: result.provider,
        model: result.model,
        error: result.error,
      };

      if (result.ok) {
        gatewayLogger.info("chat.response", {
          correlationId,
          requestId,
          conversationId,
          channel: request.channel,
          version,
          durationMs,
          details: {
            responseLength: result.message.length,
            provider: result.provider,
            model: result.model,
          },
        });
      } else {
        this.metrics.brainErrorCount++;
        gatewayLogger.warn("chat.error", {
          correlationId,
          requestId,
          conversationId,
          channel: request.channel,
          version,
          durationMs,
          error: result.error,
        });
      }

      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : "Chat request failed.";

      this.metrics.errorCount++;
      trackDuration(this.metrics, durationMs);

      gatewayLogger.error("chat.exception", {
        correlationId,
        requestId,
        conversationId,
        channel: request.channel,
        version,
        durationMs,
        error: errorMessage,
      });

      return this.errorResponse(
        "INTERNAL_ERROR",
        errorMessage,
        requestId, correlationId, version, conversationId,
      );
    }
  }

  getConversation(conversationId: string): ConversationState | undefined {
    return this.conversations.get(conversationId);
  }

  getStatus() {
    this.refreshMetrics();
    return {
      ready: !!getBusinessBrain(),
      brainAttached: !!getBusinessBrain(),
      conversationCount: this.conversations.size,
      sessionCount: this.sessions.size,
      uptimeMs: Date.now() - this.startedAt,
      metrics: this.metrics,
    };
  }

  getMetrics(): GatewayMetrics {
    this.refreshMetrics();
    return { ...this.metrics };
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
    const requestId = generateRequestId();
    const correlationId = request.correlationId || generateCorrelationId();

    const version = request.version || TCGP_VERSION;
    if (!SUPPORTED_VERSIONS.includes(version)) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("version.unsupported", {
        correlationId, requestId, version,
        message: `Unsupported version ${version}`,
      });
      yield {
        type: "error", version, correlationId, requestId,
        conversationId: request.conversationId || "",
        timestamp: new Date().toISOString(),
        error: `UNSUPPORTED_VERSION: Protocol version ${version} is not supported. Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
      };
      return;
    }

    if (!request.message || typeof request.message !== "string" || !request.message.trim()) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("validation.failed", {
        correlationId, requestId, channel: request.channel,
        message: "Message is required and must be a non-empty string",
      });
      yield {
        type: "error", version, correlationId, requestId,
        conversationId: request.conversationId || "",
        timestamp: new Date().toISOString(),
        error: "VALIDATION_ERROR: Message is required and must be a non-empty string.",
      };
      return;
    }

    if (!request.channel) {
      this.metrics.validationErrorCount++;
      gatewayLogger.warn("validation.failed", {
        correlationId, requestId,
        message: "Channel is required",
      });
      yield {
        type: "error", version, correlationId, requestId,
        conversationId: request.conversationId || "",
        timestamp: new Date().toISOString(),
        error: "VALIDATION_ERROR: Channel is required.",
      };
      return;
    }

    const conversationId = this.resolveConversation(request);
    this.resolveSession(request, conversationId);

    const brain = getBusinessBrain();
    if (!brain) {
      this.metrics.brainErrorCount++;
      gatewayLogger.error("brain.unavailable", {
        correlationId, requestId, conversationId,
        message: "Business Brain is not initialized",
      });
      yield {
        type: "error", version, correlationId, requestId, conversationId,
        timestamp: new Date().toISOString(),
        error: "BRAIN_NOT_INITIALIZED: Business Brain is not initialized. Load business data first.",
      };
      return;
    }

    // Emit start event
    yield {
      type: "start", version, correlationId, requestId, conversationId,
      timestamp: new Date().toISOString(),
    };

    const startTime = performance.now();
    try {
      const result = await brain.chat(request.message);
      const durationMs = Math.round(performance.now() - startTime);

      this.metrics.requestCount++;
      trackDuration(this.metrics, durationMs);

      if (result.ok) {
        yield {
          type: "text", version, correlationId, requestId, conversationId,
          timestamp: new Date().toISOString(),
          text: result.message,
        };

        gatewayLogger.info("chat.response", {
          correlationId, requestId, conversationId, channel: request.channel,
          version, durationMs,
          details: { responseLength: result.message.length, provider: result.provider, model: result.model },
        });

        yield {
          type: "done", version, correlationId, requestId, conversationId,
          timestamp: new Date().toISOString(),
          provider: result.provider,
          model: result.model,
        };
      } else {
        this.metrics.brainErrorCount++;
        gatewayLogger.warn("chat.error", {
          correlationId, requestId, conversationId, channel: request.channel,
          version, durationMs, error: result.error,
        });

        yield {
          type: "error", version, correlationId, requestId, conversationId,
          timestamp: new Date().toISOString(),
          error: result.error,
        };
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : "Chat request failed.";

      this.metrics.errorCount++;
      trackDuration(this.metrics, durationMs);

      gatewayLogger.error("chat.exception", {
        correlationId, requestId, conversationId, channel: request.channel,
        version, durationMs, error: errorMessage,
      });

      yield {
        type: "error", version, correlationId, requestId, conversationId,
        timestamp: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private refreshMetrics(): void {
    this.metrics.uptimeMs = Date.now() - this.startedAt;
    this.metrics.avgDurationMs = this.metrics.requestCount > 0
      ? Math.round(this.metrics.totalDurationMs / this.metrics.requestCount)
      : 0;
    this.metrics.activeConversations = this.conversations.size;
    this.metrics.activeSessions = this.sessions.size;
    if (this.metrics.minDurationMs === Infinity) {
      this.metrics.minDurationMs = 0;
    }
  }

  private resolveConversation(request: ChatRequest): string {
    let convId = request.conversationId;
    if (!convId || !this.conversations.has(convId)) {
      convId = generateConversationId();
      this.metrics.conversationsCreated++;
    }
    const existing = this.conversations.get(convId);
    if (existing) {
      existing.messageCount++;
      existing.lastActivityAt = Date.now();
    } else {
      this.conversations.set(convId, {
        conversationId: convId,
        channel: request.channel,
        createdAt: Date.now(),
        messageCount: 1,
        lastActivityAt: Date.now(),
      });
    }
    return convId;
  }

  private resolveSession(request: ChatRequest, conversationId: string): string {
    const sid = request.sessionId || generateSessionId();
    const existing = this.sessions.get(sid);
    if (existing) {
      existing.lastActivityAt = Date.now();
      if (!existing.conversationIds.includes(conversationId)) {
        existing.conversationIds.push(conversationId);
      }
    } else {
      this.metrics.sessionsCreated++;
      this.sessions.set(sid, {
        sessionId: sid,
        channel: request.channel,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        conversationIds: [conversationId],
      });
    }
    return sid;
  }

  private errorResponse(
    code: string,
    message: string,
    requestId: string,
    correlationId: string,
    version: string,
    conversationId?: string,
  ): ChatResponse {
    return {
      version,
      correlationId,
      requestId,
      timestamp: new Date().toISOString(),
      ok: false,
      message: "",
      conversationId: conversationId || "",
      error: `${code}: ${message}`,
    };
  }
}
