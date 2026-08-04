"use client";

import { useEffect, useState } from "react";
import { SalesRoute } from "@/lib/tradeos/types";
import { getMapProvider, buildMultiStopNavigationUrl } from "@/lib/maps/map-provider";

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

export default function RoutesManager() {
  const [routes, setRoutes] = useState<SalesRoute[]>([]);
  const [name, setName] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [territories, setTerritories] = useState<Array<{ id: string; name: string }>>([]);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  const load = async () => {
    try {
      const [routeRes, territoryRes] = await Promise.all([
        fetch("/api/routes"),
        fetch("/api/territories"),
      ]);
      const routeData = await routeRes.json();
      const territoryData = await territoryRes.json();
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
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), territory_id: territoryId || null, route_frequency: frequency }),
      });
      const data = await res.json();
      if (data.route) {
        setMessage({ type: "ok", text: `Route "${name.trim()}" created.` });
        setName("");
        setTerritoryId("");
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Create failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
  };

  const openRouteNavigation = (route: SalesRoute) => {
    void route;
    const provider = getMapProvider();
    const url = provider.hasInteractiveMap() ? provider.buildDirectionsUrl({ destinationLabel: route.name }) : buildMultiStopNavigationUrl([]);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
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
            Define delivery and visit routes. Route navigation opens in Google Maps.
          </p>
        </div>
        <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={load}>
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
        </div>
      )}

      {routes.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>No routes yet.</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {routes.map((route, index) => (
            <div
              key={route.id}
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
                  {route.territory_id ? " · has territory assignment" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={() => openRouteNavigation(route)}>
                  Navigate
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
          ))}
        </div>
      )}
    </div>
  );
}
