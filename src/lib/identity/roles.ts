import { BuiltInRole, ModulePermission, RoleDefinition, RoleType } from "./types";

const ALL_PERMISSIONS: ModulePermission[] = [
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
];

const VIEW_ONLY: ModulePermission[] = [
  "sales_view",
  "purchases_view",
  "inventory_view",
  "customers_view",
  "suppliers_view",
  "reports_view",
  "profit_view",
  "location_view",
  "ai_assistant",
];

export const LEGACY_PERMISSION_MAP: Record<string, ModulePermission> = {
  can_manage_products: "inventory_manage",
  can_manage_customers: "customers_manage",
  can_manage_suppliers: "suppliers_manage",
  can_create_purchases: "purchases_create",
  can_create_sales: "sales_create",
  can_manage_payments: "payments_manage",
  can_manage_expenses: "expenses_manage",
  can_view_profit: "profit_view",
  can_view_reports: "reports_view",
  can_manage_tasks: "tasks_manage",
  can_manage_settings: "settings_manage",
};

const BUILT_IN_ROLES: Record<BuiltInRole, RoleDefinition> = {
  owner: {
    id: "owner",
    name: "Owner",
    description: "Full access to all modules, administration, and settings.",
    permissions: [...ALL_PERMISSIONS],
    isBuiltIn: true,
    createdAt: "",
  },
  manager: {
    id: "manager",
    name: "Manager",
    description: "Day-to-day business operations and reporting, no administrative control.",
    permissions: [
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
    ],
    isBuiltIn: true,
    createdAt: "",
  },
  salesman: {
    id: "salesman",
    name: "Salesman",
    description: "Create sales, manage customers, and view inventory levels.",
    permissions: [
      "sales_view",
      "sales_create",
      "inventory_view",
      "customers_view",
      "customers_manage",
      "location_view",
      "ai_assistant",
    ],
    isBuiltIn: true,
    createdAt: "",
  },
  purchase_officer: {
    id: "purchase_officer",
    name: "Purchase Officer",
    description: "Create purchases, manage suppliers, and view inventory levels.",
    permissions: [
      "purchases_view",
      "purchases_create",
      "inventory_view",
      "suppliers_view",
      "suppliers_manage",
      "location_view",
      "ai_assistant",
    ],
    isBuiltIn: true,
    createdAt: "",
  },
  warehouse_staff: {
    id: "warehouse_staff",
    name: "Warehouse Staff",
    description: "Manage inventory stock and view inventory reports.",
    permissions: [
      "inventory_view",
      "inventory_manage",
      "reports_view",
      "location_view",
      "ai_assistant",
    ],
    isBuiltIn: true,
    createdAt: "",
  },
  viewer: {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to all business modules.",
    permissions: [...VIEW_ONLY],
    isBuiltIn: true,
    createdAt: "",
  },
};

let customRoles: RoleDefinition[] = [];

export function getRoleDefinitions(): RoleDefinition[] {
  return [...Object.values(BUILT_IN_ROLES), ...customRoles];
}

export function getRoleDefinition(role: RoleType): RoleDefinition | undefined {
  return getRoleDefinitions().find((r) => r.id === role);
}

export function getRolePermissions(role: RoleType): ModulePermission[] {
  const definition = getRoleDefinition(role);
  return definition ? definition.permissions : [];
}

export function hasPermission(role: RoleType | null | undefined, permission: ModulePermission): boolean {
  if (!role) {
    return false;
  }
  const definition = getRoleDefinition(role);
  if (!definition) {
    return false;
  }
  return definition.permissions.includes(permission);
}

export function canManageSettings(role: RoleType): boolean {
  return hasPermission(role, "settings_manage");
}

export function canAdministrate(role: RoleType): boolean {
  return hasPermission(role, "administration");
}

export function normalizeRoleName(role: string): RoleType {
  const normalized = role.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return normalized;
}

export function validateRoleName(role: string): string | null {
  if (!role || role.trim().length === 0) {
    return "Role name is required.";
  }
  if (role.trim().length > 50) {
    return "Role name must be 50 characters or fewer.";
  }
  if (Object.keys(BUILT_IN_ROLES).includes(role.trim().toLowerCase())) {
    return "A built-in role with this name already exists.";
  }
  if (customRoles.some((r) => r.id === normalizeRoleName(role))) {
    return "A custom role with this name already exists.";
  }
  return null;
}

export function createCustomRole(input: {
  name: string;
  description?: string;
  permissions: ModulePermission[];
}): { role?: RoleDefinition; error?: string } {
  const error = validateRoleName(input.name);
  if (error) {
    return { error };
  }
  const id = normalizeRoleName(input.name);
  const role: RoleDefinition = {
    id,
    name: input.name.trim(),
    description: input.description || "",
    permissions: input.permissions,
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
  };
  customRoles.push(role);
  return { role };
}

export function updateCustomRole(
  id: string,
  updates: { name?: string; description?: string; permissions?: ModulePermission[] },
): { role?: RoleDefinition; error?: string } {
  const index = customRoles.findIndex((r) => r.id === id);
  if (index === -1) {
    return { error: "Custom role not found." };
  }
  if (updates.name) {
    const nameError = validateRoleName(updates.name);
    if (nameError) {
      return { error: nameError };
    }
    customRoles[index].name = updates.name.trim();
    customRoles[index].id = normalizeRoleName(updates.name);
  }
  if (updates.description !== undefined) {
    customRoles[index].description = updates.description;
  }
  if (updates.permissions) {
    customRoles[index].permissions = updates.permissions;
  }
  return { role: customRoles[index] };
}

export function deleteCustomRole(id: string): { success: boolean; error?: string } {
  const index = customRoles.findIndex((r) => r.id === id);
  if (index === -1) {
    return { success: false, error: "Custom role not found." };
  }
  customRoles.splice(index, 1);
  return { success: true };
}

export function getPermissionsForRole(role: RoleType): ModulePermission[] {
  return getRolePermissions(role);
}

export function buildPermissionMatrix(roles: RoleType[]): Record<string, ModulePermission[]> {
  const matrix: Record<string, ModulePermission[]> = {};
  for (const role of roles) {
    matrix[role] = getRolePermissions(role);
  }
  return matrix;
}
