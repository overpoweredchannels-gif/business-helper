import { createSupabaseService } from "@/lib/supabase/server";
import { SalesRoute, SalesRouteStop } from "@/lib/tradeos/types";

export type SalesRouteInput = Partial<SalesRoute>;

const ROUTE_COLUMNS =
  "id, organization_id, name, territory_id, description, route_frequency, is_active, created_at, updated_at, assigned_salesman_id";
const STOP_COLUMNS =
  "id, organization_id, route_id, customer_id, stop_order, label, latitude, longitude, address, created_at";

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

  async findById(id: string): Promise<SalesRoute | null> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_routes")
      .select(ROUTE_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as SalesRoute | null) ?? null;
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

  async updateStop(stopId: string, updates: Partial<SalesRouteStop>): Promise<SalesRouteStop> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_route_stops")
      .update(updates)
      .eq("id", stopId)
      .select(STOP_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as SalesRouteStop;
  }

  async removeStop(routeId: string, stopId: string): Promise<void> {
    const supabase = createSupabaseService();
    const { error } = await supabase
      .from("sales_route_stops")
      .delete()
      .eq("id", stopId)
      .eq("route_id", routeId);
    if (error) {
      throw error;
    }
  }

  async reorderStops(routeId: string, orderedStopIds: string[]): Promise<{ success: boolean; error?: string }> {
    const supabase = createSupabaseService();
    const stops = await this.listStops(routeId);
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));
    const ordered = orderedStopIds
      .map((stopId, index) => {
        const existing = stopById.get(stopId);
        return existing ? { ...existing, stop_order: index + 1 } : null;
      })
      .filter((stop): stop is SalesRouteStop => stop !== null);

    for (const stop of ordered) {
      const { error } = await supabase
        .from("sales_route_stops")
        .update({ stop_order: stop.stop_order })
        .eq("id", stop.id);
      if (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  }
}
