// TradeOS ERP — Employees Import Config

import type { EntityImportConfig, ImportFieldDef, ImportContext } from "../types";

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

export const employeesImportConfig: EntityImportConfig = {
  entityKey: "employees",
  entityName: "Employees",
  tableName: "employees",
  existingColumns: "id, profile_id, full_name, email, phone, designation, department, hire_date, salary, emergency_contact, emergency_phone, is_active, assigned_territory_id, assigned_route_id, supervisor_id, visit_frequency, priority",
  
  fields: [
    { key: "email", label: "Email", type: "text", required: true, unique: true, preview: true, width: 220, help: "Required. Used for login/auth." },
    { key: "full_name", label: "Full Name", type: "text", required: true, preview: true, width: 180, help: "Required." },
    { key: "phone", label: "Phone", type: "text", required: false, preview: true, width: 130 },
    { key: "designation", label: "Designation", type: "select", required: false, preview: true, width: 160, options: ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor", "manager", "admin", "driver", "warehouse"], help: "Role designation." },
    { key: "department", label: "Department", type: "text", required: false, preview: true, width: 140 },
    { key: "hire_date", label: "Hire Date", type: "date", required: false, preview: true, width: 110, parse: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]; } },
    { key: "salary", label: "Salary", type: "decimal", required: false, preview: false, parse: (s) => { if (!s) return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; } },
    { key: "emergency_contact", label: "Emergency Contact", type: "text", required: false, preview: false },
    { key: "emergency_phone", label: "Emergency Phone", type: "text", required: false, preview: false },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null },
    { key: "assigned_territory", label: "Assigned Territory", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Territory name." },
    { key: "assigned_route", label: "Assigned Route", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Route name." },
    { key: "supervisor", label: "Supervisor", type: "select", required: false, preview: false, options: async () => [], help: "Supervisor employee name." },
    { key: "visit_frequency", label: "Visit Frequency", type: "select", required: false, preview: true, width: 120, options: ["daily", "weekly", "monthly", "none"], defaultValue: "weekly" },
    { key: "priority", label: "Priority", type: "select", required: false, preview: true, width: 100, options: ["high", "medium", "low"], defaultValue: "medium" },
  ],

  uniqueKeys: [["email"]],
  defaultDuplicateMode: "skip",
  allowCreateReferences: true,
  maxRows: 1000,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const territoryId = v.assigned_territory ? await resolveRef(ctx, "territories", v.assigned_territory as string) : null;
    const routeId = v.assigned_route ? await resolveRef(ctx, "sales_routes", v.assigned_route as string) : null;
    const supervisorId = v.supervisor ? await resolveRef(ctx, "employees", v.supervisor as string, "full_name") : null;

    return {
      full_name: String(v.full_name ?? "").trim(),
      email: v.email ? String(v.email).trim().toLowerCase() : null,
      phone: v.phone ? String(v.phone).trim() : null,
      designation: v.designation ? String(v.designation).trim() : null,
      department: v.department ? String(v.department).trim() : null,
      hire_date: v.hire_date as string | null,
      salary: v.salary as number | null,
      emergency_contact: v.emergency_contact ? String(v.emergency_contact).trim() : null,
      emergency_phone: v.emergency_phone ? String(v.emergency_phone).trim() : null,
      is_active: v.is_active as boolean ?? true,
      assigned_territory_id: territoryId,
      assigned_route_id: routeId,
      supervisor_id: supervisorId,
      visit_frequency: v.visit_frequency as "daily" | "weekly" | "monthly" | "none" ?? "weekly",
      priority: v.priority as "high" | "medium" | "low" ?? "medium",
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.email) return null;
    const { data } = await ctx.supabase
      .from("employees")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("email", String(v.email).trim().toLowerCase())
      .maybeSingle();
    return data as any;
  },

  async applyUpdate(existing, payload, ctx) {
    const { error } = await ctx.supabase
      .from("employees")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  export: {
    filenamePrefix: "employees_export",
    columns: [
      { key: "full_name", label: "Full Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "designation", label: "Designation" },
      { key: "department", label: "Department" },
      { key: "hire_date", label: "Hire Date" },
      { key: "salary", label: "Salary" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      { key: "assigned_territory", label: "Territory", transform: (v) => (v as any)?.name ?? "" },
      { key: "assigned_route", label: "Route", transform: (v) => (v as any)?.name ?? "" },
      { key: "supervisor", label: "Supervisor", transform: (v) => (v as any)?.full_name ?? "" },
      { key: "visit_frequency", label: "Visit Frequency" },
      { key: "priority", label: "Priority" },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("employees")
        .select(`
          id, full_name, email, phone, designation, department, hire_date, salary,
          is_active, visit_frequency, priority,
          assigned_territory:territories!assigned_territory_id(name),
          assigned_route:sales_routes!assigned_route_id(name),
          supervisor:employees!supervisor_id(full_name)
        `)
        .eq("organization_id", orgId)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },
};

async function resolveRef(ctx: ImportContext, table: string, name: string, nameColumn = "name"): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  
  let cache = ctx.refCaches.get(table);
  if (!cache) {
    cache = new Map();
    ctx.refCaches.set(table, cache);
    const selectCol = table === "employees" ? "id, full_name" : "id, name";
    const { data } = await ctx.supabase
      .from(table)
      .select(selectCol)
      .eq("organization_id", ctx.orgId);
    for (const row of data ?? []) {
      cache.set(String(row[nameColumn]).trim().toLowerCase(), row.id);
    }
  }
  
  if (cache.has(key)) return cache.get(key)!;
  
  return null;
}
