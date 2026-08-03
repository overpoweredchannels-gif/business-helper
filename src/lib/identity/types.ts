export type ModulePermission =
  | "sales_view"
  | "sales_create"
  | "sales_manage"
  | "purchases_view"
  | "purchases_create"
  | "inventory_view"
  | "inventory_manage"
  | "customers_view"
  | "customers_manage"
  | "suppliers_view"
  | "suppliers_manage"
  | "reports_view"
  | "profit_view"
  | "payments_manage"
  | "expenses_manage"
  | "tasks_manage"
  | "location_view"
  | "ai_assistant"
  | "administration"
  | "settings_manage";

export type BuiltInRole =
  | "owner"
  | "manager"
  | "salesman"
  | "purchase_officer"
  | "warehouse_staff"
  | "viewer";

export type RoleType = BuiltInRole | string;

export type PermissionAction = ModulePermission;

export interface ActorContext {
  profileId: string;
  organizationId: string;
  email: string | null;
  role: RoleType | null;
  isOwner: boolean;
  isActive: boolean;
  permissions?: ModulePermission[];
}

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: ModulePermission[];
  isBuiltIn: boolean;
  createdAt: string;
}

export interface SessionInfo {
  sessionId: string;
  profileId: string;
  organizationId: string;
  deviceToken: string;
  deviceName: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revoked: boolean;
  rememberDevice: boolean;
}

export interface AuditEntry {
  id: string;
  organizationId: string;
  actorProfileId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string | null;
  createdAt: string;
  success: boolean;
}

export interface Invitation {
  code: string;
  organizationId: string;
  email: string;
  role: RoleType;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}
