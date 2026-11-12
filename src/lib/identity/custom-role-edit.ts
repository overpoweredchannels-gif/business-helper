import type { ModulePermission } from "./types";

// Custom roles edit/delete slice.
//
// The roles API accepts these 23 permissions (mirror of
// ALL_MODULE_PERMISSIONS in src/app/api/identity/roles/route.ts). The
// roles UI used to offer only 20 of them — field_sales, draft_approval
// and import_export could never be assigned from the app — so this list
// is the single source of truth for both the create/edit form and the
// server-side filter.
export const CUSTOM_ROLE_PERMISSIONS: ModulePermission[] = [
  "sales_view",
  "sales_create",
  "sales_manage",
  "purchases_view",
  "purchases_create",
  "inventory_view",
  "inventory_manage",
  "customers_view",
  "customers_manage",
  "suppliers_view",
  "suppliers_manage",
  "reports_view",
  "profit_view",
  "payments_manage",
  "expenses_manage",
  "tasks_manage",
  "location_view",
  "ai_assistant",
  "administration",
  "settings_manage",
  "field_sales",
  "draft_approval",
  "import_export",
];

const BUILT_IN_ROLE_NAMES = [
  "owner",
  "manager",
  "salesman",
  "purchase_officer",
  "warehouse_staff",
  "viewer",
  "delivery_rider",
  "field_officer",
  "collection_officer",
  "supervisor",
];

// Static name rules for a custom role, mirroring validateRoleName in
// ./roles.ts — except the duplicate check there reads an in-memory array
// that is never populated (the live roles live in the database), so the
// duplicate check is a separate function below that takes the org's
// existing roles as input.
export function validateCustomRoleEditName(name: string): string | null {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) {
    return "Role name is required.";
  }
  if (trimmed.length > 50) {
    return "Role name must be 50 characters or fewer.";
  }
  if (BUILT_IN_ROLE_NAMES.includes(trimmed.toLowerCase())) {
    return "A built-in role with this name already exists.";
  }
  return null;
}

// True when another role in the same organization already carries this
// name (case-insensitive, ignoring surrounding whitespace). The role
// being edited is excluded by id — renaming a role to its own current
// name is not a duplicate. A rename never changes the role id (the id
// is derived from the name only at creation), so staff profiles that
// reference the id are unaffected by a rename.
export function isDuplicateCustomRoleName(
  name: string,
  existing: Array<{ id: string; name: string }>,
  excludeId?: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return existing.some(
    (role) => role.id !== excludeId && role.name.trim().toLowerCase() === wanted,
  );
}

// Keep only permissions the API accepts. The PATCH route used to pass
// the body through unfiltered, so a bad permission string could be
// stored on the role; the POST route already filters this way.
export function filterAllowedPermissions(permissions: unknown): ModulePermission[] {
  if (!Array.isArray(permissions)) {
    return [];
  }
  const allowed = new Set<ModulePermission>(CUSTOM_ROLE_PERMISSIONS);
  return permissions.filter((item): item is ModulePermission => allowed.has(item as ModulePermission));
}

// Delete-block message. profiles.role is a free-text role id with no
// foreign key to role_definitions, so a delete can never fail at the
// database level — this message is the only thing standing between a
// delete and staff members left holding a role that no longer exists
// (a dangling role resolves to zero permissions). The count is the
// number of profiles in the organization whose role is this role id,
// active or not: the reference exists either way.
export function buildRoleDeleteBlockedMessage(roleName: string, holderCount: number): string {
  return `Cannot delete ${roleName}: ${holderCount} staff member(s) still have this role. Reassign them to another role first.`;
}
