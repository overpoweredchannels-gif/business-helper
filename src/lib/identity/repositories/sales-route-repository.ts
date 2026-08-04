import { createSupabaseService } from "@/lib/supabase/server";
import { SalesRoute, SalesRouteStop } from "@/lib/tradeos/types";

export type SalesRouteInput = Partial<SalesRoute>;

const ROUTE_COLUMNS = "id, organization_id, name, territory_id, description, route_frequency, is_active, created_at, updated_at";
const STOP_COLUMNS = "id, organization_id, route_id, customer_id, stop_order, created_at";

export class SalesRouteRepository {
  async findByOrganization(organizationId: string): Promise<SalesRoute[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_routes")
      .select(ROUTE_COLUMNS)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as SalesRoute[];
  }

  async create(input: SalesRouteInput): Promise<SalesRoute> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_routes")
      .insert(input)
      .select(ROUTE_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as SalesRoute;
  }

  async update(id: string, updates: SalesRouteInput): Promise<SalesRoute> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_routes")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(ROUTE_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as SalesRoute;
  }

  async listStops(routeId: string): Promise<SalesRouteStop[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_route_stops")
      .select(STOP_COLUMNS)
      .eq("route_id", routeId)
      .order("stop_order", { ascending: true });

    if (error) {
      return [];
    }

    return (data ?? []) as SalesRouteStop[];
  }

  async addStop(input: Partial<SalesRouteStop>): Promise<SalesRouteStop> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_route_stops")
      .insert(input)
      .select(STOP_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as SalesRouteStop;
  }
}
