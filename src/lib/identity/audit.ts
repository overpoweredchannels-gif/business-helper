import { AuditEntry } from "./types";
import { AuditRepository } from "@/lib/audit/audit-repository";

const AUDIT_STORAGE_KEY = "tradeos_audit_log";
const MAX_AUDIT_ENTRIES = 500;

function generateId(): string {
  return `audit_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

class AuditLogger {
  private entries: AuditEntry[] = [];
  private storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null = null;

  setStorage(
    storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void },
  ): void {
    this.storage = storage;
    const raw = storage.getItem(AUDIT_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        }
      } catch {
        this.entries = [];
      }
    }
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.entries));
  }

  log(input: {
    organizationId: string;
    actorProfileId?: string | null;
    actorEmail?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    description?: string | null;
    success?: boolean;
  }): AuditEntry {
    const entry: AuditEntry = {
      id: generateId(),
      organizationId: input.organizationId,
      actorProfileId: input.actorProfileId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
      success: input.success ?? true,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_AUDIT_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_AUDIT_ENTRIES);
    }
    this.persist();
    return entry;
  }

  getEntries(organizationId: string, limit = 100): AuditEntry[] {
    return this.entries
      .filter((e) => e.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  getEntriesByAction(organizationId: string, action: string): AuditEntry[] {
    return this.getEntries(organizationId, 500).filter((e) => e.action === action);
  }

  getEntriesByActor(organizationId: string, actorProfileId: string): AuditEntry[] {
    return this.getEntries(organizationId, 500).filter((e) => e.actorProfileId === actorProfileId);
  }

  countFailures(organizationId: string): number {
    return this.entries.filter((e) => e.organizationId === organizationId && !e.success).length;
  }
}

export const auditLogger = new AuditLogger();

export async function logAuditEvent(input: {
  organizationId: string;
  actorProfileId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string | null;
  success?: boolean;
}): Promise<AuditEntry> {
  const entry = auditLogger.log(input);
  try {
    await new AuditRepository().create({
      organization_id: input.organizationId,
      actor_profile_id: input.actorProfileId ?? null,
      actor_email: input.actorEmail ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      description: input.description ?? null,
    });
  } catch (error) {
    console.error("Failed to persist identity audit event", error);
  }
  return entry;
}

export function getAuditEntries(organizationId: string, limit = 100): AuditEntry[] {
  return auditLogger.getEntries(organizationId, limit);
}

export function getAuditEntriesByAction(organizationId: string, action: string): AuditEntry[] {
  return auditLogger.getEntriesByAction(organizationId, action);
}

export function getAuditEntriesByActor(organizationId: string, actorProfileId: string): AuditEntry[] {
  return auditLogger.getEntriesByActor(organizationId, actorProfileId);
}

export function countAuditFailures(organizationId: string): number {
  return auditLogger.countFailures(organizationId);
}
