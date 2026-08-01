"use client";

import { useState, useEffect } from "react";

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
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [permissionMatrix, setPermissionMatrix] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPermissions, setNewPermissions] = useState<string[]>([]);

  const loadRoles = async () => {
    try {
      const res = await fetch("/api/identity/roles");
      const data = await res.json();
      if (data.ok) {
        setRoles(data.roles || []);
        setPermissionMatrix(data.permissionMatrix || {});
        setError(null);
      } else {
        setError(data.error || "Failed to load roles");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
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
    const res = await fetch("/api/identity/roles", {
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
      setError(data.error || "Role creation failed");
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Role Management</h2>
        <button style={buttonStyle} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New Custom Role"}
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
              placeholder="Role name (e.g. Cashier)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Description"
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
                {PERMISSION_LABELS[permission] || permission}
              </label>
            ))}
          </div>
          <button style={buttonStyle} onClick={createRole} disabled={!newName.trim()}>
            Create Role
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
                  built-in
                </span>
              )}
            </div>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#6b7280" }}>
              {role.description || `${role.permissions.length} permissions`}
            </p>
          </div>
          <span style={{ fontSize: "0.8125rem", color: "#374151", whiteSpace: "nowrap" }}>
            {role.permissions.length} permissions
          </span>
        </div>
      ))}
    </div>
  );
}
