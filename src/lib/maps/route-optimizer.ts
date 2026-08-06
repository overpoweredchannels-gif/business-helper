import { createSupabaseService } from "@/lib/supabase/server";
import { optimizeRoute, getDirections, type DirectionsResult, type RouteOptimizationResult, type LatLng } from "./google-maps";
import { SalesRouteRepository } from "@/lib/identity/repositories/sales-route-repository";
import type { SalesRouteStop } from "@/lib/tradeos/types";

export interface OptimizedStop {
  id: string;
  stopOrder: number;
  latitude: number;
  longitude: number;
  label: string;
  address: string | null;
  customerId: string | null;
  legDistanceMeters: number;
  legDurationSeconds: number;
  instructions: string;
  polyline: string;
}

export interface OptimizedRouteResult {
  stops: OptimizedStop[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  overviewPolyline: string;
}

export class RouteOptimizerService {
  private readonly routeRepository = new SalesRouteRepository();

  /**
   * Optimize a sales route using Google Maps Directions API (TSP solver)
   * Returns ordered stops with turn-by-turn directions
   */
  async optimizeRoute(routeId: string): Promise<OptimizedRouteResult> {
    const supabase = createSupabaseService();

    // Get route with assigned salesman
    const route = await this.routeRepository.findById(routeId);
    if (!route) throw new Error("Route not found");

    // Get route stops
    const stops = await this.routeRepository.listStops(routeId);
    if (stops.length < 2) throw new Error("Need at least 2 stops to optimize");

    // Get salesman's starting location (or use first stop as origin)
    let origin: LatLng;
    if (route.assigned_salesman_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("profile_id")
        .eq("id", route.assigned_salesman_id)
        .maybeSingle();

      if (employee?.profile_id) {
        // Try to get latest location from staff_location_points
        const { data: latestLoc } = await supabase
          .from("staff_location_points")
          .select("latitude, longitude")
          .eq("profile_id", employee.profile_id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestLoc) {
          origin = { lat: latestLoc.latitude, lng: latestLoc.longitude };
        } else {
          origin = this.getFirstStopLocation(stops);
        }
      } else {
        origin = this.getFirstStopLocation(stops);
      }
    } else {
      origin = this.getFirstStopLocation(stops);
    }

    // Use last stop as destination
    const destination = this.getLastStopLocation(stops);

    // Prepare waypoints for optimization (exclude first/last if they're origin/destination)
    const waypointStops = stops.slice(1, -1).map((stop) => ({
      placeId: stop.id,
      lat: stop.latitude ?? 0,
      lng: stop.longitude ?? 0,
      address: stop.address ?? stop.label ?? "Stop",
    }));

    if (waypointStops.length === 0) {
      // Only 2 stops - just get directions
      const directions = await getDirections(origin, destination);
      if (!directions) throw new Error("Failed to get directions");

      return this.buildResultFromDirections(stops, directions);
    }

    // Optimize route with Google Maps
    const optimization = await optimizeRoute(origin, destination, waypointStops);
    if (!optimization) throw new Error("Route optimization failed");

    // Build result with ordered stops
    return this.buildOptimizedResult(stops, optimization);
  }

  /**
   * Get directions for a route (without re-optimizing order)
   */
  async getRouteDirections(routeId: string): Promise<OptimizedRouteResult> {
    const stops = await this.routeRepository.listStops(routeId);
    if (stops.length < 2) throw new Error("Need at least 2 stops");

    const origin = this.getFirstStopLocation(stops);
    const destination = this.getLastStopLocation(stops);
    const waypoints = stops.slice(1, -1).map((s) => ({
      lat: s.latitude ?? 0,
      lng: s.longitude ?? 0,
    }));

    const directions = await getDirections(origin, destination, waypoints, false);
    if (!directions) throw new Error("Failed to get directions");

    return this.buildResultFromDirections(stops, directions);
  }

  /**
   * Reorder stops in database to match optimized order
   */
  async applyOptimization(routeId: string, optimizedResult: OptimizedRouteResult): Promise<void> {
    const orderedStopIds = optimizedResult.stops.map((s) => s.id);
    await this.routeRepository.reorderStops(routeId, orderedStopIds);
  }

  private getFirstStopLocation(stops: SalesRouteStop[]): LatLng {
    const first = stops[0];
    if (first.latitude != null && first.longitude != null) {
      return { lat: first.latitude, lng: first.longitude };
    }
    // Fallback: use a default location (should not happen in practice)
    return { lat: 24.8607, lng: 67.0011 }; // Karachi
  }

  private getLastStopLocation(stops: SalesRouteStop[]): LatLng {
    const last = stops[stops.length - 1];
    if (last.latitude != null && last.longitude != null) {
      return { lat: last.latitude, lng: last.longitude };
    }
    return this.getFirstStopLocation(stops);
  }

  private buildResultFromDirections(
    stops: SalesRouteStop[],
    directions: DirectionsResult
  ): OptimizedRouteResult {
    const resultStops: OptimizedStop[] = stops.map((stop, idx) => {
      const leg = directions.legs[idx] ?? directions.legs[directions.legs.length - 1];
      const step = leg.steps[0];
      return {
        id: stop.id,
        stopOrder: idx + 1,
        latitude: stop.latitude ?? 0,
        longitude: stop.longitude ?? 0,
        label: stop.label ?? stop.customer_id ?? `Stop ${idx + 1}`,
        address: stop.address ?? null,
        customerId: stop.customer_id,
        legDistanceMeters: leg.distanceMeters,
        legDurationSeconds: leg.durationSeconds,
        instructions: step?.instructions ?? "",
        polyline: leg.steps.map((s) => s.polyline).join(""),
      };
    });

    return {
      stops: resultStops,
      totalDistanceMeters: directions.legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
      totalDurationSeconds: directions.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      overviewPolyline: directions.polyline,
    };
  }

  private buildOptimizedResult(
    originalStops: SalesRouteStop[],
    optimization: RouteOptimizationResult
  ): OptimizedRouteResult {
    // Map optimized waypoints back to original stops
    const stopMap = new Map(originalStops.map((s) => [s.id, s]));
    const customerIdMap = new Map(
      originalStops.filter((s) => s.customer_id).map((s) => [s.customer_id, s])
    );

    const resultStops: OptimizedStop[] = optimization.orderedWaypoints.map((wp, idx) => {
      const stop = stopMap.get(wp.placeId) ?? customerIdMap.get(wp.placeId);
      const latitude = stop?.latitude ?? wp.lat;
      const longitude = stop?.longitude ?? wp.lng;
      const label = stop?.label ?? wp.address;
      const address = stop?.address ?? wp.address;

      // Find the matching leg by order position
      const leg = optimization.legs[idx] ?? optimization.legs[optimization.legs.length - 1];
      const step = leg.steps[0];

      return {
        id: wp.placeId,
        stopOrder: idx + 1,
        latitude,
        longitude,
        label,
        address,
        customerId: stop?.customer_id ?? null,
        legDistanceMeters: leg.distanceMeters,
        legDurationSeconds: leg.durationSeconds,
        instructions: step?.instructions ?? "",
        polyline: leg.steps.map((s) => s.polyline).join(""),
      };
    });

    return {
      stops: resultStops,
      totalDistanceMeters: optimization.totalDistanceMeters,
      totalDurationSeconds: optimization.totalDurationSeconds,
      overviewPolyline: optimization.polyline,
    };
  }
}

export function getRouteOptimizer(): RouteOptimizerService {
  return new RouteOptimizerService();
}
