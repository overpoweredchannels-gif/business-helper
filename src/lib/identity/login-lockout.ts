import type { SupabaseClient } from "@supabase/supabase-js";

// Brute-force lockout (P0-7, approved by UMAIR 2026-11-16).
//
// Rule: 5 failed sign-in attempts lock that identifier for 15 minutes,
// per-email — so other staff on a shared shop IP are NOT blocked. The lock
// auto-expires after 15 minutes; the owner can also unlock manually from
// the Staff / Security Check screen.
//
// Storage: dedicated `login_attempts` table (see
// src/lib/migrations/production_phase23_login_attempts_lockout.sql).
// The key is the normalized login identifier: the resolved staff email
// (lowercased) when the Profile ID resolves to an account, otherwise the
// entered Profile ID (lowercased). Hidden staff emails contain
// "@staff.tradeos.internal" so a bare Profile ID (e.g. MU04) can never
// collide with an email key.
//
// FAIL-OPEN: every helper below catches store errors and allows the sign-in
// to proceed. A missing table / function (migration not run yet) must NEVER
// lock everybody out — the lockout is a guard, not a gate.

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;

export interface LoginAttemptRecord {
  email: string;
  organizationId: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  lastAttemptAt: string;
}

export interface LoginAttemptStore {
  get(email: string): Promise<LoginAttemptRecord | null>;
  recordFailure(
    email: string,
    organizationId: string | null,
    now?: Date,
  ): Promise<{ record: LoginAttemptRecord; locked: boolean }>;
  clear(email: string): Promise<void>;
  listLocked(organizationId: string, now?: Date): Promise<LoginAttemptRecord[]>;
}

export function normalizeLockoutIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function isLoginLocked(
  record: LoginAttemptRecord | null,
  now: Date = new Date(),
): boolean {
  if (!record || !record.lockedUntil) {
    return false;
  }
  return new Date(record.lockedUntil).getTime() > now.getTime();
}

export function remainingLockSeconds(
  record: LoginAttemptRecord | null,
  now: Date = new Date(),
): number {
  if (!record || !record.lockedUntil) {
    return 0;
  }
  return Math.max(
    0,
    Math.ceil((new Date(record.lockedUntil).getTime() - now.getTime()) / 1000),
  );
}

export function buildLockoutMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

// In-memory store. Used by the slice test (and only there in production
// code paths). Its recordFailure semantics MUST mirror the
// record_login_attempt() RPC exactly: an expired lock restarts the count
// at 1, a live lock is never extended, the lock engages at 5 failures.
export class InMemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly rows = new Map<string, LoginAttemptRecord>();

  async get(email: string): Promise<LoginAttemptRecord | null> {
    return this.rows.get(normalizeLockoutIdentifier(email)) ?? null;
  }

  async recordFailure(
    email: string,
    organizationId: string | null,
    now: Date = new Date(),
  ): Promise<{ record: LoginAttemptRecord; locked: boolean }> {
    const key = normalizeLockoutIdentifier(email);
    const existing = this.rows.get(key) ?? null;
    let failedAttempts: number;
    let lockedUntil: string | null;
    if (
      existing &&
      existing.lockedUntil &&
      new Date(existing.lockedUntil).getTime() <= now.getTime()
    ) {
      // Previous lock expired: fresh count, lock cleared.
      failedAttempts = 1;
      lockedUntil = null;
    } else if (existing) {
      failedAttempts = existing.failedAttempts + 1;
      // Keep the original lock; a further failure while locked does NOT
      // extend it, so the auto-unlock time stays fixed.
      lockedUntil = existing.lockedUntil;
      if (!lockedUntil && failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        lockedUntil = new Date(
          now.getTime() + LOGIN_LOCKOUT_MINUTES * 60 * 1000,
        ).toISOString();
      }
    } else {
      failedAttempts = 1;
      lockedUntil = null;
    }
    const record: LoginAttemptRecord = {
      email: key,
      organizationId: organizationId ?? existing?.organizationId ?? null,
      failedAttempts,
      lockedUntil,
      lastAttemptAt: now.toISOString(),
    };
    this.rows.set(key, record);
    return { record, locked: isLoginLocked(record, now) };
  }

  async clear(email: string): Promise<void> {
    this.rows.delete(normalizeLockoutIdentifier(email));
  }

  async listLocked(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<LoginAttemptRecord[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId && isLoginLocked(row, now),
      )
      .sort((a, b) => a.email.localeCompare(b.email));
  }
}

