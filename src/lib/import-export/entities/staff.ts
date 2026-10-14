// TradeOS ERP — Staff Permissions Import Config
//
// Staff permissions are stored in profiles + staff_permissions tables.
// This config handles importing staff with their section permissions.

import type { EntityImportConfig, ImportFieldDef } from "../types";

export const STAFF_IMPORT_UPDATE_BLOCKED = "Staff import updates are temporarily paused to prevent partially saved profiles and permissions. This row was not changed. Use Staff & Permissions to review and save each change individually. Export and skipping existing rows remain available.";

function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "y", "on"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "off", "none"].includes(normalized)) return false;
  return null;
}

function parseRole(raw: string): "owner" | "manager" | "salesman" | "field_officer" | "collection_officer" | "delivery_rider" | "supervisor" | "staff" | null {
  const normalized = raw.trim().toLowerCase();
  const valid = ["owner", "manager", "salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor", "staff"];
  return valid.includes(normalized) ? normalized as any : null;
}

const SECTIONS = [
  "dashboard", "sales", "purchases", "inventory", "customers", "suppliers",
  "reports", "payments", "expenses", "staff", "settings", "ai_assistant",
  "field_sales", "market_intelligence", "deployment", "notifications",
  "audit", "tasks", "leave", "attendance", "live_tracking",
] as const;

function createPermField(section: string): ImportFieldDef {
  return {
    key: `perm_${section}`,
    label: `Perm: ${section}`,
    type: "boolean",
    required: false,
    preview: false,
    defaultValue: false,
    parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null,
    help: `Grant access to ${section} section.`,
  };
}

export const staffImportConfig: EntityImportConfig = {
  entityKey: "staff",
  entityName: "Staff & Permissions",
  tableName: "profiles", // Main table is profiles, permissions in staff_permissions
  existingColumns: "id, email, display_name, role, is_active, organization_id",
  
  fields: [
    { key: "email", label: "Email", type: "text", required: true, unique: true, preview: true, width: 220, help: "Required. Existing profile login email in this organization (from Staff export), not employee contact email or Profile ID. Create new staff through Employees → Invite first." },
    { key: "name", label: "Name", type: "text", required: true, preview: true, width: 180, help: "Display name." },
    { key: "role", label: "Role", type: "select", required: false, preview: true, width: 160, parse: parseRole, options: ["owner", "manager", "salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor", "staff"], defaultValue: "staff", help: "Base role (permissions inherit from role)." },
    { key: "is_active", label: "Active", type: "boolean", required: false, preview: true, width: 80, defaultValue: true, parse: (s) => s?.trim().toLowerCase() === "yes" || s?.trim() === "1" || s?.trim().toLowerCase() === "true" ? true : s?.trim().toLowerCase() === "no" || s?.trim() === "0" || s?.trim().toLowerCase() === "false" ? false : null },
    // Permission sections as boolean columns
    ...SECTIONS.map(createPermField),
    { key: "granted_sections", label: "Granted Sections (JSON)", type: "json", required: false, preview: false, help: "Alternative: JSON array of section IDs." },
  ],

  uniqueKeys: [["email"]],
  defaultDuplicateMode: "update", // Staff permissions often updated
  allowCreateReferences: false,
  maxRows: 500,

  async buildUpsertPayload(row, ctx) {
    const v = row.values as Record<string, unknown>;
    const grantedSections: string[] = [];
    
    // Build granted_sections from perm_* columns
    for (const section of SECTIONS) {
      if (v[`perm_${section}`] === true) grantedSections.push(section);
    }
    
    // Also check granted_sections JSON column
    if (v.granted_sections && Array.isArray(v.granted_sections)) {
      for (const s of v.granted_sections) {
        if (SECTIONS.includes(s) && !grantedSections.includes(s)) grantedSections.push(s);
      }
    }

    return {
      email: v.email ? String(v.email).trim().toLowerCase() : null,
      display_name: v.name ? String(v.name).trim() : null,
      role: v.role as any ?? "staff",
      is_active: v.is_active as boolean ?? true,
      organization_id: ctx.orgId,
    };
  },

  async findExisting(row, ctx) {
    const v = row.values as Record<string, unknown>;
    if (!v.email) return null;
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("email", String(v.email).trim().toLowerCase())
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No staff profile matches this login email in your organization. Use Employees → Invite to provision new staff, then use the profile login email from Staff export. Employee contact email and Profile ID are not matching keys.");
    return data as any;
  },

  async createRecord() {
    throw new Error("Staff import cannot create accounts. Use Employees → Invite to create new staff. Import updates are temporarily paused; edit existing staff individually in Staff & Permissions.");
  },

  async reviewRows(rows, ctx) {
    if (ctx.duplicateMode !== "update") return;
    for (const row of rows) {
      if (row.existingId == null || row.errors.length) continue;
      row.errors.push(STAFF_IMPORT_UPDATE_BLOCKED);
      row.status = "error";
    }
  },

  // Also fail closed when a caller bypasses HTTP preview. No compensating writes:
  // a remote two-request sequence cannot guarantee atomic profile/permission state.
  async applyUpdate() {
    throw new Error(STAFF_IMPORT_UPDATE_BLOCKED);
  },

  export: {
    filenamePrefix: "staff_export",
    columns: [
      { key: "email", label: "Email" },
      { key: "display_name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "is_active", label: "Active", transform: (v) => v ? "Yes" : "No" },
      ...SECTIONS.map((section) => ({
        key: `perm_${section}`,
        label: `Perm: ${section}`,
        transform: (v: unknown) => v ? "Yes" : "No",
      })),
    ],
    async fetchData(orgId) {
      const { createSupabaseService } = await import("@/lib/supabase/server");
      const supabase = createSupabaseService();
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id, email, display_name, role, is_active,
          permissions:staff_permissions!profile_id(granted_sections)
        `)
        .eq("organization_id", orgId)
        .order("display_name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any) => {
        const permissionRow = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
        const granted = new Set<string>(permissionRow?.granted_sections ?? []);
        return {
          ...row,
          ...Object.fromEntries(SECTIONS.map((section) => [`perm_${section}`, granted.has(section)])),
        };
      });
    },
  },
};

export const INACTIVE_STAFF_DELETE_SQL = `
-- Delete inactive staff (profiles with is_active = false) and their permissions
-- Run this manually when user requests "Delete Inactive Staff"
DELETE FROM public.staff_permissions
WHERE profile_id IN (
  SELECT id FROM public.profiles
  WHERE organization_id = $1 AND is_active = false
);

DELETE FROM public.profiles
WHERE organization_id = $1 AND is_active = false;
`;
