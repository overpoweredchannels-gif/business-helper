import { createSupabaseService } from "@/lib/supabase/server";

export type ProfileRecord = {
  id: string;
  organization_id: string;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  auth_user_id?: string | null;
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

  async updateInOrganization(id: string, organizationId: string, updates: Partial<ProfileRecord>) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Staff profile was not found in this organization.");
    return data as ProfileRecord;
  }

  async linkAuthUser(profileId: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("profiles")
      .update({ auth_user_id: profileId })
      .eq("id", profileId)
      .is("auth_user_id", null)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (data) return data as ProfileRecord;

    const existing = await this.findById(profileId);
    if (existing?.auth_user_id === profileId) return existing;
    throw new Error("Profile could not be linked to the authenticated account.");
  }
}
