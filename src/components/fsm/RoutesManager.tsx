"use client";

import { useEffect, useState } from "react";
import { SalesRoute, SalesRouteStop, Customer, Employee, Territory } from "@/lib/tradeos/types";
import { buildMultiStopNavigationUrl, getMapProvider } from "@/lib/maps/map-provider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import RouteMapBuilder, { RouteMapStop } from "@/components/fsm/RouteMapBuilder";

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  background: "#fff",
  color: "#111827",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#111827",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  cursor: "pointer",
};

interface StopDraft {
  customerId: string;
  label: string;
  address: string;
  latitude: string;
  longitude: string;
}

const emptyStopDraft: StopDraft = {
  customerId: "",
  label: "",
  address: "",
  latitude: "",
  longitude: "",
};

export default function RoutesManager() {
  const [routes, setRoutes] = useState<SalesRoute[]>([]);
  const [name, setName] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [routeStops, setRouteStops] = useState<RouteMapStop[]>([]);
  const [salesmen, setSalesmen] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [stops, setStops] = useState<SalesRouteStop[]>([]);
  const [draft, setDraft] = useState<StopDraft>({ ...emptyStopDraft });
  const [loadingStops, setLoadingStops] = useState(false);
  const [salesmanByRoute, setSalesmanByRoute] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const [routeRes, territoryRes, employeeRes, customerRes] = await Promise.all([
        authorizedFetch("/api/routes"),
        authorizedFetch("/api/territories"),
        authorizedFetch("/api/identity/employees"),
        authorizedFetch("/api/customers"),
      ]);
      const routeData = await routeRes.json();
      const territoryData = await territoryRes.json();
      const employeeData = await employeeRes.json();
      const customerData = await customerRes.json();
      if (routeRes.status === 403) {
        setIsOwner(false);
        setMessage({ type: "error", text: routeData.error || "Access denied" });
        return;
      }
      if (Array.isArray(routeData.routes)) {
        setRoutes(routeData.routes);
      } else {
        setMessage({ type: "error", text: routeData.error || "Failed to load routes" });
      }
      if (Array.isArray(territoryData.territories)) {
        setTerritories(territoryData.territories);
      }
      if (Array.isArray(employeeData.employees)) {
        setSalesmen(employeeData.employees);
        const map: Record<string, string> = {};
        for (const route of routeData.routes ?? []) {
          if (route.assigned_salesman_id) map[route.id] = route.assigned_salesman_id;
        }
        setSalesmanByRoute(map);
      }
      if (Array.isArray(customerData.customers)) {
        setCustomers(customerData.customers);
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) {
      setMessage({ type: "error", text: "Route name is required." });
      return;
    }
    try {
      const res = await authorizedFetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          territory_id: territoryId || null,
          route_frequency: frequency,
          description: routeStops.length > 0
            ? `${routeStops.length} map-planned stop${routeStops.length > 1 ? "s" : ""}.`
            : null,
        }),
      });
      const data = await res.json();
      if (data.route) {
        // Batch-persist any stops planned on the map.
        if (routeStops.length > 0) {
          for (const stop of routeStops) {
            await authorizedFetch(`/api/routes/${data.route.id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add_stop",
                customer_id: null,
                label: stop.label,
                address: stop.address,
                latitude: stop.latitude,
                longitude: stop.longitude,
              }),
            });
          }
        }
        setMessage({ type: "ok", text: `Route "${name.trim()}" created with ${routeStops.length} stop(s).` });
        setName("");
        setTerritoryId("");
        setRouteStops([]);
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Create failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const selectedTerritory = territories.find((t) => t.id === territoryId) ?? null;
  const territoryArea =
    selectedTerritory && selectedTerritory.center_lat != null && selectedTerritory.center_lng != null
      ? {
          centerLat: selectedTerritory.center_lat,
          centerLng: selectedTerritory.center_lng,
          radiusKm: Number(selectedTerritory.radius_km ?? 3),
        }
      : null;

  const autoSuggestName = (stop: RouteMapStop) => {
    setName((prev) => {
      if (prev.trim()) return prev;
      const base = stop.label.trim() || "Route";
      return selectedTerritory ? `${base} Route` : base;
    });
  };

  const handleAddStop = (stop: RouteMapStop) => {
    setRouteStops((prev) => [...prev, stop]);
    autoSuggestName(stop);
  };

  const handleRemoveStop = (key: string) => {
    setRouteStops((prev) => prev.filter((s) => s.key !== key));
  };

  const handleReorderStop = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= routeStops.length) return;
    setRouteStops((prev) => {
      const next = [...prev];
      const [moving] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moving);
      return next;
    });
  };

  const loadStops = async (routeId: string) => {
    setLoadingStops(true);
    try {
      const res = await authorizedFetch(`/api/routes/${routeId}`);
      const data = await res.json();
      if (Array.isArray(data.stops)) {
        setStops(data.stops);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load stops" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoadingStops(false);
    }
  };

  const toggleRoute = async (routeId: string) => {
    if (expandedRouteId === routeId) {
      setExpandedRouteId(null);
      setStops([]);
      return;
    }
    setExpandedRouteId(routeId);
    setDraft({ ...emptyStopDraft });
    await loadStops(routeId);
  };

  const setDraftField = (key: keyof StopDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const addStop = async (routeId: string) => {
    const lat = parseFloat(draft.latitude);
    const lng = parseFloat(draft.longitude);
    const hasCoords = draft.latitude.trim() !== "" || draft.longitude.trim() !== "";
    if (hasCoords && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
      setMessage({ type: "error", text: "Latitude and longitude must be valid numbers." });
      return;
    }
    if (!draft.customerId && !draft.label.trim()) {
      setMessage({ type: "error", text: "Choose a customer or enter a stop label." });
      return;
    }
    try {
      const res = await authorizedFetch(`/api/routes/${routeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_stop",
          customer_id: draft.customerId || null,
          label: draft.label.trim() || null,
          address: draft.address.trim() || null,
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lng) ? lng : null,
        }),
      });
      const data = await res.json();
      if (data.stop) {
        setMessage({ type: "ok", text: "Stop added." });
        setDraft({ ...emptyStopDraft });
        await loadStops(routeId);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to add stop" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const removeStop = async (routeId: string, stopId: string) => {
    if (!window.confirm("Remove this stop from the route?")) return;
    try {
      const res = await authorizedFetch(`/api/routes/${routeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop_id: stopId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "ok", text: "Stop removed." });
        if (Array.isArray(data.stops)) setStops(data.stops);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to remove stop" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const moveStop = async (routeId: string, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    const reordered = [...stops];
    const [moving] = reordered.splice(index, 1);
    reordered.splice(target, 0, moving);
    setStops(reordered);
    try {
      const res = await authorizedFetch(`/api/routes/${routeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          ordered_stop_ids: reordered.map((stop) => stop.id),
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.stops)) {
        setStops(data.stops);
        setMessage({ type: "ok", text: "Stop order updated." });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reorder stops" });
        await loadStops(routeId);
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
      await loadStops(routeId);
    }
  };

  const assignSalesman = async (routeId: string, employeeId: string) => {
    setSalesmanByRoute((prev) => ({ ...prev, [routeId]: employeeId }));
    try {
      const res = await authorizedFetch(`/api/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_salesman_id: employeeId || null }),
      });
      const data = await res.json();
      if (data.route) {
        setMessage({ type: "ok", text: "Salesman assigned." });
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to assign salesman" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const customerLabel = (customerId: string | null): string | null => {
    if (!customerId) return null;
    const customer = customers.find((c) => c.id === customerId);
    return customer
      ? customer.customer_name + (customer.shop_name ? ` (${customer.shop_name})` : "")
      : null;
  };

  const navigateRoute = (routeId: string) => {
    const routeStops = stops.filter(
      (stop) =>
        stop.latitude != null && stop.longitude != null && Number.isFinite(stop.latitude),
    );
    if (routeStops.length === 0) {
      setMessage({
        type: "error",
        text: "This route has no stops with coordinates. Add latitude/longitude to stops to navigate to exact locations.",
      });
      return;
    }
    const provider = getMapProvider();
    const url = buildMultiStopNavigationUrl(
      routeStops.map((stop) => ({
        customerId: stop.customer_id ?? "",
        label: stop.label ?? customerLabel(stop.customer_id) ?? "Stop",
        location: { latitude: stop.latitude!, longitude: stop.longitude! },
      })),
    );
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const navigateStop = (stop: SalesRouteStop) => {
    if (stop.latitude == null || stop.longitude == null) {
      setMessage({ type: "error", text: "This stop has no coordinates." });
      return;
    }
    const provider = getMapProvider();
    const url = provider.buildDirectionsUrl({
      destinationLabel: stop.label ?? customerLabel(stop.customer_id) ?? "Stop",
      destination: { latitude: stop.latitude, longitude: stop.longitude },
      address: stop.address,
    });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const salesmanName = (employeeId: string | null | undefined): string => {
    if (!employeeId) return "";
    const employee = salesmen.find((s) => s.id === employeeId);
    return employee ? employee.full_name : "";
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0" }}>Sales Routes</h2>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0" }}>
            Define delivery and visit routes with exact stop coordinates. Navigation opens in Google Maps.
          </p>
        </div>
        <button style={smallButtonStyle} onClick={load}>
          Refresh
        </button>
      </div>

      {message && (
        <p
          style={{
            fontSize: "0.875rem",
            margin: "0.75rem 0",
            color: message.type === "ok" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
        </p>
      )}

      {isOwner && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1rem",
            margin: "1rem 0",
            display: "grid",
            gap: "0.625rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            alignItems: "end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Route name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gulberg Morning" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Territory</label>
            <select style={inputStyle} value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}>
              <option value="">No territory</option>
              {territories.map((territory) => (
                <option key={territory.id} value={territory.id}>
                  {territory.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Frequency</label>
            <select style={inputStyle} value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly" | "monthly")}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <button style={buttonStyle} onClick={create}>
            Add Route
          </button>

          {territoryId && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: "0.75rem", color: "#374151", marginBottom: "0.25rem" }}>
                Build the route on the map below — search each stop (shops, streets, areas), then Add stop #1/#2/#3.
                {territoryArea ? " The green area is your selected territory." : " Note: this territory has no map area saved yet."}
              </div>
              <RouteMapBuilder
                territoryArea={territoryArea}
                stops={routeStops}
                onAddStop={handleAddStop}
                onRemoveStop={handleRemoveStop}
                onReorder={handleReorderStop}
              />
              {routeStops.length > 0 && (
                <p style={{ fontSize: "0.8rem", color: "#166534", marginTop: "0.5rem" }}>
                  {routeStops.length} stop(s) planned. They will be saved when you press Add Route.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {routes.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>No routes yet.</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {routes.map((route, index) => (
            <div key={route.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.75rem 1rem",
                  borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{route.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    {route.route_frequency} route
                    {route.territory_id ? ` · Territory: ${territories.find((t) => t.id === route.territory_id)?.name ?? "assigned"}` : ""}
                    {salesmanName(route.assigned_salesman_id) ? ` · Assigned: ${salesmanName(route.assigned_salesman_id)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <button style={smallButtonStyle} onClick={() => navigateRoute(route.id)}>
                    Navigate Route
                  </button>
                  <button style={smallButtonStyle} onClick={() => toggleRoute(route.id)}>
                    {expandedRouteId === route.id ? "Close Stops" : "Manage Stops"}
                  </button>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      background: route.is_active ? "#dcfce7" : "#f3f4f6",
                      color: route.is_active ? "#166534" : "#6b7280",
                      borderRadius: "999px",
                      padding: "0.125rem 0.5rem",
                    }}
                  >
                    {route.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              {expandedRouteId === route.id && (
                <div style={{ borderTop: "1px solid #e5e7eb", padding: "1rem", background: "#fafafa" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                    <label style={{ fontSize: "0.75rem", color: "#374151" }}>Assigned salesman</label>
                    <select
                      style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.75rem" }}
                      value={salesmanByRoute[route.id] ?? ""}
                      onChange={(e) => assignSalesman(route.id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {salesmen
                        .filter((s) => ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"].includes(s.designation))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} ({s.designation.replace(/_/g, " ")})
                          </option>
                        ))}
                    </select>
                  </div>

                  <h4 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Stops</h4>

                  {loadingStops ? (
                    <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Loading stops...</p>
                  ) : stops.length === 0 ? (
                    <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "0.75rem" }}>
                      No stops yet. Add a customer stop or a custom location with coordinates below.
                    </p>
                  ) : (
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.375rem", marginBottom: "0.75rem" }}>
                      {stops.map((stop, stopIndex) => {
                        const label = stop.label ?? customerLabel(stop.customer_id) ?? "Stop";
                        const hasCoords = stop.latitude != null && stop.longitude != null;
                        return (
                          <div
                            key={stop.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "0.5rem 0.75rem",
                              borderTop: stopIndex === 0 ? "none" : "1px solid #e5e7eb",
                              gap: "0.5rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ fontSize: "0.8rem" }}>
                              <span style={{ fontWeight: 600, color: "#374151" }}>
                                {stop.stop_order}. {label}
                              </span>
                              <span style={{ color: "#6b7280", marginLeft: "0.5rem" }}>
                                {hasCoords
                                  ? `${stop.latitude!.toFixed(6)}, ${stop.longitude!.toFixed(6)}`
                                  : "no coordinates"}
                                {stop.address ? ` · ${stop.address}` : ""}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                              <button style={smallButtonStyle} onClick={() => navigateStop(stop)} disabled={!hasCoords}>
                                Navigate
                              </button>
                              <button style={smallButtonStyle} onClick={() => moveStop(route.id, stopIndex, -1)} disabled={stopIndex === 0}>
                                ↑
                              </button>
                              <button style={smallButtonStyle} onClick={() => moveStop(route.id, stopIndex, 1)} disabled={stopIndex === stops.length - 1}>
                                ↓
                              </button>
                              <button
                                style={{ ...smallButtonStyle, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}
                                onClick={() => removeStop(route.id, stop.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div
                    style={{
                      border: "1px dashed #d1d5db",
                      borderRadius: "0.375rem",
                      padding: "0.75rem",
                      display: "grid",
                      gap: "0.5rem",
                      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      alignItems: "end",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.7rem", color: "#374151" }}>Customer (optional)</label>
                      <select
                        style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }}
                        value={draft.customerId}
                        onChange={(e) => setDraftField("customerId", e.target.value)}
                      >
                        <option value="">Custom stop</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.customer_name}
                            {customer.shop_name ? ` (${customer.shop_name})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.7rem", color: "#374151" }}>Stop label *</label>
                      <input
                        style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }}
                        value={draft.label}
                        onChange={(e) => setDraftField("label", e.target.value)}
                        placeholder="e.g. Madina Traders"
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.7rem", color: "#374151" }}>Address</label>
                      <input
                        style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }}
                        value={draft.address}
                        onChange={(e) => setDraftField("address", e.target.value)}
                        placeholder="Shop address"
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.7rem", color: "#374151" }}>Latitude</label>
                      <input
                        style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }}
                        value={draft.latitude}
                        onChange={(e) => setDraftField("latitude", e.target.value)}
                        placeholder="e.g. 31.5204"
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.7rem", color: "#374151" }}>Longitude</label>
                      <input
                        style={{ ...inputStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }}
                        value={draft.longitude}
                        onChange={(e) => setDraftField("longitude", e.target.value)}
                        placeholder="e.g. 74.3587"
                      />
                    </div>
                    <button style={{ ...buttonStyle, padding: "0.375rem 0.75rem", fontSize: "0.8rem" }} onClick={() => addStop(route.id)}>
                      Add Stop
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
