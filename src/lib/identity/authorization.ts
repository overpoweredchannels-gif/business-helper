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
