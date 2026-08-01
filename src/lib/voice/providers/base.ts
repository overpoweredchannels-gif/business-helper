import type { ProviderConfiguration, ProviderHealth, ProviderState, RetryPolicy } from "./types";
import type { ProviderError, ProviderErrorCode } from "./errors";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  exponentialBackoff: true,
};

export class ProviderRuntimeError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(code: ProviderErrorCode, message: string, retryable = false, cause?: unknown) {
    super(message);
    this.name = "ProviderRuntimeError";
    this.code = code;
    this.retryable = retryable;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function makeProviderError(
  code: ProviderErrorCode,
  message: string,
  retryable = false,
  cause?: unknown,
): ProviderError {
  return new ProviderRuntimeError(code, message, retryable, cause);
}

export function isRetryableError(error: ProviderError): boolean {
  return error.retryable;
}

export class BaseProvider {
  protected state: ProviderState = "created";
  protected config: ProviderConfiguration | null = null;
  protected startedAt: number | null = null;
  protected lastHeartbeat: Date | null = null;
  protected healthyFlag = false;
  protected simulatedLatencyMs = 5;
  protected forcedUnhealthy = false;

  getState(): ProviderState {
    return this.state;
  }

  isHealthy(): boolean {
    return this.healthyFlag && !this.forcedUnhealthy;
  }

  protected requireInitialized(): void {
    if (this.state === "created") {
      throw makeProviderError("INVALID_CONFIGURATION", "Provider must be initialized before use.", false);
    }
  }

  protected requireRunning(): void {
    if (this.state !== "running") {
      throw makeProviderError("SERVICE_UNAVAILABLE", `Provider is in state "${this.state}", expected "running".`, true);
    }
  }

  async initialize(config: ProviderConfiguration): Promise<void> {
    this.config = config;
    if (typeof config.metadata?.simulatedLatencyMs === "number") {
      this.simulatedLatencyMs = Math.max(0, config.metadata.simulatedLatencyMs);
    }
    if (typeof config.metadata?.forceUnhealthy === "boolean") {
      this.forcedUnhealthy = config.metadata.forceUnhealthy;
    }
    this.state = "initialized";
    this.healthyFlag = true;
    this.lastHeartbeat = new Date();
  }

  async start(): Promise<void> {
    this.requireInitialized();
    this.state = "starting";
    await this.delay(this.simulatedLatencyMs);
    this.state = "running";
    this.startedAt = Date.now();
    this.healthyFlag = true;
  }

  async stop(): Promise<void> {
    if (this.state === "created" || this.state === "disposed") return;
    await this.delay(this.simulatedLatencyMs);
    this.state = "stopped";
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.state = "disposed";
    this.healthyFlag = false;
  }

  async health(): Promise<ProviderHealth> {
    if (this.forcedUnhealthy) {
      return { healthy: false, latencyMs: this.simulatedLatencyMs, lastHeartbeat: new Date(), message: "Provider health check failed (forced)." };
    }
    return {
      healthy: this.healthyFlag && (this.state === "running" || this.state === "initialized"),
      latencyMs: this.simulatedLatencyMs,
      lastHeartbeat: this.lastHeartbeat ?? new Date(),
      message: this.healthyFlag ? undefined : "Provider is not healthy.",
    };
  }

  async setUnhealthy(error: string): Promise<void> {
    this.healthyFlag = false;
    this.lastHeartbeat = new Date();
  }

  async recover(): Promise<void> {
    this.healthyFlag = true;
    this.lastHeartbeat = new Date();
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
