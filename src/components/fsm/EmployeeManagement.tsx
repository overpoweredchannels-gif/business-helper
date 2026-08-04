"use client";

import { useEffect, useState } from "react";
import { Employee, EmployeeDesignation } from "@/lib/tradeos/types";

const DESIGNATIONS: EmployeeDesignation[] = [
  "salesman",
  "delivery_rider",
  "field_officer",
  "collection_officer",
  "supervisor",
  "manager",
  "owner",
];

const DESIGNATION_LABELS: Record<string, string> = {
  salesman: "Salesman",
  delivery_rider: "Delivery Rider",
  field_officer: "Field Officer",
  collection_officer: "Collection Officer",
  supervisor: "Supervisor",
  manager: "Manager",
  owner: "Owner",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  background: "#fff",
  color: "#111827",
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

const dangerButtonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  cursor: "pointer",
};

const emptyForm: Record<string, string> = {
  full_name: "",
  phone: "",
  cnic: "",
  email: "",
  designation: "salesman",
  department: "",
  joining_date: "",
  employee_id: "",
  status: "active",
  assigned_supervisor_id: "",
  assigned_territory_id: "",
  assigned_route_id: "",
};

export default function EmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/identity/employees");
      const data = await res.json();
      if (res.status === 403) {
        setIsOwner(false);
        setMessage({ type: "error", text: data.error || "Access denied" });
      } else if (Array.isArray(data.employees)) {
        setEmployees(data.employees);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load employees" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
  };

  const startEdit = (employee: Employee) => {
    setEditingId(employee.id);
    setForm({
      full_name: employee.full_name ?? "",
      phone: employee.phone ?? "",
      cnic: employee.cnic ?? "",
      email: employee.email ?? "",
      designation: employee.designation,
      department: employee.department ?? "",
      joining_date: employee.joining_date ?? "",
      employee_id: employee.employee_id ?? "",
      status: employee.status,
      assigned_supervisor_id: employee.assigned_supervisor_id ?? "",
      assigned_territory_id: employee.assigned_territory_id ?? "",
      assigned_route_id: employee.assigned_route_id ?? "",
    });
  };

  const save = async () => {
    if (!form.full_name?.trim()) {
      setMessage({ type: "error", text: "Employee name is required." });
      return;
    }
    try {
      const res = await fetch(
        editingId ? `/api/identity/employees/${editingId}` : "/api/identity/employees",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const data = await res.json();
      if (data.employee) {
        setMessage({ type: "ok", text: editingId ? "Employee updated." : "Employee added." });
        resetForm();
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Save failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this employee record?")) return;
    try {
      const res = await fetch(`/api/identity/employees/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "ok", text: "Employee deleted." });
        if (editingId === id) resetForm();
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Delete failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0" }}>Employees</h2>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0" }}>
            Field sales team, delivery riders, and supervisors.
          </p>
        </div>
        <button
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {message && (
        <p
          style={{
            fontSize: "0.875rem",
            margin: "0.75rem 0",
            color: message.type === "ok" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
        </p>
      )}

      {isOwner && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1rem",
            margin: "1rem 0",
            display: "grid",
            gap: "0.625rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Full name *</label>
            <input style={inputStyle} value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Designation</label>
            <select style={inputStyle} value={form.designation} onChange={(e) => setField("designation", e.target.value)}>
              {DESIGNATIONS.map((d) => (
                <option key={d} value={d}>
                  {DESIGNATION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Phone</label>
            <input style={inputStyle} value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="03xx-xxxxxxx" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>CNIC</label>
            <input style={inputStyle} value={form.cnic} onChange={(e) => setField("cnic", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Email</label>
            <input style={inputStyle} value={form.email} onChange={(e) => setField("email", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Department</label>
            <input style={inputStyle} value={form.department} onChange={(e) => setField("department", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Employee ID</label>
            <input style={inputStyle} value={form.employee_id} onChange={(e) => setField("employee_id", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Joining date</label>
            <input style={inputStyle} type="date" value={form.joining_date} onChange={(e) => setField("joining_date", e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Status</label>
            <select style={inputStyle} value={form.status} onChange={(e) => setField("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-end",
              gridColumn: "1 / -1",
            }}
          >
            <button style={buttonStyle} onClick={save}>
              {editingId ? "Save Changes" : "Add Employee"}
            </button>
            {editingId && (
              <button
                style={{ ...buttonStyle, background: "#6b7280" }}
                onClick={resetForm}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Loading employees...</p>
      ) : employees.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
          No employees yet. Add your first field sales team member above.
        </p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {employees.map((emp, index) => (
            <div
              key={emp.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                  {emp.full_name}
                  {emp.status === "active" ? null : (
                    <span
                      style={{
                        marginLeft: "0.5rem",
                        fontSize: "0.7rem",
                        background: "#fee2e2",
                        color: "#991b1b",
                        borderRadius: "999px",
                        padding: "0.125rem 0.5rem",
                      }}
                    >
                      {emp.status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {DESIGNATION_LABELS[emp.designation] ?? emp.designation}
                  {emp.phone ? ` · ${emp.phone}` : ""}
                  {emp.employee_id ? ` · ID: ${emp.employee_id}` : ""}
                </div>
              </div>
              {isOwner && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
                    onClick={() => startEdit(emp)}
                  >
                    Edit
                  </button>
                  <button style={dangerButtonStyle} onClick={() => remove(emp.id)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
