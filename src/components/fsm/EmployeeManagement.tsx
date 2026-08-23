"use client";

import { Fragment, useEffect, useState } from "react";
import { Customer, Employee, EmployeeDesignation, SalesRoute, SalesRouteStop, Territory } from "@/lib/tradeos/types";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { buildWhatsAppUrl, buildWhatsAppInviteMessage, designationLabel } from "@/lib/identity/staff-invitation";

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

type EmployeeSummary = Employee & {
  assigned_route_name?: string | null;
  assigned_territory_name?: string | null;
  assigned_customer_count: number;
  invoice_count: number;
  authored_invoice_count: number;
  total_sales: number;
  remaining_balance: number;
  unpaid_invoices: number;
  customers: Array<{ id: string; customer_name: string; shop_name?: string | null; invoice_count: number; total_sales: number; remaining_balance: number; unpaid_invoices: number }>;
};

export default function EmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [loading, setLoading] = useState(true);
  const [organizationName, setOrganizationName] = useState("your organization");
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"management" | "profiles">("management");
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [routes, setRoutes] = useState<SalesRoute[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [routeStops, setRouteStops] = useState<SalesRouteStop[]>([]);
  const [assignmentScope, setAssignmentScope] = useState<"route_only" | "route_all" | "selected">("route_only");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<EmployeeSummary[]>([]);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);

  const loadOrganization = async () => {
    try {
      const res = await authorizedFetch("/api/identity/organization/current");
      const data = await res.json();
      if (data.organization?.name) setOrganizationName(data.organization.name);
    } catch {
      // best-effort; fall back to generic label
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      loadOrganization();
      const [res, optionsRes, summariesRes] = await Promise.all([
        authorizedFetch("/api/identity/employees"),
        authorizedFetch("/api/customers/assignment-options"),
        authorizedFetch("/api/identity/employees/summaries"),
      ]);
      const [data, optionsData, summariesData] = await Promise.all([res.json(), optionsRes.json(), summariesRes.json()]);
      if (res.status === 403) {
        setIsOwner(false);
        setMessage({ type: "error", text: data.error || "Access denied" });
      } else if (Array.isArray(data.employees)) {
        setEmployees(data.employees);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load employees" });
      }
      if (optionsData.ok) {
        setTerritories(optionsData.territories ?? []);
        setRoutes(optionsData.routes ?? []);
        setRouteStops(optionsData.routeStops ?? []);
      }
      if (summariesData.ok) setSummaries(summariesData.employees ?? []);
      const customerRes = await authorizedFetch("/api/customers");
      const customerData = await customerRes.json();
      if (Array.isArray(customerData.customers)) setCustomers(customerData.customers);
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
    setAssignmentScope("route_only");
    setSelectedCustomerIds([]);
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
    setAssignmentScope("selected");
    setSelectedCustomerIds(customers.filter((customer) => customer.assigned_salesman_id === employee.id).map((customer) => customer.id));
  };

  const save = async () => {
    if (!form.full_name?.trim()) {
      setMessage({ type: "error", text: "Employee name is required." });
      return;
    }
    try {
      const res = await authorizedFetch(
        editingId ? `/api/identity/employees/${editingId}` : "/api/identity/employees",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const data = await res.json();
      if (data.employee) {
        const assignmentRes = await authorizedFetch(`/api/identity/employees/${data.employee.id}/assignment`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            territory_id: form.assigned_territory_id || null,
            route_id: form.assigned_route_id || null,
            assignment_scope: assignmentScope,
            customer_ids: selectedCustomerIds,
          }),
        });
        const assignmentData = await assignmentRes.json();
        if (!assignmentRes.ok || !assignmentData.ok) throw new Error(assignmentData.error ?? "Employee saved, but assignment failed");
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
      const res = await authorizedFetch(`/api/identity/employees/${id}`, { method: "DELETE" });
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

  const generateInvite = async (emp: Employee): Promise<{ loginId?: string; code?: string; inviteLink?: string; error?: string } | null> => {
    try {
      const res = await authorizedFetch("/api/identity/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id }),
      });
      const data = await res.json();
      if (data.loginId && data.code) {
        return { loginId: data.loginId, code: data.code, inviteLink: data.inviteLink };
      }
      return { error: data.error || "Invite generation failed" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Network error" };
    }
  };

  const inviteViaWhatsApp = async (emp: Employee) => {
    if (!emp.phone) {
      setMessage({ type: "error", text: "Add a phone number to this employee before sending a WhatsApp invite." });
      return;
    }
    setInvitingId(emp.id);
    setMessage(null);
    try {
      const result = await generateInvite(emp);
      if (!result) return;
      if (result.error || !result.loginId || !result.inviteLink) {
        setMessage({ type: "error", text: result.error || "Invite generation failed" });
        return;
      }
      const text = buildWhatsAppInviteMessage({
        organizationName,
        employeeName: emp.full_name,
        designationLabel: designationLabel(emp.designation, DESIGNATION_LABELS),
        loginId: result.loginId,
        inviteLink: result.inviteLink,
      });
      const waUrl = buildWhatsAppUrl(emp.phone) + `?text=${encodeURIComponent(text)}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
      setMessage({ type: "ok", text: `Profile ID ${result.loginId} generated. WhatsApp invite opened for ${emp.full_name}.` });
      load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setInvitingId(null);
    }
  };

  const copyInviteLink = async (emp: Employee) => {
    setInvitingId(emp.id);
    setMessage(null);
    try {
      const result = await generateInvite(emp);
      if (!result || result.error || !result.inviteLink) {
        setMessage({ type: "error", text: result?.error || "Invite generation failed" });
        return;
      }
      await navigator.clipboard.writeText(result.inviteLink);
      setMessage({ type: "ok", text: `Invite link copied. Share it with ${emp.full_name}.` });
      load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setInvitingId(null);
    }
  };

  const availableRoutes = routes.filter((route) => !form.assigned_territory_id || route.territory_id === form.assigned_territory_id);
  const selectedRouteCustomerIdSet = new Set(routeStops.filter((stop) => stop.route_id === form.assigned_route_id && stop.customer_id).map((stop) => String(stop.customer_id)));
  const eligibleCustomers = customers.filter((customer) => customer.is_active !== false && (
    form.assigned_route_id
      ? selectedRouteCustomerIdSet.has(customer.id)
      : Boolean(form.assigned_territory_id) && customer.assigned_territory_id === form.assigned_territory_id
  ));
  const formatMoney = (value: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(value);

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

      <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", borderBottom: "1px solid #e5e7eb", paddingBottom: "0.75rem" }}>
        <button style={{ ...buttonStyle, background: tab === "management" ? "#111827" : "#fff", color: tab === "management" ? "#fff" : "#374151", border: "1px solid #d1d5db" }} onClick={() => setTab("management")}>Employee Management</button>
        <button style={{ ...buttonStyle, background: tab === "profiles" ? "#111827" : "#fff", color: tab === "profiles" ? "#fff" : "#374151", border: "1px solid #d1d5db" }} onClick={() => setTab("profiles")}>Employee Profiles</button>
      </div>

      {tab === "management" ? <>

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
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Territory</label>
            <select style={inputStyle} value={form.assigned_territory_id} onChange={(event) => { setField("assigned_territory_id", event.target.value); setField("assigned_route_id", ""); setSelectedCustomerIds([]); }}>
              <option value="">No territory</option>
              {territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Route</label>
            <select style={inputStyle} value={form.assigned_route_id} disabled={!form.assigned_territory_id} onChange={(event) => { setField("assigned_route_id", event.target.value); setSelectedCustomerIds([]); }}>
              <option value="">No route</option>
              {availableRoutes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Assign customers</label>
            <select style={inputStyle} value={assignmentScope} disabled={!form.assigned_territory_id} onChange={(event) => setAssignmentScope(event.target.value as "route_only" | "route_all" | "selected")}>
              <option value="route_only">Route/territory only</option>
              <option value="route_all">All customers in selection</option>
              <option value="selected">Only selected customers</option>
            </select>
          </div>
          {assignmentScope === "selected" && form.assigned_territory_id && (
            <div style={{ gridColumn: "1 / -1", border: "1px solid #e5e7eb", borderRadius: "0.4rem", padding: "0.75rem" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.5rem" }}>Choose customers from {form.assigned_route_id ? "this route" : "this territory"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.4rem", maxHeight: "220px", overflowY: "auto" }}>
                {eligibleCustomers.map((customer) => <label key={customer.id} style={{ display: "flex", gap: "0.45rem", border: "1px solid #e5e7eb", borderRadius: "0.35rem", padding: "0.45rem", fontSize: "0.75rem" }}><input type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={(event) => setSelectedCustomerIds((current) => event.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))} /><span>{customer.customer_name}{customer.shop_name ? ` · ${customer.shop_name}` : ""}</span></label>)}
                {eligibleCustomers.length === 0 && <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>No customers are available; add customers to the territory and route first.</span>}
              </div>
            </div>
          )}
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
                  {emp.login_id ? ` · Profile ID: ${emp.login_id}` : ""}
                </div>
                {emp.invite_status && emp.invite_status !== "none" && (
                  <div style={{ marginTop: "0.375rem" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        background: emp.invite_status === "accepted" ? "#dcfce7" : emp.invite_status === "pending" ? "#fef9c3" : "#f3f4f6",
                        color: emp.invite_status === "accepted" ? "#166534" : emp.invite_status === "pending" ? "#854d0e" : "#6b7280",
                        borderRadius: "999px",
                        padding: "0.125rem 0.5rem",
                      }}
                    >
                      Invite: {emp.invite_status}
                    </span>
                  </div>
                )}
              </div>
              {isOwner && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {emp.invite_status !== "accepted" && (
                    <>
                      <button
                        style={{ ...buttonStyle, fontSize: "0.75rem", padding: "0.375rem 0.75rem", background: "#059669" }}
                        onClick={() => inviteViaWhatsApp(emp)}
                        disabled={invitingId === emp.id}
                      >
                        {invitingId === emp.id ? "Generating..." : "WhatsApp Invite"}
                      </button>
                      <button
                        style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
                        onClick={() => copyInviteLink(emp)}
                        disabled={invitingId === emp.id}
                      >
                        Copy Link
                      </button>
                    </>
                  )}
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
      </> : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "980px", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ background: "#f9fafb", textAlign: "left", color: "#4b5563" }}><th style={{ padding: "0.7rem" }}>Employee</th><th>Territory / Route</th><th>Customers</th><th>Invoices</th><th>Total Sales</th><th>Remaining</th><th>Unpaid</th><th>Actions</th></tr></thead>
              <tbody>{summaries.map((employee) => <Fragment key={employee.id}>
                <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "0.7rem" }}><strong>{employee.full_name}</strong><div style={{ color: "#6b7280", textTransform: "capitalize" }}>{employee.designation}</div></td>
                  <td>{employee.assigned_territory_name ?? "No territory"}<div style={{ color: "#6b7280" }}>{employee.assigned_route_name ?? "No route"}</div></td>
                  <td>{employee.assigned_customer_count}</td><td>{employee.invoice_count}<div style={{ color: "#6b7280" }}>{employee.authored_invoice_count} created by employee</div></td>
                  <td>{formatMoney(employee.total_sales)}</td><td style={{ color: employee.remaining_balance > 0 ? "#b45309" : "#166534", fontWeight: 600 }}>{formatMoney(employee.remaining_balance)}</td><td>{employee.unpaid_invoices}</td>
                  <td><div style={{ display: "flex", gap: "0.35rem" }}><button style={smallProfileButton} onClick={() => setExpandedProfileId((current) => current === employee.id ? null : employee.id)}>{expandedProfileId === employee.id ? "Close" : "Customers"}</button><button style={smallProfileButton} onClick={() => { startEdit(employee); setTab("management"); }}>Assign</button></div></td>
                </tr>
                {expandedProfileId === employee.id && <tr key={`${employee.id}-customers`}><td colSpan={8} style={{ padding: "0.8rem", background: "#fafafa" }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Assigned customer portfolio</div>
                  {employee.customers.length === 0 ? <span style={{ color: "#6b7280" }}>No customers assigned.</span> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr style={{ textAlign: "left", color: "#6b7280" }}><th style={{ padding: "0.4rem" }}>Customer</th><th>Invoices</th><th>Sales</th><th>Remaining</th><th>Unpaid</th></tr></thead><tbody>{employee.customers.map((customer) => <tr key={customer.id} style={{ borderTop: "1px solid #e5e7eb" }}><td style={{ padding: "0.45rem" }}>{customer.customer_name}{customer.shop_name ? ` · ${customer.shop_name}` : ""}</td><td>{customer.invoice_count}</td><td>{formatMoney(customer.total_sales)}</td><td>{formatMoney(customer.remaining_balance)}</td><td>{customer.unpaid_invoices}</td></tr>)}</tbody></table></div>}
                </td></tr>}
              </Fragment>)}</tbody>
            </table>
          </div>
          {!loading && summaries.length === 0 && <p style={{ padding: "1rem", color: "#6b7280", fontSize: "0.8rem" }}>No employee profiles found.</p>}
        </div>
      )}
    </div>
  );
}

const smallProfileButton: React.CSSProperties = { padding: "0.3rem 0.6rem", fontSize: "0.72rem", cursor: "pointer", border: "1px solid #d1d5db", borderRadius: "0.35rem", background: "#fff" };
