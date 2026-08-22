import { createSupabaseService } from "@/lib/supabase/server";
import type { ModulePermission, RoleDefinition } from "../types";

type RoleRow = {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  permissions: unknown;
  is_built_in: boolean;
  created_at: string;
};

function mapRole(row: RoleRow): RoleDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    permissions: Array.isArray(row.permissions) ? (row.permissions as ModulePermission[]) : [],
    isBuiltIn: row.is_built_in,
    createdAt: row.created_at,
  };
}

function roleId(organizationId: string, name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return `${organizationId.replace(/-/g, "")}_${slug}`;
}

export class RoleRepository {
  async listForOrganization(organizationId: string): Promise<RoleDefinition[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_definitions")
      .select("id, organization_id, name, description, permissions, is_built_in, created_at")
      .eq("organization_id", organizationId)
      .eq("is_built_in", false)
      .order("name");
    if (error) throw error;
    return ((data ?? []) as RoleRow[]).map(mapRole);
  }

  async find(organizationId: string, id: string): Promise<RoleDefinition | null> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_definitions")
      .select("id, organization_id, name, description, permissions, is_built_in, created_at")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .eq("is_built_in", false)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRole(data as RoleRow) : null;
  }

  async create(organizationId: string, input: { name: string; description?: string; permissions: ModulePermission[] }) {
    const supabase = createSupabaseService();
    const id = roleId(organizationId, input.name);
    const { data, error } = await supabase
      .from("role_definitions")
      .insert({
        id,
        organization_id: organizationId,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        permissions: input.permissions,
        is_built_in: false,
      })
      .select("id, organization_id, name, description, permissions, is_built_in, created_at")
      .single();
    if (error) return { error: error.code === "23505" ? "A custom role with this name already exists." : error.message };
    return { role: mapRole(data as RoleRow) };
  }

  async update(
    organizationId: string,
    id: string,
    updates: { name?: string; description?: string; permissions?: ModulePermission[] },
  ) {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.permissions !== undefined) payload.permissions = updates.permissions;
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_definitions")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", id)
      .eq("is_built_in", false)
      .select("id, organization_id, name, description, permissions, is_built_in, created_at")
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Custom role not found." };
    return { role: mapRole(data as RoleRow) };
  }

  async delete(organizationId: string, id: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_definitions")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", id)
      .eq("is_built_in", false)
      .select("id")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return data ? { success: true } : { success: false, error: "Custom role not found." };
  }
}
