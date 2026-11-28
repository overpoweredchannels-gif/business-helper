export const dashboardPermissions = ["dashboard_view", "dashboard_export"] as const;

export type DashboardPermission = typeof dashboardPermissions[number];
export type DashboardPermissionFlags = Partial<Record<DashboardPermission, boolean | null>>;

type DashboardActor = { id: string; role?: string | null; is_active?: boolean | null };
type StaffDashboardGrants = DashboardPermissionFlags & {
  organization_id: string;
  profile_id: string;
  granted_sections?: string[];
};

export function resolveDashboardAccess(
  actor: DashboardActor | null,
  organizationId: string | null,
  grants: StaffDashboardGrants | null | undefined,
) {
  if (!actor || !organizationId || actor.is_active === false) {
    return { ownerOrAdmin: false, view: false, profit: false, export: false };
  }
  if (actor.role === "owner" || actor.role === "admin") {
    return { ownerOrAdmin: true, view: true, profit: true, export: true };
  }
  const ownGrants = grants?.organization_id === organizationId && grants.profile_id === actor.id ? grants : null;
  const view = ownGrants?.dashboard_view === true;
  // Legacy booleans can come from role defaults. Only the per-person
  // Profit & Loss section grant unlocks profit in an organization dashboard.
  const profit = ownGrants?.granted_sections?.includes("profit-loss") === true;
  return { ownerOrAdmin: false, view, profit: view && profit, export: view && ownGrants?.dashboard_export === true };
}
