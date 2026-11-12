"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { CUSTOM_ROLE_PERMISSIONS } from "@/lib/identity/custom-role-edit";

interface RoleView {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isBuiltIn: boolean;
}

// The full permission set the roles API accepts. The form used to offer
// only the first 20 — field_sales, draft_approval and import_export could
// never be assigned from the app. Labels live under identity.roles.perm.*.
const ALL_PERMISSIONS = [...CUSTOM_ROLE_PERMISSIONS];

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
  minHeight: "44px",
  background: "#111827",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#fff",
  color: "#dc2626",
  border: "1px solid #dc2626",
};

export default function RoleManagement({
  onRequestConfirm,
}: {
  // The page-level in-app confirmation dialog (the same setConfirmDialog
  // the void dialog and the supplier archive use). RoleManagement renders
  // inside the page, so the delete confirm goes through it instead of a
  // native popup — window.confirm silently no-ops wherever the native
  // dialog does not resolve.
  onRequestConfirm: (dialog: {
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) => void;
}) {
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
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [permissionMatrix, setPermissionMatrix] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  // One form serves both create and edit, exactly as the create form was:
  // formRoleId null means create, set means edit that role (prefilled).
  const [showForm, setShowForm] = useState(false);
  const [formRoleId, setFormRoleId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);

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
    setFormPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  };

  const closeForm = () => {
    setShowForm(false);
    setFormRoleId(null);
    setFormName("");
    setFormDescription("");
    setFormPermissions([]);
  };

  const openCreateRole = () => {
    closeForm();
    setShowForm(true);
  };

  const openEditRole = (role: RoleView) => {
    setFormRoleId(role.id);
    setFormName(role.name);
    setFormDescription(role.description);
    setFormPermissions(role.permissions);
    setShowForm(true);
    setError(null);
  };

  const submitForm = async () => {
    if (!formName.trim()) return;
    const isEdit = formRoleId !== null;
    const res = await authorizedFetch(
      isEdit ? `/api/identity/roles/${encodeURIComponent(formRoleId)}` : "/api/identity/roles",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, description: formDescription, permissions: formPermissions }),
      },
    );
    const data = await res.json();
    if (data.ok) {
      closeForm();
      loadRoles();
    } else {
      setError(
        data.error ||
          t(isEdit ? 'identity.roles.updateFailed' : 'identity.roles.createFailed'),
      );
    }
  };

  const requestDeleteRole = (role: RoleView) => {
    onRequestConfirm({
      title: t('identity.roles.deleteRoleTitle'),
      body: t('identity.roles.deleteRoleBody').replace('{name}', role.name),
      confirmLabel: t('common.delete'),
      onConfirm: () => {
        void applyDeleteRole(role.id);
      },
    });
  };

  const applyDeleteRole = async (roleId: string) => {
    const res = await authorizedFetch(`/api/identity/roles/${encodeURIComponent(roleId)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (data.ok) {
      loadRoles();
    } else {
      // This is where the staff-hold block surfaces: the server refuses
      // the delete and names how many staff still have the role.
      setError(data.error || t('identity.roles.deleteFailed'));
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>{t('identity.roles.title')}</h2>
        <button
          style={buttonStyle}
          onClick={() => {
            if (showForm) {
              closeForm();
            } else {
              openCreateRole();
            }
          }}
        >
          {showForm ? t('common.cancel') : t('identity.roles.newCustomRole')}
        </button>
      </div>

      {error && (
        <p style={{ color: "#dc2626", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</p>
      )}

      {showForm && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <input
              style={inputStyle}
              placeholder={t('identity.roles.roleNamePlaceholder')}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder={t('identity.roles.descriptionPlaceholder')}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
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
                  background: formPermissions.includes(permission) ? "#e0e7ff" : "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={formPermissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                />
                {permissionLabel(permission)}
              </label>
            ))}
          </div>
          <button style={buttonStyle} onClick={submitForm} disabled={!formName.trim()}>
            {formRoleId !== null ? t('common.save') : t('identity.roles.createRole')}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <span style={{ fontSize: "0.8125rem", color: "#374151", whiteSpace: "nowrap" }}>
              {t('identity.roles.permissionsCount').replace('{count}', String(role.permissions.length))}
            </span>
            {!role.isBuiltIn && (
              <>
                <button type="button" style={buttonStyle} onClick={() => openEditRole(role)}>
                  {t('common.edit')}
                </button>
                <button type="button" style={dangerButtonStyle} onClick={() => requestDeleteRole(role)}>
                  {t('common.delete')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
