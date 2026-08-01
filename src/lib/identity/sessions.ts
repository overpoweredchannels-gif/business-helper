import { SessionInfo } from "./types";

export interface SessionPolicy {
  sessionTimeoutMinutes: number;
  singleDevice: boolean;
  requireRememberDevice: boolean;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  sessionTimeoutMinutes: 480,
  singleDevice: false,
  requireRememberDevice: false,
};

const SESSION_STORAGE_KEY = "tradeos_active_sessions";

function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}_${random}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class SessionManager {
  private sessions: SessionInfo[] = [];
  private policy: SessionPolicy = { ...DEFAULT_SESSION_POLICY };
  private storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null = null;

  setStorage(
    storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void },
  ): void {
    this.storage = storage;
    this.load();
  }

  setPolicy(policy: Partial<SessionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  getPolicy(): SessionPolicy {
    return { ...this.policy };
  }

  private load(): void {
    if (!this.storage) {
      return;
    }
    const raw = this.storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.sessions = parsed.filter(
          (s) => s && typeof s.sessionId === "string" && typeof s.profileId === "string",
        );
      }
    } catch {
      this.sessions = [];
    }
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.sessions));
  }

  createSession(input: {
    profileId: string;
    organizationId: string;
    deviceName: string;
    rememberDevice: boolean;
  }): SessionInfo {
    if (this.policy.singleDevice) {
      this.sessions = this.sessions.map((s) =>
        s.profileId === input.profileId && !s.revoked ? { ...s, revoked: true } : s,
      );
    }

    const now = Date.now();
    const timeoutMs = this.policy.sessionTimeoutMinutes * 60 * 1000;
    const session: SessionInfo = {
      sessionId: generateId("sess"),
      profileId: input.profileId,
      organizationId: input.organizationId,
      deviceToken: generateToken(),
      deviceName: input.deviceName,
      createdAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      expiresAt: new Date(now + timeoutMs).toISOString(),
      revoked: false,
      rememberDevice: input.rememberDevice,
    };
    this.sessions.push(session);
    this.persist();
    return session;
  }

  validateSession(token: string): { session?: SessionInfo; error?: string } {
    if (!token) {
      return { error: "no_session" };
    }
    const session = this.sessions.find((s) => s.deviceToken === token);
    if (!session) {
      return { error: "session_not_found" };
    }
    if (session.revoked) {
      return { error: "session_revoked" };
    }
    const now = Date.now();
    if (!session.rememberDevice && new Date(session.expiresAt).getTime() < now) {
      session.revoked = true;
      this.persist();
      return { error: "session_expired" };
    }
    session.lastActiveAt = new Date(now).toISOString();
    this.persist();
    return { session };
  }

  revokeSession(token: string): { success: boolean; error?: string } {
    const session = this.sessions.find((s) => s.deviceToken === token);
    if (!session) {
      return { success: false, error: "session_not_found" };
    }
    session.revoked = true;
    this.persist();
    return { success: true };
  }

  revokeSessionById(sessionId: string): { success: boolean; error?: string } {
    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      return { success: false, error: "session_not_found" };
    }
    session.revoked = true;
    this.persist();
    return { success: true };
  }

  revokeAllForProfile(profileId: string): number {
    const active = this.sessions.filter((s) => s.profileId === profileId && !s.revoked);
    this.sessions = this.sessions.map((s) =>
      s.profileId === profileId ? { ...s, revoked: true } : s,
    );
    this.persist();
    return active.length;
  }

  getActiveSessions(profileId: string): SessionInfo[] {
    return this.sessions.filter((s) => s.profileId === profileId && !s.revoked);
  }

  getActiveSessionsForOrg(organizationId: string): SessionInfo[] {
    return this.sessions.filter((s) => s.organizationId === organizationId && !s.revoked);
  }

  getExpiredSessions(): SessionInfo[] {
    const now = Date.now();
    return this.sessions.filter(
      (s) => !s.revoked && !s.rememberDevice && new Date(s.expiresAt).getTime() < now,
    );
  }

  cleanupExpired(): number {
    const expired = this.getExpiredSessions();
    for (const session of expired) {
      session.revoked = true;
    }
    if (expired.length > 0) {
      this.persist();
    }
    return expired.length;
  }
}

export const sessionManager = new SessionManager();

export function createSession(input: {
  profileId: string;
  organizationId: string;
  deviceName: string;
  rememberDevice: boolean;
}): SessionInfo {
  return sessionManager.createSession(input);
}

export function validateSession(token: string): { session?: SessionInfo; error?: string } {
  return sessionManager.validateSession(token);
}

export function revokeSession(token: string): { success: boolean; error?: string } {
  return sessionManager.revokeSession(token);
}

export function revokeSessionById(sessionId: string): { success: boolean; error?: string } {
  return sessionManager.revokeSessionById(sessionId);
}

export function revokeAllForProfile(profileId: string): number {
  return sessionManager.revokeAllForProfile(profileId);
}

export function getActiveSessions(profileId: string): SessionInfo[] {
  return sessionManager.getActiveSessions(profileId);
}

export function getActiveSessionsForOrg(organizationId: string): SessionInfo[] {
  return sessionManager.getActiveSessionsForOrg(organizationId);
}

export function cleanupExpiredSessions(): number {
  return sessionManager.cleanupExpired();
}
