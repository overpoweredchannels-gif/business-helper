import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import {
  getActiveSessionsForOrg,
  revokeSessionById,
  getActiveSessions,
  sessionManager,
} from "@/lib/identity/sessions";
import { logAuditEvent } from "@/lib/identity/audit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }

  if (actor.isOwner || actor.role === "manager") {
    const sessions = getActiveSessionsForOrg(actor.organizationId);
    return NextResponse.json({
      ok: true,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        profileId: s.profileId,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
        rememberDevice: s.rememberDevice,
      })),
    });
  }

  const sessions = getActiveSessions(actor.profileId);
  return NextResponse.json({
    ok: true,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      profileId: s.profileId,
      deviceName: s.deviceName,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      rememberDevice: s.rememberDevice,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }

  let body: { sessionId?: string; profileId?: string; policy?: { sessionTimeoutMinutes?: number; singleDevice?: boolean } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.policy) {
    if (!actor.isOwner) {
      return NextResponse.json({ ok: false, error: "Only the owner can change session policy." }, { status: 403 });
    }
    const policy = sessionManager.getPolicy();
    sessionManager.setPolicy({
      sessionTimeoutMinutes: body.policy.sessionTimeoutMinutes ?? policy.sessionTimeoutMinutes,
      singleDevice: body.policy.singleDevice ?? policy.singleDevice,
    });
    logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "session_policy_updated",
      entityType: "session_policy",
      description: "Session timeout/single-device policy updated.",
      success: true,
    });
    return NextResponse.json({ ok: true, policy: sessionManager.getPolicy() });
  }

  if (body.sessionId) {
    const result = revokeSessionById(body.sessionId);
    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error ?? "Session not found." }, { status: 404 });
    }
    logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "session_revoked",
      entityType: "session",
      entityId: body.sessionId,
      description: "Session revoked.",
      success: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.profileId) {
    if (!actor.isOwner) {
      return NextResponse.json({ ok: false, error: "Only the owner can revoke another user's sessions." }, { status: 403 });
    }
    const { revokeAllForProfile } = await import("@/lib/identity/sessions");
    const count = revokeAllForProfile(body.profileId);
    logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "all_sessions_revoked",
      entityType: "profile",
      entityId: body.profileId,
      description: `Revoked ${count} session(s) for the user.`,
      success: true,
    });
    return NextResponse.json({ ok: true, revoked: count });
  }

  return NextResponse.json({ ok: false, error: "Provide sessionId, profileId, or policy." }, { status: 400 });
}
