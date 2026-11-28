"use client";

import { useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { dashboardPermissions, type DashboardPermission, type DashboardPermissionFlags } from "@/lib/identity/dashboard-permissions";

export function StaffDashboardGrants({ grants, onSave }: {
  grants: DashboardPermissionFlags;
  onSave: (flags: Record<DashboardPermission, boolean>) => Promise<void>;
}) {
  const { t } = useRegional();
  const [draft, setDraft] = useState({
    dashboard_view: grants.dashboard_view === true,
    dashboard_export: grants.dashboard_export === true,
  });
  const [saving, setSaving] = useState(false);
  const labels = { dashboard_view: t("staff.dashboardView"), dashboard_export: t("staff.dashboardExport") };
  const dirty = dashboardPermissions.some(key => draft[key] !== (grants[key] === true));

  return (
    <fieldset className="mt-4 rounded-lg border border-border p-4">
      <legend className="px-2 font-medium">{t("staff.dashboardReview")}</legend>
      <p className="mb-2 text-sm text-muted-foreground">{t("staff.dashboardPermissionsHint")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {dashboardPermissions.map(key => (
          <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm">
            <input type="checkbox" checked={draft[key]} disabled={saving}
              className="accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))} />
            {labels[key]}
          </label>
        ))}
      </div>
      <button type="button" className="workspace-button-secondary mt-2" disabled={!dirty || saving} onClick={async () => {
        setSaving(true);
        try { await onSave(draft); } finally { setSaving(false); }
      }}>{saving ? t("sell.saving") : t("staff.dashboardSave")}</button>
    </fieldset>
  );
}
