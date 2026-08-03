import { createSupabaseService } from "@/lib/supabase/server";

export type EmployeeRecord = {
  id: string;
  organization_id: string;
  profile_id: string;
  role?: string | null;
  is_active?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export class EmployeeRepository {
  async findByOrganization(organizationId: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data as EmployeeRecord[];
  }

  async create(input: Omit<EmployeeRecord, "id" | "created_at" | "updated_at">) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase.from("employees").insert(input).select("*").single();

    if (error) {
      throw error;
    }

    return data as EmployeeRecord;
  }

  async update(id: string, updates: Partial<EmployeeRecord>) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("employees")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as EmployeeRecord;
  }

  async remove(id: string) {
    const supabase = createSupabaseService();
    const { error } = await supabase.from("employees").delete().eq("id", id);

    if (error) {
      throw error;
    }
  }
}
