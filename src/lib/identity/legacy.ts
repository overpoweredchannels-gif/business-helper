import { ModulePermission, RoleType } from "./types";
import { getRolePermissions } from "./roles";

export interface LegacyPermissionRow {
  organization_id: string;
  profile_id: string;
  can_manage_products: boolean;
  can_manage_customers: boolean;
  can_manage_suppliers: boolean;
  can_create_purchases: boolean;
  can_create_sales: boolean;
  can_manage_payments: boolean;
  can_manage_expenses: boolean;
  can_view_profit: boolean;
  can_view_reports: boolean;
  can_manage_tasks: boolean;
  can_manage_settings: boolean;
}

const LEGACY_FIELD_BY_PERMISSION: Partial<
  Record<ModulePermission, keyof Omit<LegacyPermissionRow, "organization_id" | "profile_id">>
> = {
  sales_view: undefined,
  sales_create: "can_create_sales",
  sales_manage: "can_create_sales",
  purchases_view: undefined,
  purchases_create: "can_create_purchases",
  inventory_view: undefined,
  inventory_manage: "can_manage_products",
  customers_view: undefined,
  customers_manage: "can_manage_customers",
  suppliers_view: undefined,
  suppliers_manage: "can_manage_suppliers",
  reports_view: "can_view_reports",
  profit_view: "can_view_profit",
  payments_manage: "can_manage_payments",
  expenses_manage: "can_manage_expenses",
  tasks_manage: "can_manage_tasks",
  location_view: undefined,
  ai_assistant: undefined,
  administration: undefined,
  settings_manage: "can_manage_settings",
};

export function buildLegacyPermissionRow(organizationId: string, profileId: string, role: RoleType): LegacyPermissionRow {
  const permissions = getRolePermissions(role);
  const base: LegacyPermissionRow = {
    organization_id: organizationId,
    profile_id: profileId,
    can_manage_products: false,
    can_manage_customers: false,
    can_manage_suppliers: false,
    can_create_purchases: false,
    can_create_sales: false,
    can_manage_payments: false,
    can_manage_expenses: false,
    can_view_profit: false,
    can_view_reports: false,
    can_manage_tasks: false,
    can_manage_settings: false,
  };
  for (const permission of permissions) {
    const field = LEGACY_FIELD_BY_PERMISSION[permission];
    if (field) {
      base[field] = true;
    }
  }
  return base;
}
