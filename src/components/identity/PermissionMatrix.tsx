"use client";

import { useState, useEffect } from "react";

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

const PERMISSION_LABELS: Record<string, string> = {
  sales_view: "View Sales",
  sales_create: "Create Sales",
  sales_manage: "Manage Sales",
  purchases_view: "View Purchases",
  purchases_create: "Create Purchases",
  inventory_view: "View Inventory",
  inventory_manage: "Manage Inventory",
  customers_view: "View Customers",
  customers_manage: "Manage Customers",
  suppliers_view: "View Suppliers",
  suppliers_manage: "Manage Suppliers",
  reports_view: "View Reports",
  profit_view: "View Profit",
  payments_manage: "Manage Payments",
  expenses_manage: "Manage Expenses",
  tasks_manage: "Manage Tasks",
  location_view: "View Locations",
  ai_assistant: "AI Assistant",
  administration: "Administration",
  settings_manage: "Manage Settings",
};

export default function PermissionMatrix() {
  const [roles, setRoles] = useState<MatrixRole[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/identity/roles");
        const data = await res.json();
        if (data.ok) {
          const builtIn = (data.roles as MatrixRole[]).filter((r) => r.isBuiltIn);
          setRoles(builtIn);
          setMatrix(data.permissionMatrix || {});
        } else {
          setError(data.error || "Failed to load permission matrix");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    })();
  }, []);

  if (error) {
    return <p style={{ padding: "1.5rem", color: "#dc2626", fontSize: "0.875rem" }}>{error}</p>;
  }

  return (
    <div style={{ padding: "1.5rem", overflowX: "auto" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>
        Permission Matrix
      </h2>
      <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem", minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "2px solid #e5e7eb" }}>
              Permission
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
                {PERMISSION_LABELS[permission] || permission}
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
