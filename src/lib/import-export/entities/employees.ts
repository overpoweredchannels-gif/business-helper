import { resolveImportReference, suppliedUpdatePayload } from "../references";
// TradeOS ERP — Employees Import Config

import type { EntityImportConfig, ImportContext } from "../types";

export const employeesImportConfig: EntityImportConfig = {
  entityKey: "employees",
  entityName: "Employees",
  tableName: "employees",
  existingColumns: "id, profile_id, employee_id, full_name, email, phone, cnic, designation, department, joining_date, status, emergency_contact, is_active, assigned_territory_id, assigned_route_id, assigned_supervisor_id",
  
  fields: [
    { key: "employee_id", label: "Employee ID", type: "text", required: false, unique: true, preview: true, width: 120 },
    { key: "full_name", label: "Full Name", type: "text", required: true, preview: true, width: 180, help: "Required." },
    { key: "email", label: "Email", type: "text", required: false, unique: true, preview: true, width: 220, help: "Optional; importing an employee does not create a login." },
    { key: "phone", label: "Phone", type: "text", required: false, preview: true, width: 130 },
    { key: "cnic", label: "CNIC", type: "text", required: false, preview: true, width: 140 },
    { key: "designation", label: "Designation", type: "select", required: false, preview: true, width: 160, options: ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor", "manager", "owner"], defaultValue: "salesman", help: "Role designation." },
    { key: "department", label: "Department", type: "text", required: false, preview: true, width: 140 },
    { key: "joining_date", label: "Joining Date", type: "date", required: false, preview: true, width: 110 },
    { key: "emergency_contact_name", label: "Emergency Contact", type: "text", required: false, preview: false },
    { key: "emergency_contact_phone", label: "Emergency Phone", type: "text", required: false, preview: false },
    { key: "emergency_contact_relation", label: "Emergency Relation", type: "text", required: false, preview: false },
    { key: "status", label: "Status", type: "select", required: false, preview: true, width: 100, options: ["active", "inactive", "archived"], defaultValue: "active" },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null },
    { key: "assigned_territory", label: "Assigned Territory", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Territory name." },
    { key: "assigned_route", label: "Assigned Route", type: "select", required: false, preview: true, width: 160, options: async () => [], help: "Route name." },
    { key: "supervisor", label: "Supervisor", type: "select", required: false, preview: false, options: async () => [], help: "Supervisor employee name." },
  ],

  uniqueKeys: [["email"], ["employee_id"]],
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
      employee_id: v.employee_id ? String(v.employee_id).trim() : null,
      email: v.email ? String(v.email).trim().toLowerCase() : null,
      phone: v.phone ? String(v.phone).trim() : null,
      cnic: v.cnic ? String(v.cnic).trim() : null,
      designation: v.designation ? String(v.designation).trim() : "salesman",
      department: v.department ? String(v.department).trim() : null,
      joining_date: v.joining_date as string | null,
      emergency_contact: v.emergency_contact_name || v.emergency_contact_phone || v.emergency_contact_relation ? {
        name: v.emergency_contact_name ? String(v.emergency_contact_name).trim() : null,
        phone: v.emergency_contact_phone ? String(v.emergency_contact_phone).trim() : null,
        relation: v.emergency_contact_relation ? String(v.emergency_contact_relation).trim() : null,
      } : null,
      status: v.status ? String(v.status) : "active",
      is_active: v.is_active as boolean ?? true,
      assigned_territory_id: territoryId,
      assigned_route_id: routeId,
      assigned_supervisor_id: supervisorId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (v.email) {
      const { data } = await ctx.supabase.from("employees").select("id").eq("organization_id", ctx.orgId).eq("email", String(v.email).trim().toLowerCase()).maybeSingle();
      if (data) return data as any;
    }
    if (v.employee_id) {
      const { data } = await ctx.supabase.from("employees").select("id").eq("organization_id", ctx.orgId).eq("employee_id", String(v.employee_id).trim()).maybeSingle();
      if (data) return data as any;
    }
    return null;
  },

  async applyUpdate(existing, payload, ctx) {
    const values = (existing as { rawValues: Record<string, unknown> }).rawValues;
    payload = suppliedUpdatePayload(payload, values);
    if (Object.hasOwn(payload, "emergency_contact")) {
      const { data, error } = await ctx.supabase.from("employees").select("emergency_contact").eq("id", (existing as any).id).eq("organization_id", ctx.orgId).single();
      if (error) throw error;
      const contact = { ...(data.emergency_contact ?? {}) };
      for (const key of ["name", "phone", "relation"]) {
        if (Object.hasOwn(values, `emergency_contact_${key}`)) contact[key] = (payload.emergency_contact as Record<string, unknown> | null)?.[key] ?? null;
      }
      payload.emergency_contact = contact;
    }
    const { error } = await ctx.supabase
      .from("employees")
      .update(payload)
      .eq("id", (existing as any).id)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
    return { ...(existing as Record<string, unknown>), ...payload };
  },

  async postImportHook(created, updated, ctx) {
    for (const item of [...created, ...updated] as Array<{ id: string; rawValues: Record<string, unknown> }>) {
      const routeName = item.rawValues.assigned_route ? String(item.rawValues.assigned_route) : "";
      if (!routeName) continue;
      const routeId = await resolveRef(ctx, "sales_routes", routeName);
      if (!routeId) throw new Error(`Assigned route not found: ${routeName}`);

      const { data: route, error: routeError } = await ctx.supabase.from("sales_routes").select("territory_id").eq("id", routeId).eq("organization_id", ctx.orgId).single();
      if (routeError) throw routeError;
      const { error: routeUpdateError } = await ctx.supabase.from("sales_routes").update({ assigned_salesman_id: item.id }).eq("id", routeId).eq("organization_id", ctx.orgId);
      if (routeUpdateError) throw routeUpdateError;

      const { data: stops, error: stopsError } = await ctx.supabase.from("sales_route_stops").select("customer_id").eq("organization_id", ctx.orgId).eq("route_id", routeId);
      if (stopsError) throw stopsError;
      const customerIds = (stops ?? []).map((stop: { customer_id: string }) => stop.customer_id);
      if (customerIds.length > 0) {
        const assignment: Record<string, string> = { assigned_salesman_id: item.id };
        if (route.territory_id) assignment.assigned_territory_id = route.territory_id;
        const { error: customerError } = await ctx.supabase.from("customers").update(assignment).eq("organization_id", ctx.orgId).in("id", customerIds);
        if (customerError) throw customerError;
      }
    }
  },

  export: {
    filenamePrefix: "employees_export",
    columns: [
      { key: "full_name", label: "Full Name" },
      { key: "employee_id", label: "Employee ID" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "cnic", label: "CNIC" },
      { key: "designation", label: "Designation" },
      { key: "department", label: "Department" },
      { key: "joining_date", label: "Joining Date" },
      { key: "status", label: "Status" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      { key: "assigned_territory", label: "Territory", transform: (v) => (v as any)?.name ?? "" },
      { key: "assigned_route", label: "Route", transform: (v) => (v as any)?.name ?? "" },
      { key: "supervisor", label: "Supervisor", transform: (v) => (v as any)?.full_name ?? "" },
      { key: "emergency_contact_name", label: "Emergency Contact", transform: (_v, row) => (row.emergency_contact as any)?.name ?? "" },
      { key: "emergency_contact_phone", label: "Emergency Phone", transform: (_v, row) => (row.emergency_contact as any)?.phone ?? "" },
      { key: "emergency_contact_relation", label: "Emergency Relation", transform: (_v, row) => (row.emergency_contact as any)?.relation ?? "" },
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("employees")
        .select(`
          id, employee_id, full_name, email, phone, cnic, designation, department, joining_date, status,
          emergency_contact, is_active,
          assigned_territory:territories!assigned_territory_id(name),
          assigned_route:sales_routes!assigned_route_id(name),
          supervisor:employees!assigned_supervisor_id(full_name)
        `)
        .eq("organization_id", orgId)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },
};

async function resolveRef(ctx: ImportContext, table: string, name: string, nameColumn = "name"): Promise<string | null> {
  return resolveImportReference(ctx, table, name, nameColumn, true);
}
