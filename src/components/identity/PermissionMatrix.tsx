"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";

interface MatrixRole {
  id: string;
  name: string;
  isBuiltIn: boolean;
}

const ALL_PERMISSIONS = [
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

export default function PermissionMatrix() {
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
    };
    return labels[p] ?? p;
  };
  const [roles, setRoles] = useState<MatrixRole[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/roles");
        const data = await res.json();
        if (data.ok) {
          const builtIn = (data.roles as MatrixRole[]).filter((r) => r.isBuiltIn);
          setRoles(builtIn);
          setMatrix(data.permissionMatrix || {});
        } else {
          setError(data.error || t('identity.matrix.loadFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('tracking.networkError'));
      }
    })();
  }, []);

  if (error) {
    return <p style={{ padding: "1.5rem", color: "#dc2626", fontSize: "0.875rem" }}>{error}</p>;
  }

  return (
    <div style={{ padding: "1.5rem", overflowX: "auto" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>
        {t('identity.matrix.title')}
      </h2>
      <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem", minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "2px solid #e5e7eb" }}>
              {t('identity.matrix.permission')}
            </th>
            {roles.map((role) => (
              <th
                key={role.id}
                style={{ padding: "0.5rem 0.75rem", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}
              >
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PERMISSIONS.map((permission) => (
            <tr key={permission}>
              <td style={{ padding: "0.375rem 0.75rem", borderBottom: "1px solid #f3f4f6" }}>
                {permissionLabel(permission)}
              </td>
              {roles.map((role) => {
                const has = (matrix[role.id] || []).includes(permission);
                return (
                  <td
                    key={role.id}
                    style={{
                      padding: "0.375rem 0.75rem",
                      borderBottom: "1px solid #f3f4f6",
                      textAlign: "center",
                      background: has ? "#dcfce7" : "transparent",
                      color: has ? "#166534" : "#d1d5db",
                    }}
                  >
                    {has ? "✓" : "—"}
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
