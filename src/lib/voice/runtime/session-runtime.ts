import { voiceEvents } from "../telemetry";
import { SessionRuntimeEventNames as Emit } from "../events";
import { VoiceGatewayClient } from "./gateway-client";
import { generateSessionId } from "./speech-runtime";

export type VoiceSessionState = "created" | "active" | "paused" | "ended" | "recovering" | "timed_out";

export interface VoiceSessionRecord {
  sessionId: string;
  state: VoiceSessionState;
  createdAt: number;
  lastActivityAt: number;
  conversationId: string | null;
  userId: string | null;
  endedAt: number | null;
  error: string | null;
}

export interface SessionRuntimeOptions {
  idleTimeoutMs?: number;
  maxSessions?: number;
  idleCheckIntervalMs?: number;
  gatewayClient?: VoiceGatewayClient;
}

export interface SessionRecoveryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Session runtime: session lifecycle (created → active → paused → ended),
 * idle timeout monitoring, concurrent session limits and gateway recovery.
 */
export class SessionRuntime {
  private sessions = new Map<string, VoiceSessionRecord>();
  private idleTimeoutMs: number;
  private maxSessions: number;
  private idleCheckIntervalMs: number;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  readonly gateway: VoiceGatewayClient;

  constructor(options: SessionRuntimeOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60000;
    this.maxSessions = options.maxSessions ?? 10;
    this.idleCheckIntervalMs = options.idleCheckIntervalMs ?? 500;
    this.gateway = options.gatewayClient ?? new VoiceGatewayClient();
  }

  startMonitoring(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.checkIdle(), this.idleCheckIntervalMs);
  }

  stopMonitoring(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  getActiveCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.state === "active" || s.state === "recovering").length;
  }

  getSession(sessionId: string): VoiceSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): VoiceSessionRecord[] {
    return Array.from(this.sessions.values());
  }

  createSession(userId: string | null = null, conversationId: string | null = null): VoiceSessionRecord {
    if (this.getActiveCount() >= this.maxSessions) {
      throw new Error(`Maximum concurrent sessions (${this.maxSessions}) reached.`);
    }
    const session: VoiceSessionRecord = {
      sessionId: generateSessionId("session"),
      state: "created",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      conversationId,
      userId,
      endedAt: null,
      error: null,
    };
    this.sessions.set(session.sessionId, session);
    voiceEvents.emit("session", Emit.CREATED, { sessionId: session.sessionId });
    return session;
  }

  startSession(sessionId: string): VoiceSessionRecord {
    const session = this.requireSession(sessionId);
    if (session.state === "ended") {
      throw new Error(`Session ${sessionId} is ended.`);
    }
    session.state = "active";
    session.lastActivityAt = Date.now();
    voiceEvents.emit("session", Emit.STARTED, { sessionId });
    return session;
  }

  pauseSession(sessionId: string, reason = "manual"): VoiceSessionRecord {
    const session = this.requireSession(sessionId);
    if (session.state === "ended") return session;
    session.state = "paused";
    voiceEvents.emit("session", Emit.PAUSED, { sessionId, reason });
    return session;
  }

  resumeSession(sessionId: string): VoiceSessionRecord {
    const session = this.requireSession(sessionId);
    if (session.state === "ended") {
      throw new Error(`Session ${sessionId} is ended.`);
    }
    session.state = "active";
    session.lastActivityAt = Date.now();
    voiceEvents.emit("session", Emit.RESUMED, { sessionId });
    return session;
  }

  endSession(sessionId: string, reason?: string): VoiceSessionRecord {
    const session = this.requireSession(sessionId);
    session.state = "ended";
    session.endedAt = Date.now();
    voiceEvents.emit("session", Emit.ENDED, { sessionId, reason });
    return session;
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state !== "ended") {
      session.lastActivityAt = Date.now();
      if (session.state === "active") {
        voiceEvents.emit("session", Emit.ACTIVATED, { sessionId });
      }
    }
  }

  setConversation(sessionId: string, conversationId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationId = conversationId;
    }
  }

  /**
   * Recovery: retries a gateway operation for a session, emitting recovery
   * events. Returns the record when recovered, throws when attempts exhaust.
   */
  async recoverSession(sessionId: string, operation: () => Promise<void>, options: SessionRecoveryOptions = {}): Promise<VoiceSessionRecord> {
    const session = this.requireSession(sessionId);
    const maxAttempts = options.maxAttempts ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 50;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      session.state = "recovering";
      if (attempt > 1) {
        voiceEvents.emit("session", Emit.RECOVERY_ATTEMPTED, {
          sessionId,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      try {
        await operation();
        session.state = "active";
        session.lastActivityAt = Date.now();
        session.error = null;
        if (attempt > 1) {
          voiceEvents.emit("session", Emit.RECOVERY_COMPLETED, { sessionId });
        }
        return session;
      } catch (err) {
        lastError = err;
        session.error = err instanceof Error ? err.message : String(err);
      }
    }
    session.state = "active";
    session.error = lastError instanceof Error ? lastError.message : String(lastError);
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private checkIdle(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.state !== "active") continue;
      const idleMs = now - session.lastActivityAt;
      if (idleMs >= this.idleTimeoutMs) {
        session.state = "timed_out";
        voiceEvents.emit("session", Emit.TIMED_OUT, { sessionId: session.sessionId, idleMs });
      }
    }
  }

  private requireSession(sessionId: string): VoiceSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }
}
