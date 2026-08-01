"use client";

import { useState, useEffect, useCallback } from "react";
import LiveMap from "./LiveMap";
import type { CurrentLocationView } from "../../lib/location/types";

export default function LocationDashboard() {
  const [employees, setEmployees] = useState<CurrentLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<CurrentLocationView | null>(null);
  const [pollInterval, setPollInterval] = useState(15000);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const fetchLocations = useCallback(async () => {
    try {
      const orgId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("organizationId") : null;
      const res = await fetch(`/api/location/current?organizationId=${orgId || ""}`);
      const data = await res.json();
      if (data.ok) {
        setEmployees(data.employees || []);
        setError(null);
      } else {
        setError(data.error || "Failed to load locations");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
      setLastRefresh(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, pollInterval);
    return () => clearInterval(interval);
  }, [fetchLocations, pollInterval]);

  const onDuty = employees.filter((e) => e.isOnDuty);
  const withLocation = employees.filter((e) => e.hasLocation);
  const moving = employees.filter((e) => e.speed && e.speed > 1);

  let filtered = employees;
  if (filterStatus === "on_duty") filtered = employees.filter((e) => e.isOnDuty);
  else if (filterStatus === "off_duty") filtered = employees.filter((e) => !e.isOnDuty);
  else if (filterStatus === "with_location") filtered = employees.filter((e) => e.hasLocation);
  else if (filterStatus === "moving") filtered = employees.filter((e) => e.speed && e.speed > 1);
  else if (filterStatus === "stale") filtered = employees.filter((e) => e.isOnDuty && (!e.hasLocation || e.lastUpdateAge > 300000));

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Live Workforce Tracking</h2>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            {employees.length} employees &middot; {onDuty.length} on duty &middot; {withLocation.length} with location &middot; {moving.length} moving
          </span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={selectStyle}
          >
            <option value="all">All Employees</option>
            <option value="on_duty">On Duty</option>
            <option value="off_duty">Off Duty</option>
            <option value="with_location">With Location</option>
            <option value="moving">Moving</option>
            <option value="stale">Stale / No Update</option>
          </select>
          <select
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
            style={selectStyle}
          >
            <option value={5000}>5s refresh</option>
            <option value={15000}>15s refresh</option>
            <option value={30000}>30s refresh</option>
            <option value={60000}>1m refresh</option>
          </select>
          <button onClick={fetchLocations} style={buttonStyle}>
            Refresh Now
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.375rem", color: "#991b1b", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "1rem", minHeight: "500px" }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden", minHeight: "400px" }}>
          <LiveMap
            employees={filtered}
            onEmployeeClick={setSelectedEmployee}
            selectedEmployeeId={selectedEmployee?.profileId || null}
          />
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "auto", maxHeight: "600px" }}>
          <div style={{ padding: "0.75rem", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: "0.875rem", background: "#f9fafb" }}>
            Employee List
            {lastRefresh && <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: "0.5rem" }}>({lastRefresh})</span>}
          </div>
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>No employees match the current filter.</div>
          ) : (
            filtered.map((emp) => (
              <div
                key={emp.profileId}
                onClick={() => setSelectedEmployee(emp)}
                style={{
                  padding: "0.75rem",
                  borderBottom: "1px solid #f3f4f6",
                  cursor: "pointer",
                  background: selectedEmployee?.profileId === emp.profileId ? "#eff6ff" : "transparent",
                  ...(emp.speed && emp.speed > 1 ? { borderLeft: "3px solid #f59e0b" } : {}),
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{emp.employeeName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{emp.role || "No role"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{
                      display: "inline-block",
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: emp.isOnDuty ? (emp.hasLocation ? "#22c55e" : "#f59e0b") : "#9ca3af",
                      marginRight: "0.375rem",
                    }} />
                    <span style={{ fontSize: "0.75rem", color: emp.isOnDuty ? "#16a34a" : "#6b7280" }}>
                      {emp.isOnDuty ? "On Duty" : "Off Duty"}
                    </span>
                  </div>
                </div>
                {emp.hasLocation && (
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    {emp.latitude.toFixed(4)}, {emp.longitude.toFixed(4)}
                    {emp.speed && emp.speed > 1 ? ` - ${Math.round(emp.speed * 3.6)} km/h` : ""}
                    {emp.lastUpdateAge < 60000 ? " (now)" : ` (${Math.round(emp.lastUpdateAge / 60000)}m ago)`}
                  </div>
                )}
                {!emp.hasLocation && emp.isOnDuty && (
                  <div style={{ fontSize: "0.75rem", color: "#f59e0b", marginTop: "0.25rem" }}>No location data</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {selectedEmployee && selectedEmployee.hasLocation && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem" }}>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${selectedEmployee.latitude},${selectedEmployee.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2563eb", textDecoration: "underline", fontSize: "0.875rem" }}
          >
            Open Google Maps Navigation to {selectedEmployee.employeeName}
          </a>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.8rem",
  background: "white",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.8rem",
  background: "#f9fafb",
  cursor: "pointer",
};
