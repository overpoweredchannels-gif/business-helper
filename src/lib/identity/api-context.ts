import { NextRequest } from "next/server";
import { createSupabaseService, createSupabaseUserClient } from "../supabase/server";
import { normalizeRole } from "./permissions";
import { getRolePermissions, LEGACY_PERMISSION_MAP } from "./roles";
import { RoleRepository } from "./repositories/role-repository";
import { sectionPermissionMap } from "@/lib/tradeos/constants";
import type { ActorContext } from "./types";
import type { ModulePermission } from "./types";
import type { PermissionContext } from "./permissions";

export type ApiActor = ActorContext;

export interface OrganizationContext {
  actor: ApiActor;
  permissionContext: PermissionContext;
}

export function buildOrganizationContext(actor: ApiActor): OrganizationContext {
  return {
    actor,
    permissionContext: {
      role: actor.role,
      organizationId: actor.organizationId,
      profileId: actor.profileId,
      email: actor.email,
      isOwner: actor.isOwner,
    },
  };
}

export async function resolveActor(
  request: NextRequest | Request,
): Promise<{ actor?: ApiActor; error?: string; status?: number }> {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return { error: "Missing authorization token.", status: 401 };
  }
  const token = authorization.slice(7).trim();

  let supabase;
  try {
    supabase = createSupabaseUserClient(token);
  } catch (err) {
    return {
      error: `Supabase is not configured: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { error: "Invalid or expired session token.", status: 401 };
  }
  const userId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return { error: `Profile lookup failed: ${profileError.message}`, status: 500 };
  }
  if (!profile) {
    return { error: "No workspace profile found for this user.", status: 404 };
  }
  if (profile.is_active === false) {
    return { error: "This account has been deactivated.", status: 403 };
  }

  const role = normalizeRole(profile.role);

  // Merge fine-grained staff_permissions (the source of truth the owner uses
  // in Staff & Permissions) so staff on custom roles (e.g. "staff", "sales")
  // can actually exercise the API actions their granted sections allow.
  let extraPermissions: string[] = [];
  try {
    const service = createSupabaseService();
    const { data: staffPermRow } = await service
      .from("staff_permissions")
      .select("*")
      .eq("profile_id", profile.id)
      .eq("organization_id", profile.organization_id)
      .maybeSingle();

    const row = staffPermRow as Record<string, unknown> | null;
    for (const [legacyField, permission] of Object.entries(LEGACY_PERMISSION_MAP)) {
      if (row && row[legacyField] === true) {
        extraPermissions.push(permission);
      }
    }
    const granted = Array.isArray(row?.granted_sections)
      ? (row.granted_sections as string[])
      : [];
    for (const sectionId of granted) {
      const required = sectionPermissionMap[sectionId as keyof typeof sectionPermissionMap];
      if (required && required !== "owner_admin") {
        const mapped = LEGACY_PERMISSION_MAP[required as keyof typeof LEGACY_PERMISSION_MAP];
        if (mapped) {
          extraPermissions.push(mapped);
        }
      }
    }
  } catch {
    // Non-fatal: fall back to role-based permissions only
  }

  let rolePermissions = role ? getRolePermissions(role) : [];
  if (role && rolePermissions.length === 0) {
    try {
      const customRole = await new RoleRepository().find(profile.organization_id, role);
      rolePermissions = customRole?.permissions ?? [];
    } catch {
      rolePermissions = [];
    }
  }
  const mergedPermissions = Array.from(
    new Set([...rolePermissions, ...extraPermissions])
  ) as ModulePermission[];

  return {
    actor: {
      profileId: profile.id,
      organizationId: profile.organization_id,
      email: userData.user.email ?? null,
      role,
      isOwner: role === "owner",
      isActive: profile.is_active !== false,
      permissions: mergedPermissions,
    },
  };
}
