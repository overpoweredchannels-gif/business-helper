"use client";

import { useEffect, useState } from "react";
import { Territory } from "@/lib/tradeos/types";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

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

export default function TerritoriesManager() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  const load = async () => {
    try {
      const res = await authorizedFetch("/api/territories");
      const data = await res.json();
      if (res.status === 403) {
        setIsOwner(false);
        setMessage({ type: "error", text: data.error || "Access denied" });
      } else if (Array.isArray(data.territories)) {
        setTerritories(data.territories);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load territories" });
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
      setMessage({ type: "error", text: "Territory name is required." });
      return;
    }
    try {
      const res = await authorizedFetch("/api/territories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (data.territory) {
        setMessage({ type: "ok", text: `Territory "${name.trim()}" created.` });
        setName("");
        setDescription("");
        load();
      } else {
        setMessage({ type: "error", text: data.error || "Create failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    }
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
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0" }}>Territories</h2>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0" }}>
            Sales areas used to organize customers, routes, and field staff assignments.
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
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            alignItems: "end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gulberg Zone" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>Description</label>
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button style={buttonStyle} onClick={create}>
            Add Territory
          </button>
        </div>
      )}

      {territories.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>No territories yet.</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {territories.map((territory, index) => (
            <div
              key={territory.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{territory.name}</div>
                {territory.description && (
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{territory.description}</div>
                )}
              </div>
              <span
                style={{
                  fontSize: "0.7rem",
                  background: territory.is_active ? "#dcfce7" : "#f3f4f6",
                  color: territory.is_active ? "#166534" : "#6b7280",
                  borderRadius: "999px",
                  padding: "0.125rem 0.5rem",
                }}
              >
                {territory.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
