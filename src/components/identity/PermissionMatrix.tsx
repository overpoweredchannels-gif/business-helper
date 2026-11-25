"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { ALL_PERMISSIONS } from "@/lib/identity/roles";

interface MatrixRole {
  id: string;
  name: string;
  permissions: string[];
}

export default function PermissionMatrix({ rolesVersion }: { rolesVersion: number }) {
  const { t } = useRegional();
  const permissionLabel = (p: string) => {
    const labels: Record<string, string> = {
      sales_view: t('identity.roles.perm.salesView'),
      sales_create: t('identity.roles.perm.salesCreate'),
      sales_manage: t('identity.roles.perm.salesManage'),
      purchases_view: t('identity.roles.perm.purchasesView'),
      purchases_create: t('identity.roles.perm.purchasesCreate'),
      inventory_view: t('identity.roles.perm.inventoryView'),
      inventory_manage: t('identity.roles.perm.inventoryManage'),
      customers_view: t('identity.roles.perm.customersView'),
      customers_manage: t('identity.roles.perm.customersManage'),
      suppliers_view: t('identity.roles.perm.suppliersView'),
      suppliers_manage: t('identity.roles.perm.suppliersManage'),
      reports_view: t('identity.roles.perm.reportsView'),
      profit_view: t('identity.roles.perm.profitView'),
      payments_manage: t('identity.roles.perm.paymentsManage'),
      expenses_manage: t('identity.roles.perm.expensesManage'),
      tasks_manage: t('identity.roles.perm.tasksManage'),
      location_view: t('identity.roles.perm.locationView'),
      ai_assistant: t('identity.roles.perm.aiAssistant'),
      administration: t('identity.roles.perm.administration'),
      settings_manage: t('identity.roles.perm.settingsManage'),
      field_sales: t('identity.roles.perm.fieldSales'),
      draft_approval: t('identity.roles.perm.draftApproval'),
      import_export: t('identity.roles.perm.importExport'),
    };
    return labels[p] ?? p;
  };
  const [roles, setRoles] = useState<MatrixRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/roles", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (res.ok && data.ok) {
          setRoles(data.roles as MatrixRole[]);
          setError(null);
        } else {
          setError(typeof data.error === "string" ? data.error : "");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "");
      }
    })();
    return () => { active = false; };
  }, [rolesVersion]);

  if (error !== null) {
    return <p className="p-6 text-sm text-destructive" role="alert">{error || t('identity.matrix.loadFailed')}</p>;
  }

  return (
    <div className="overflow-x-auto p-6">
      <h2 className="mb-4 text-xl font-semibold">
        {t('identity.matrix.title')}
      </h2>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="border-b-2 border-border px-3 py-2 text-start">
              {t('identity.matrix.permission')}
            </th>
            {roles.map((role) => (
              <th
                key={role.id}
                scope="col"
                className="border-b-2 border-border px-3 py-2 text-center"
              >
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PERMISSIONS.map((permission) => (
            <tr key={permission}>
              <th scope="row" className="border-b border-border px-3 py-2 text-start font-medium">
                {permissionLabel(permission)}
              </th>
              {roles.map((role) => {
                const has = role.permissions.includes(permission);
                return (
                  <td
                    key={role.id}
                    className={`border-b border-border px-3 py-2 text-center ${has ? "bg-success/10 text-success" : "text-muted-foreground"}`}
                  >
                    <span aria-hidden="true">{has ? "✓" : "—"}</span>
                    <span className="sr-only">{t(has ? 'common.yes' : 'common.no')}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
