import { createSupabaseService } from "@/lib/supabase/server";

export type ProfileRecord = {
  id: string;
  organization_id: string;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export class ProfileRepository {
  async findById(id: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase.from("profiles").select("*").eq("id", id).single();

    if (error) {
      throw error;
    }

    return data as ProfileRecord | null;
  }

  async findByOrganization(organizationId: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data as ProfileRecord[];
  }

  async update(id: string, updates: Partial<ProfileRecord>) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as ProfileRecord;
  }
}
