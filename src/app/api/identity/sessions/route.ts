import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { logAuditEvent } from "@/lib/identity/audit";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SessionPolicy = { sessionTimeoutMinutes: number; singleDevice: boolean };
const DEFAULT_POLICY: SessionPolicy = { sessionTimeoutMinutes: 480, singleDevice: false };

async function getPolicy(organizationId: string): Promise<SessionPolicy> {
  const supabase = createSupabaseService();
  const { data } = await supabase.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const stored = (settings.session_policy ?? {}) as Partial<SessionPolicy>;
  return {
    sessionTimeoutMinutes: Number(stored.sessionTimeoutMinutes) || DEFAULT_POLICY.sessionTimeoutMinutes,
    singleDevice: stored.singleDevice === true,
  };
}

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) return NextResponse.json({ ok: false, error }, { status: status ?? 401 });

  const supabase = createSupabaseService();
  let query = supabase
    .from("device_sessions")
    .select("id, profile_id, device_name, remember_device, created_at, last_active_at, expires_at")
    .eq("organization_id", actor.organizationId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_active_at", { ascending: false });
  if (!(actor.isOwner || actor.role === "manager")) query = query.eq("profile_id", actor.profileId);
  const { data, error: queryError } = await query;
  if (queryError) return NextResponse.json({ ok: false, error: queryError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    policy: await getPolicy(actor.organizationId),
    sessions: (data ?? []).map((session) => ({
      sessionId: session.id,
      profileId: session.profile_id,
      deviceName: session.device_name,
      createdAt: session.created_at,
      lastActiveAt: session.last_active_at,
      expiresAt: session.expires_at,
      rememberDevice: session.remember_device,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) return NextResponse.json({ ok: false, error }, { status: status ?? 401 });

  let body: {
    register?: boolean;
    deviceName?: string;
    rememberDevice?: boolean;
    sessionId?: string;
    profileId?: string;
    policy?: Partial<SessionPolicy>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const supabase = createSupabaseService();
  if (body.register) {
    const policy = await getPolicy(actor.organizationId);
    if (policy.singleDevice) {
      await supabase.from("device_sessions").update({ revoked_at: new Date().toISOString() })
        .eq("organization_id", actor.organizationId).eq("profile_id", actor.profileId).is("revoked_at", null);
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.sessionTimeoutMinutes * 60_000);
    const { data, error: insertError } = await supabase.from("device_sessions").insert({
      profile_id: actor.profileId,
      organization_id: actor.organizationId,
      device_token: randomBytes(32).toString("hex"),
      device_name: body.deviceName?.trim() || "Web browser",
      remember_device: body.rememberDevice === true,
      last_active_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }).select("id").single();
    if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    return NextResponse.json({ ok: true, sessionId: data.id });
  }

  if (body.policy) {
    if (!actor.isOwner) return NextResponse.json({ ok: false, error: "Only the owner can change session policy." }, { status: 403 });
    const current = await getPolicy(actor.organizationId);
    const next: SessionPolicy = {
      sessionTimeoutMinutes: Math.min(1440, Math.max(15, Number(body.policy.sessionTimeoutMinutes) || current.sessionTimeoutMinutes)),
      singleDevice: body.policy.singleDevice ?? current.singleDevice,
    };
    const { data: organization, error: orgError } = await supabase.from("organizations").select("settings").eq("id", actor.organizationId).single();
    if (orgError) return NextResponse.json({ ok: false, error: orgError.message }, { status: 500 });
    const settings = { ...((organization.settings ?? {}) as Record<string, unknown>), session_policy: next };
    const { error: updateError } = await supabase.from("organizations").update({ settings }).eq("id", actor.organizationId);
    if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    await logAuditEvent({ organizationId: actor.organizationId, actorProfileId: actor.profileId, actorEmail: actor.email, action: "session_policy_updated", entityType: "session_policy", description: "Session timeout/single-device policy updated." });
    return NextResponse.json({ ok: true, policy: next });
  }

  if (body.sessionId) {
    const { data: target } = await supabase.from("device_sessions").select("id, profile_id")
      .eq("id", body.sessionId).eq("organization_id", actor.organizationId).is("revoked_at", null).maybeSingle();
    if (!target) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
    if (target.profile_id !== actor.profileId && !(actor.isOwner || actor.role === "manager")) {
      return NextResponse.json({ ok: false, error: "You can only revoke your own sessions." }, { status: 403 });
    }
    await supabase.from("device_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", target.id);
    await logAuditEvent({ organizationId: actor.organizationId, actorProfileId: actor.profileId, actorEmail: actor.email, action: "session_revoked", entityType: "session", entityId: target.id, description: "Session revoked." });
    return NextResponse.json({ ok: true });
  }

  if (body.profileId) {
    if (!actor.isOwner) return NextResponse.json({ ok: false, error: "Only the owner can revoke another user's sessions." }, { status: 403 });
    const { data, error: revokeError } = await supabase.from("device_sessions").update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", actor.organizationId).eq("profile_id", body.profileId).is("revoked_at", null).select("id");
    if (revokeError) return NextResponse.json({ ok: false, error: revokeError.message }, { status: 500 });
    return NextResponse.json({ ok: true, revoked: data?.length ?? 0 });
  }

  return NextResponse.json({ ok: false, error: "Provide register, sessionId, profileId, or policy." }, { status: 400 });
}
