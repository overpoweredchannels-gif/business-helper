import { createSupabaseService } from "@/lib/supabase/server";
import { Territory } from "@/lib/tradeos/types";

export type TerritoryInput = Partial<Territory>;

const TERRITORY_COLUMNS =
  "id, organization_id, name, description, is_active, created_at, updated_at, center_lat, center_lng, radius_km";

export class TerritoryRepository {
  async findByOrganization(organizationId: string): Promise<Territory[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("territories")
      .select(TERRITORY_COLUMNS)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as Territory[];
  }

  async create(input: TerritoryInput): Promise<Territory> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("territories")
      .insert(input)
      .select(TERRITORY_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as Territory;
  }

  async update(id: string, updates: TerritoryInput): Promise<Territory> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("territories")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(TERRITORY_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as Territory;
  }
}
