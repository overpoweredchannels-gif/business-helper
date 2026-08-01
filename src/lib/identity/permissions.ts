import { ModulePermission, RoleType } from "./types";
import { hasPermission, normalizeRoleName, getRoleDefinitions } from "./roles";

export const ACTION_PERMISSION_MAP: Record<string, ModulePermission[]> = {
  create_sale: ["sales_create"],
  create_purchase: ["purchases_create"],
  create_expense: ["expenses_manage"],
  create_task: ["tasks_manage"],
  create_customer: ["customers_manage"],
  create_supplier: ["suppliers_manage"],
  create_product: ["inventory_manage"],
  assign_staff: ["administration"],
  reassign_staff: ["administration"],
  remove_staff: ["administration"],
  staff_query: ["administration", "location_view"],
  inventory_query: ["inventory_view"],
  location_query: ["location_view"],
  business_query: ["reports_view"],
  market_intelligence: ["ai_assistant"],
};

export interface PermissionContext {
  role: RoleType | null;
  organizationId: string | null;
  profileId: string | null;
  email: string | null;
  isOwner?: boolean;
}

export interface PermissionCheckResult {
  allowed: boolean;
  action: string;
  requiredPermissions: ModulePermission[];
  deniedBy: string | null;
  message: string;
  context: PermissionContext;
}

export function checkActionPermission(
  action: string,
  context: PermissionContext,
): PermissionCheckResult {
  const required = ACTION_PERMISSION_MAP[action] || ["ai_assistant"];
  const role = context.role;
  const isOwner = context.isOwner || role === "owner";

  const missing = required.filter((permission) => {
    if (isOwner) {
      return false;
    }
    return !hasPermission(role, permission);
  });

  if (missing.length > 0) {
    return {
      allowed: false,
      action,
      requiredPermissions: required,
      deniedBy: "role_permission",
      message: `You don't have permission to perform this action. This action requires the following permissions: ${missing.join(", ")}. Please ask your store owner or manager to grant you access.`,
      context,
    };
  }

  return {
    allowed: true,
    action,
    requiredPermissions: required,
    deniedBy: null,
    message: "",
    context,
  };
}

export function verifyIdentity(ctx: PermissionContext): { valid: boolean; reason: string | null } {
  if (!ctx.profileId) {
    return { valid: false, reason: "identity_not_found" };
  }
  if (!ctx.organizationId) {
    return { valid: false, reason: "organization_not_found" };
  }
  if (!ctx.role) {
    return { valid: false, reason: "role_not_assigned" };
  }
  return { valid: true, reason: null };
}

export function isActionAllowedForRole(action: string, role: RoleType | null): boolean {
  const required = ACTION_PERMISSION_MAP[action] || ["ai_assistant"];
  if (role === "owner") {
    return true;
  }
  if (!role) {
    return false;
  }
  return required.every((p) => hasPermission(role, p));
}

export function allowedActionsForRole(role: RoleType | null): string[] {
  if (role === "owner") {
    return Object.keys(ACTION_PERMISSION_MAP);
  }
  if (!role) {
    return [];
  }
  return Object.keys(ACTION_PERMISSION_MAP).filter((action) =>
    isActionAllowedForRole(action, role),
  );
}

export function normalizeRole(role: string | null | undefined): RoleType | null {
  if (!role) {
    return null;
  }
  const normalized = normalizeRoleName(role);
  return normalized || null;
}

export function roleExists(role: RoleType | null): boolean {
  if (!role) {
    return false;
  }
  return getRoleDefinitions().some((r) => r.id === role);
}
