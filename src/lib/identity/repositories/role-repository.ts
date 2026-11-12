import { createSupabaseService } from "@/lib/supabase/server";
import type { ModulePermission, RoleDefinition } from "../types";
import { isDuplicateCustomRoleName } from "../custom-role-edit";

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
    const supabase = createSupabaseService();
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (name.length === 0) {
        return { error: "Role name is required." };
      }
      // A rename never changes the role id, so a name collision would not
      // trip the primary key — check explicitly against the org's other
      // custom roles (case-insensitive, like the create slug).
      const { data: siblings, error: siblingsError } = await supabase
        .from("role_definitions")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_built_in", false);
      if (siblingsError) return { error: siblingsError.message };
      if (
        isDuplicateCustomRoleName(
          name,
          (siblings ?? []) as Array<{ id: string; name: string }>,
          id,
        )
      ) {
        return { error: "A custom role with this name already exists." };
      }
      payload.name = name;
    }
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.permissions !== undefined) payload.permissions = updates.permissions;
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

  // Staff members holding a role, by role id. profiles.role is free-text
  // with no foreign key to role_definitions, so a delete never fails at
  // the database level — the DELETE route calls this first and blocks
  // when the count is above zero. Active or not: the reference exists
  // either way, and an inactive profile reactivated later would come
  // back holding a role that no longer exists.
  async countHolders(organizationId: string, roleId: string): Promise<number> {
    const supabase = createSupabaseService();
    const { count, error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", roleId);
    if (error) throw error;
    return count ?? 0;
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
