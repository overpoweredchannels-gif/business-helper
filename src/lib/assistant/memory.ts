import type {
  MemorySnapshot,
  EntityRef,
  AssistantSession,
  HistoryEntry,
  ActionRecord,
} from "./types";

/**
 * Unified conversation memory for the assistant. Holds the current topic,
 * active workflow, pending confirmation, last referenced entities, recent
 * completed actions (for undo/repeat) and cross-module references. This is
 * separate from the Business Brain memory (read-only reuse) and from the
 * Conversation Gateway (untouched).
 */
export class UnifiedConversationMemory {
  private sessions = new Map<string, AssistantSession>();
  private actionLog = new Map<string, ActionRecord[]>();
  private lastActionBySession = new Map<string, ActionRecord>();

  constructor(private readonly maxHistoryPerSession = 30) {}

  getSession(sessionId: string): AssistantSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        state: "idle",
        activeWorkflow: null,
        pausedWorkflows: [],
        pendingClarification: null,
        pendingIntent: null,
        lastUserMessage: null,
        lastAssistantMessage: null,
        history: [],
        workflowHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  pushMessage(session: AssistantSession, role: "user" | "assistant", text: string): void {
    session.history.push({ id: this.nextId(), role, text, timestamp: new Date().toISOString() });
    if (session.history.length > this.maxHistoryPerSession) {
      session.history.splice(0, session.history.length - this.maxHistoryPerSession);
    }
    if (role === "user") session.lastUserMessage = text;
    else session.lastAssistantMessage = text;
    session.updatedAt = new Date().toISOString();
  }

  getRecentUserMessages(session: AssistantSession, count = 3): string[] {
    return session.history.filter((h) => h.role === "user").slice(-count).map((h) => h.text);
  }

  getRecentAssistantMessages(session: AssistantSession, count = 3): string[] {
    return session.history.filter((h) => h.role === "assistant").slice(-count).map((h) => h.text);
  }

  snapshot(session: AssistantSession): MemorySnapshot {
    return {
      currentTopic: session.activeWorkflow ? session.activeWorkflow.actionType : null,
      currentWorkflowId: session.activeWorkflow ? session.activeWorkflow.id : null,
      pendingConfirmation: session.activeWorkflow?.awaitingConfirmation ? session.activeWorkflow.confirmationSummary : null,
      lastCustomer: this.getReference(session, "lastCustomer"),
      lastSupplier: this.getReference(session, "lastSupplier"),
      lastProduct: this.getReference(session, "lastProduct"),
      lastEmployee: this.getReference(session, "lastEmployee"),
      lastArea: this.getString(session, "lastArea"),
      lastSale: (this.getObject(session, "lastSale") ?? null) as MemorySnapshot["lastSale"],
      lastPurchase: (this.getObject(session, "lastPurchase") ?? null) as MemorySnapshot["lastPurchase"],
      recentTopics: this.getStringList(session, "recentTopics"),
    };
  }

  rememberReference(session: AssistantSession, key: string, value: unknown): void {
    const refs = this.getReferences(session);
    if (value === null || value === undefined) return;
    refs[key] = value;
    session.updatedAt = new Date().toISOString();
  }

  getReference(session: AssistantSession, key: string): EntityRef | null {
    const refs = this.getReferences(session);
    const value = refs[key];
    return value && typeof value === "object" ? (value as EntityRef) : null;
  }

  getString(session: AssistantSession, key: string): string | null {
    const refs = this.getReferences(session);
    const value = refs[key];
    return typeof value === "string" ? value : null;
  }

  getObject(session: AssistantSession, key: string): unknown {
    const refs = this.getReferences(session);
    const value = refs[key];
    return value && typeof value === "object" ? value : null;
  }

  getStringList(session: AssistantSession, key: string): string[] {
    const refs = this.getReferences(session);
    const value = refs[key];
    return Array.isArray(value) ? (value as string[]) : [];
  }

  private getReferences(session: AssistantSession): Record<string, unknown> {
    if (!session._refs) session._refs = {};
    return session._refs;
  }

  recordAction(sessionId: string, record: ActionRecord): void {
    const log = this.actionLog.get(sessionId) || [];
    log.push(record);
    if (log.length > 20) log.splice(0, log.length - 20);
    this.actionLog.set(sessionId, log);
    this.lastActionBySession.set(sessionId, record);
  }

  getLastAction(sessionId: string): ActionRecord | null {
    return this.lastActionBySession.get(sessionId) ?? null;
  }

  getActionLog(sessionId: string): ActionRecord[] {
    return this.actionLog.get(sessionId) ?? [];
  }

  markActionReverted(sessionId: string, actionId: string): ActionRecord | null {
    const log = this.actionLog.get(sessionId) ?? [];
    const record = log.find((a) => a.id === actionId);
    if (record) {
      record.status = "reverted";
      this.actionLog.set(sessionId, log);
    }
    return record ?? null;
  }

  clear(): void {
    this.sessions.clear();
    this.actionLog.clear();
    this.lastActionBySession.clear();
  }

  private nextId(): string {
    return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export type { HistoryEntry };
