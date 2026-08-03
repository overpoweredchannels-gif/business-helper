import { createSupabaseService } from "@/lib/supabase/server";

export type OrganizationRecord = {
  id: string;
  name: string;
  slug?: string | null;
  settings?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export class OrganizationRepository {
  async findById(id: string) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase.from("organizations").select("*").eq("id", id).single();

    if (error) {
      throw error;
    }

    return data as OrganizationRecord | null;
  }

  async updateSettings(id: string, settings: Record<string, unknown>) {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("organizations")
      .update({ settings })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as OrganizationRecord;
  }
}
