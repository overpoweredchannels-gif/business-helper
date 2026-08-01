import type { ChatRequest, ChatResponse, StreamEvent } from "./contracts";
import type { Channel } from "./types";
import { TCGP_VERSION } from "./contracts";

export interface ConversationClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  onEvent?: (event: string, data: unknown) => void;
}

export interface ChatOptions {
  channel?: Channel;
  userId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}

class ClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly statusCode?: number;

  constructor(message: string, code: string, opts?: { requestId?: string; correlationId?: string; statusCode?: number }) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.requestId = opts?.requestId;
    this.correlationId = opts?.correlationId;
    this.statusCode = opts?.statusCode;
  }
}

class TimeoutError extends ClientError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, "TIMEOUT");
    this.name = "TimeoutError";
  }
}

class NetworkError extends ClientError {
  constructor(cause: string) {
    super(`Network error: ${cause}`, "NETWORK");
    this.name = "NetworkError";
  }
}

class GatewayRequestError extends ClientError {
  constructor(response: ChatResponse, statusCode: number) {
    super(
      response.error || "Unknown gateway error",
      response.error?.split(":")[0]?.trim() || "GATEWAY_ERROR",
      { requestId: response.requestId, correlationId: response.correlationId, statusCode },
    );
    this.name = "GatewayRequestError";
  }
}

function generateSessionId(): string {
  return `sess_sdk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { ClientError, TimeoutError, NetworkError, GatewayRequestError };

export class ConversationClient {
  private config: Required<Pick<ConversationClientConfig, "timeout" | "retryMaxAttempts" | "retryBaseDelayMs">> &
    ConversationClientConfig;
  private sessionId: string;
  private conversationId: string | undefined;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  constructor(config: ConversationClientConfig) {
    this.config = {
      timeout: 30000,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1000,
      ...config,
    };
    this.sessionId = config.apiKey
      ? `sess_sdk_${config.apiKey.slice(0, 8)}_${Date.now()}`
      : generateSessionId();
  }

  on(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event) || [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event) || [];
    this.listeners.set(
      event,
      handlers.filter((h) => h !== handler),
    );
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch {
        // swallow listener errors
      }
    }
    this.config.onEvent?.(event, args);
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const request = this.buildRequest(message, options);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/conversation/chat`;
    const headers = this.buildHeaders();

    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < this.config.retryMaxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        const data: ChatResponse = await response.json();

        if (data.conversationId) {
          this.conversationId = data.conversationId;
        }

        if (!response.ok && data.ok !== true) {
          const gwErr = new GatewayRequestError(data, response.status);
          if (this.isRetryable(response.status)) {
            lastError = gwErr;
            this.emit("retry", { attempt, maxAttempts: this.config.retryMaxAttempts, error: gwErr });
            await this.backoff(attempt);
            continue;
          }
          throw gwErr;
        }

        this.emit("chat.success", { requestId: data.requestId, conversationId: data.conversationId });
        return data;
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof ClientError) {
          if (err instanceof GatewayRequestError && !this.isRetryable(err.statusCode ?? 0)) {
            throw err;
          }
          if (err instanceof GatewayRequestError && attempt < this.config.retryMaxAttempts) {
            lastError = err;
            this.emit("retry", { attempt, maxAttempts: this.config.retryMaxAttempts, error: err });
            await this.backoff(attempt);
            continue;
          }
          throw err;
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          this.emit("chat.timeout", { timeout: this.config.timeout });
          if (attempt < this.config.retryMaxAttempts) {
            lastError = new TimeoutError(this.config.timeout);
            this.emit("retry", { attempt, maxAttempts: this.config.retryMaxAttempts, error: lastError });
            await this.backoff(attempt);
            continue;
          }
          throw new TimeoutError(this.config.timeout);
        }

        lastError = new NetworkError(err instanceof Error ? err.message : "Unknown fetch error");
        if (attempt < this.config.retryMaxAttempts) {
          this.emit("retry", { attempt, maxAttempts: this.config.retryMaxAttempts, error: lastError });
          await this.backoff(attempt);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new ClientError("Request failed after retries", "MAX_RETRIES_EXCEEDED");
  }

  async *streamChat(message: string, options?: ChatOptions): AsyncGenerator<StreamEvent, void, void> {
    const request = this.buildRequest(message, options);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/conversation/chat/stream`;
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        yield {
          type: "error",
          requestId: "",
          conversationId: this.conversationId || "",
          correlationId: "",
          version: TCGP_VERSION,
          timestamp: new Date().toISOString(),
          error: `SSE request failed with status ${response.status}`,
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const event: StreamEvent = JSON.parse(trimmed.slice(6));
            if (event.conversationId) {
              this.conversationId = event.conversationId;
            }
            this.emit("stream.event", event);
            yield event;
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        yield {
          type: "error",
          requestId: "",
          conversationId: this.conversationId || "",
          correlationId: "",
          version: TCGP_VERSION,
          timestamp: new Date().toISOString(),
          error: "Stream request timed out",
        };
        return;
      }
      yield {
        type: "error",
        requestId: "",
        conversationId: this.conversationId || "",
        correlationId: "",
        version: TCGP_VERSION,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Stream request failed",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  newConversation(): void {
    this.conversationId = undefined;
    this.emit("conversation.reset");
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getConversationId(): string | undefined {
    return this.conversationId;
  }

  private buildRequest(message: string, options?: ChatOptions): ChatRequest {
    return {
      version: TCGP_VERSION,
      message,
      channel: options?.channel || "web",
      sessionId: this.sessionId,
      conversationId: this.conversationId,
      userId: options?.userId,
      organizationId: options?.organizationId,
      metadata: options?.metadata as any,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private isRetryable(status: number): boolean {
    return status === 429 || status === 502 || status === 503;
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.config.retryBaseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
    await sleep(delay);
  }
}
