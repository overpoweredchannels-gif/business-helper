import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import {
  normalizeLockoutIdentifier,
  SupabaseLoginAttemptStore,
} from "@/lib/identity/login-lockout";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

// Owner-only brute-force lockout management (phase 23).
//
// GET  → currently-locked staff sign-ins in the owner's organisation,
//        with the staff Profile ID / display name joined from profiles.
// POST → manually unlock one identifier: { loginId } (Profile ID, e.g.
//        MU04) or { email }. Clears the lock + attempt count and is
//        audit-logged. Unlocking is idempotent and harmless to repeat.

export async function GET(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? "Forbidden" },
      { status: 403 },
    );
  }
  const actor = permission.actor;

  let locked: Awaited<
    ReturnType<SupabaseLoginAttemptStore["listLocked"]>
  > = [];
  try {
    const store = new SupabaseLoginAttemptStore(createSupabaseService());
    locked = await store.listLocked(actor.organizationId);
  } catch (error) {
    console.error("[login-unlock] listing locked sign-ins failed", error);
    return NextResponse.json(
      { ok: false, error: "Lockout data is unavailable." },
      { status: 503 },
    );
  }

  // Join the staff identity for each locked email so the owner sees a
  // Profile ID / name instead of a hidden staff email.
  const emails = locked.map((row) => row.email);
  const byEmail = new Map<string, { loginId: string | null; displayName: string | null }>();
  if (emails.length > 0) {
    const supabase = createSupabaseService();
    const { data: profiles } = await supabase
      .from("profiles")
      .select("email, login_id, display_name")
      .in("email", emails);
    for (const profile of profiles ?? []) {
      byEmail.set(normalizeLockoutIdentifier(profile.email ?? ""), {
        loginId: profile.login_id ?? null,
        displayName: profile.display_name ?? null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    locked: locked.map((row) => ({
      email: row.email,
      loginId: byEmail.get(row.email)?.loginId ?? null,
      displayName: byEmail.get(row.email)?.displayName ?? null,
      failedAttempts: row.failedAttempts,
      lockedUntil: row.lockedUntil,
      lastAttemptAt: row.lastAttemptAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? "Forbidden" },
      { status: 403 },
    );
  }
  const actor = permission.actor;

  let body: { loginId?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const loginId = (body.loginId ?? "").trim();
  const email = (body.email ?? "").trim();
  if (!loginId && !email) {
    return NextResponse.json(
      { ok: false, error: "Provide a Profile ID or an email to unlock." },
      { status: 400 },
    );
  }

  // Resolve the lockout keys. A Profile ID maps to its hidden staff email
  // (the key the lock was recorded under); the raw Profile ID is also
  // cleared, covering the case where the lock was recorded before the
  // profile existed or the profile lookup missed.
  const supabase = createSupabaseService();
  const keys: string[] = [];
  let profileId: string | null = null;
  let displayLabel = email || loginId;
  if (loginId) {
    const normalized = loginId.toUpperCase();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, login_id, display_name")
      .eq("login_id", normalized)
      .maybeSingle();
    if (profile) {
      profileId = profile.id;
      displayLabel = profile.login_id ?? profile.display_name ?? email ?? loginId;
      if (profile.email) {
        keys.push(normalizeLockoutIdentifier(profile.email));
      }
    }
    keys.push(normalized.toLowerCase());
  }
  if (email) {
    keys.push(normalizeLockoutIdentifier(email));
  }
  const uniqueKeys = [...new Set(keys)];

  const store = new SupabaseLoginAttemptStore(supabase);
  const cleared: string[] = [];
  const failed: string[] = [];
  for (const key of uniqueKeys) {
    try {
      await store.clear(key);
      cleared.push(key);
    } catch (error) {
      console.error("[login-unlock] clearing lock failed for", key, error);
      failed.push(key);
    }
  }
  if (cleared.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Lockout data is unavailable." },
      { status: 503 },
    );
  }

  // Every unlock is audit-logged (the button itself needs no extra
  // throttle: unlocking is idempotent and owner-only).
  await logAuditEvent({
    organizationId: actor.organizationId,
    actorProfileId: actor.profileId,
    actorEmail: actor.email,
    action: "login_unlocked",
    entityType: "profile",
    entityId: profileId,
    description: `Manually unlocked sign-in for ${displayLabel}.`,
    success: true,
  });

  return NextResponse.json({
    ok: true,
    unlocked: displayLabel,
    clearedKeys: cleared.length,
    failedKeys: failed.length,
  });
}
