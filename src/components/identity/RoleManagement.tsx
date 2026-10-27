"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";

interface RoleView {
  id: string;
  name: string;
  description: string;
  permissions: string[];
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

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem 0",
  borderBottom: "1px solid #e5e7eb",
  gap: "1rem",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#111827",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

export default function RoleManagement() {
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
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [permissionMatrix, setPermissionMatrix] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPermissions, setNewPermissions] = useState<string[]>([]);

  const loadRoles = async () => {
    try {
      const res = await authorizedFetch("/api/identity/roles");
      const data = await res.json();
      if (data.ok) {
        setRoles(data.roles || []);
        setPermissionMatrix(data.permissionMatrix || {});
        setError(null);
      } else {
        setError(data.error || t('identity.roles.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const togglePermission = (permission: string) => {
    setNewPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  };

  const createRole = async () => {
    if (!newName.trim()) return;
    const res = await authorizedFetch("/api/identity/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription, permissions: newPermissions }),
    });
    const data = await res.json();
    if (data.ok) {
      setShowCreate(false);
      setNewName("");
      setNewDescription("");
      setNewPermissions([]);
      loadRoles();
    } else {
      setError(data.error || t('identity.roles.createFailed'));
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>{t('identity.roles.title')}</h2>
        <button style={buttonStyle} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? t('common.cancel') : t('identity.roles.newCustomRole')}
        </button>
      </div>

      {error && (
        <p style={{ color: "#dc2626", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</p>
      )}

      {showCreate && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <input
              style={inputStyle}
              placeholder={t('identity.roles.roleNamePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder={t('identity.roles.descriptionPlaceholder')}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
            {ALL_PERMISSIONS.map((permission) => (
              <label
                key={permission}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.8125rem",
                  background: newPermissions.includes(permission) ? "#e0e7ff" : "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={newPermissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                />
                {permissionLabel(permission)}
              </label>
            ))}
          </div>
          <button style={buttonStyle} onClick={createRole} disabled={!newName.trim()}>
            {t('identity.roles.createRole')}
          </button>
        </div>
      )}

      {roles.map((role) => (
        <div key={role.id} style={rowStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{role.name}</span>
              {role.isBuiltIn && (
                <span
                  style={{
                    fontSize: "0.6875rem",
                    background: "#e5e7eb",
                    borderRadius: "999px",
                    padding: "0.125rem 0.5rem",
                    color: "#4b5563",
                  }}
                >
                  {t('identity.roles.builtIn')}
                </span>
              )}
            </div>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#6b7280" }}>
              {role.description || t('identity.roles.permissionsCount').replace('{count}', String(role.permissions.length))}
            </p>
          </div>
          <span style={{ fontSize: "0.8125rem", color: "#374151", whiteSpace: "nowrap" }}>
            {t('identity.roles.permissionsCount').replace('{count}', String(role.permissions.length))}
          </span>
        </div>
      ))}
    </div>
  );
}
