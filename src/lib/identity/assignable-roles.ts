import { staffRoles } from "@/lib/tradeos/constants";
import { getRolePermissions, hasPermission } from "./roles";
import { filterAllowedPermissions } from "./custom-role-edit";
import type { ModulePermission } from "./types";

// Custom role assignment slice.
//
// The staff Role dropdown in Staff & Permissions used to list only the
// 11 built-in staffRoles, and both the client save (page.tsx) and the
// server (profiles route + ProfileService) rejected any role id outside
// that list — so a custom role could never be assigned to a staff
// member, and the delete-block could never trigger live.
//
// The assignable list is the built-in staffRoles (label = id, exactly
// as before) plus the org's custom roles fetched from GET
// /api/identity/roles (label = the role's display name, value = its
// org-prefixed id). profiles.role is free-text with no enum or foreign
// key, so assigning a custom role id needs no DB migration.
//
// Effective permissions: the server API already resolves a custom
// role's permissions (api-context.ts falls back to RoleRepository when
// the in-memory role definition is empty). The client resolves the
// same way here — built-in roles through roles.ts, custom roles through
// the fetched list — because the in-memory customRoles array in
// roles.ts is never populated (the live roles live in the database).

export type AssignableRole = {
  id: string;
  name: string;
  isBuiltIn: boolean;
  permissions: ModulePermission[];
};

export type CustomRoleInput = {
  id: string;
  name: string;
  // Raw strings as they arrive from GET /api/identity/roles (JSON).
  // buildAssignableRoles filters them to the 23 permissions the API
  // accepts, so a stale or hand-edited stored value can never grant
  // a permission the role does not have.
  permissions: string[];
};

export function buildAssignableRoles(customRoles: CustomRoleInput[]): AssignableRole[] {
  const builtIn: AssignableRole[] = staffRoles.map((id) => ({
    id,
    name: id,
    isBuiltIn: true,
    permissions: getRolePermissions(id),
  }));
  const custom: AssignableRole[] = customRoles.map((role) => ({
    id: role.id,
    name: role.name,
    isBuiltIn: false,
    permissions: filterAllowedPermissions(role.permissions),
  }));
  return [...builtIn, ...custom];
}

export function isAssignableRoleId(roleId: string, roles: AssignableRole[]): boolean {
  return roles.some((role) => role.id === roleId);
}

// True when the role grants the permission. Built-in roles resolve
// through roles.ts; custom roles resolve through the fetched list.
// A dangling role id (deleted custom role, typo) grants nothing.
export function hasAssignableRolePermission(
  roleId: string | null | undefined,
  permission: ModulePermission,
  customRoles: CustomRoleInput[],
): boolean {
  if (!roleId) return false;
  if (hasPermission(roleId, permission)) return true;
  const custom = customRoles.find((role) => role.id === roleId);
  return custom ? custom.permissions.includes(permission) : false;
}