type LoginAttemptRow = {
  email: string;
  organization_id: string | null;
  failed_attempts: number;
  locked_until: string | null;
  last_attempt_at: string;
};

function toRecord(row: LoginAttemptRow): LoginAttemptRecord {
  return {
    email: row.email,
    organizationId: row.organization_id,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastAttemptAt: row.last_attempt_at,
  };
}

// Supabase-backed store (service-role client: the login_attempts table has
// RLS enabled with no policies, so only the service role can touch it).
export class SupabaseLoginAttemptStore implements LoginAttemptStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(email: string): Promise<LoginAttemptRecord | null> {
    const key = normalizeLockoutIdentifier(email);
    const { data, error } = await this.supabase
      .from("login_attempts")
      .select(
        "email, organization_id, failed_attempts, locked_until, last_attempt_at",
      )
      .eq("email", key)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        throw error;
      }
      return null;
    }
    return toRecord(data as LoginAttemptRow);
  }

  async recordFailure(
    email: string,
    organizationId: string | null,
  ): Promise<{ record: LoginAttemptRecord; locked: boolean }> {
    const key = normalizeLockoutIdentifier(email);
    const { data, error } = await this.supabase.rpc("record_login_attempt", {
      p_email: key,
      p_organization_id: organizationId,
    });
    if (error || !data) {
      throw error ?? new Error("record_login_attempt returned no row");
    }
    const row = (Array.isArray(data) ? data[0] : data) as LoginAttemptRow;
    if (!row) {
      throw new Error("record_login_attempt returned no row");
    }
    const record: LoginAttemptRecord = {
      email: row.email,
      organizationId,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until,
      lastAttemptAt: row.last_attempt_at,
    };
    return { record, locked: isLoginLocked(record) };
  }

  async clear(email: string): Promise<void> {
    const { error } = await this.supabase
      .from("login_attempts")
      .delete()
      .eq("email", normalizeLockoutIdentifier(email));
    if (error) {
      throw error;
    }
  }

  async listLocked(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<LoginAttemptRecord[]> {
    const { data, error } = await this.supabase
      .from("login_attempts")
      .select(
        "email, organization_id, failed_attempts, locked_until, last_attempt_at",
      )
      .eq("organization_id", organizationId)
      .gt("locked_until", now.toISOString())
      .order("email", { ascending: true });
    if (error || !data) {
      if (error) {
        throw error;
      }
      return [];
    }
    return (data as LoginAttemptRow[]).map(toRecord);
  }
}

// Fail-open helpers: any store error (e.g. the phase-23 table / function
// not migrated yet) logs and lets the sign-in proceed.
export async function checkLoginAllowed(
  store: LoginAttemptStore,
  email: string,
  now: Date = new Date(),
): Promise<{
  allowed: boolean;
  lockedUntil?: string;
  retryAfterSeconds?: number;
}> {
  try {
    const record = await store.get(email);
    if (!isLoginLocked(record, now)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      lockedUntil: record?.lockedUntil ?? undefined,
      retryAfterSeconds: remainingLockSeconds(record, now),
    };
  } catch (error) {
    console.error("[login-lockout] lock check failed; failing open", error);
    return { allowed: true };
  }
}

export async function recordFailedLogin(
  store: LoginAttemptStore,
  email: string,
  organizationId: string | null,
  now: Date = new Date(),
): Promise<{ locked: boolean; lockedUntil?: string; attempts: number }> {
  try {
    const { record, locked } = await store.recordFailure(
      email,
      organizationId,
      now,
    );
    return {
      locked,
      lockedUntil: record.lockedUntil ?? undefined,
      attempts: record.failedAttempts,
    };
  } catch (error) {
    console.error(
      "[login-lockout] recording failed attempt failed; failing open",
      error,
    );
    return { locked: false, attempts: 0 };
  }
}

export async function clearFailedLogins(
  store: LoginAttemptStore,
  email: string,
): Promise<void> {
  try {
    await store.clear(email);
  } catch (error) {
    console.error("[login-lockout] clearing failed attempts failed", error);
  }
}
