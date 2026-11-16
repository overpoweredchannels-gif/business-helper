import { resolveActor } from "./api-context";
import type { ActorContext, PermissionAction } from "./types";

export type AuthorizationResult = {
  allowed: boolean;
  reason?: string;
  actor?: ActorContext;
};

function asAuthorizationResult(allowed: boolean, reason?: string, actor?: ActorContext): AuthorizationResult {
  return { allowed, reason, actor };
}

export async function requireOwner(request: Request): Promise<AuthorizationResult> {
  try {
    const context = await resolveActor(request);
    if (!context.actor) {
      return asAuthorizationResult(false, "Authentication required", context.actor);
    }
    if (!context.actor.isOwner) {
      return asAuthorizationResult(false, "Owner access required", context.actor);
    }
    return asAuthorizationResult(true, undefined, context.actor);
  } catch {
    return asAuthorizationResult(false, "Unable to resolve actor context");
  }
}

export async function requirePermission(request: Request, action: PermissionAction): Promise<AuthorizationResult> {
  try {
    const context = await resolveActor(request);
    if (!context.actor) {
      return asAuthorizationResult(false, "Authentication required", context.actor);
    }
    if (context.actor.role === "owner") {
      return asAuthorizationResult(true, undefined, context.actor);
    }
    if (context.actor.permissions?.includes(action)) {
      return asAuthorizationResult(true, undefined, context.actor);
    }
    return asAuthorizationResult(false, `Permission required: ${action}`, context.actor);
  } catch {
    return asAuthorizationResult(false, "Unable to resolve actor context");
  }
}

export async function requireRole(request: Request, role: string): Promise<AuthorizationResult> {
  try {
    const context = await resolveActor(request);
    if (!context.actor) {
      return asAuthorizationResult(false, "Authentication required", context.actor);
    }
    if (context.actor.role === role) {
      return asAuthorizationResult(true, undefined, context.actor);
    }
    return asAuthorizationResult(false, `Role required: ${role}`, context.actor);
  } catch {
    return asAuthorizationResult(false, "Unable to resolve actor context");
  }
}

export async function requireOrganization(request: Request): Promise<AuthorizationResult> {
  try {
    const context = await resolveActor(request);
    if (!context.actor?.organizationId) {
      return asAuthorizationResult(false, "Organization context required", context.actor);
    }
    return asAuthorizationResult(true, undefined, context.actor);
  } catch {
    return asAuthorizationResult(false, "Unable to resolve organization context");
  }
}

/**
 * Route-level auth for AI endpoints (P0-5, 2026-11-16): any signed-in user
 * with an organization may call them — owner or staff. The AI chat is used
 * by staff as well as the owner, so this is deliberately NOT owner-only;
 * the conversation runtime's own permission checks still gate any action
 * the chat tries to perform. Returns the actor, or a failure carrying the
 * HTTP status the route should answer with: 401 when there is no session
 * at all, 403 when the session has no organization, 500 when the actor
 * context itself cannot be resolved. Fail closed in every case.
 */
export async function requireAuthenticatedOrg(request: Request): Promise<
  | { ok: true; actor: ActorContext }
  | { ok: false; status: 401 | 403 | 500; error: string }
> {
  const result = await requireOrganization(request);
  if (result.allowed && result.actor) {
    return { ok: true, actor: result.actor };
  }
  if (!result.actor) {
    if (result.reason === "Unable to resolve organization context") {
      return { ok: false, status: 500, error: result.reason };
    }
    return { ok: false, status: 401, error: "Authentication required" };
  }
  return { ok: false, status: 403, error: result.reason ?? "Organization context required" };
}

export function requireOwnerDirect(actor: ActorContext): AuthorizationResult {
  if (!actor) {
    return asAuthorizationResult(false, "Authentication required");
  }
  if (!actor.isOwner) {
    return asAuthorizationResult(false, "Owner access required", actor);
  }
  return asAuthorizationResult(true, undefined, actor);
}

export function requirePermissionDirect(actor: ActorContext, action: PermissionAction): AuthorizationResult {
  if (!actor) {
    return asAuthorizationResult(false, "Authentication required");
  }
  if (actor.role === "owner") {
    return asAuthorizationResult(true, undefined, actor);
  }
  if (actor.permissions?.includes(action)) {
    return asAuthorizationResult(true, undefined, actor);
  }
  return asAuthorizationResult(false, `Permission required: ${action}`, actor);
}

export function requireRoleDirect(actor: ActorContext, role: string): AuthorizationResult {
  if (!actor) {
    return asAuthorizationResult(false, "Authentication required");
  }
  if (actor.role === role) {
    return asAuthorizationResult(true, undefined, actor);
  }
  return asAuthorizationResult(false, `Role required: ${role}`, actor);
}

export function requireOrganizationDirect(actor: ActorContext): AuthorizationResult {
  if (!actor?.organizationId) {
    return asAuthorizationResult(false, "Organization context required", actor);
  }
  return asAuthorizationResult(true, undefined, actor);
}

export async function getAuthenticatedActor(request: Request): Promise<ActorContext | null> {
  const context = await resolveActor(request);
  return context.actor ?? null;
}

export async function assertAuthorized(request: Request, action: PermissionAction): Promise<ActorContext> {
  const result = await requirePermission(request, action);
  if (!result.allowed || !result.actor) {
    throw new Error(result.reason ?? "Forbidden");
  }
  return result.actor;
}
