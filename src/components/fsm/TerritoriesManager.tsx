"use client";

import { useCallback, useEffect, useState } from "react";
import { Customer, Territory } from "@/lib/tradeos/types";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import TerritoryMapPicker, { TerritoryGeoSelection } from "@/components/fsm/TerritoryMapPicker";

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

// The Google Places dropdown (.pac-container) is appended to <body>, so any
// z-index set on a wrapper <div> creates a stacking context that traps inputs
// beneath that panel. Fix: do NOT give the form container a z-index/position,
// and layer the text inputs far above the panel so typing always works while
// the map+dropdown still render underneath them.
const mapsOverlayCss = `.pac-container, .pac-card { z-index: 12000 !important; }`;
const overlayInputCss: React.CSSProperties = {
  position: "relative",
  zIndex: 99999,
};

export default function TerritoriesManager() {
  const { t } = useRegional();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [geoSelection, setGeoSelection] = useState<TerritoryGeoSelection | null>(null);
  const [useGeoName, setUseGeoName] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expandedTerritoryId, setExpandedTerritoryId] = useState<string | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [savingCustomers, setSavingCustomers] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, customerRes] = await Promise.all([
        authorizedFetch("/api/territories"),
        authorizedFetch("/api/customers"),
      ]);
      // Parse and apply each response independently: a failure in the
      // customers request must not discard a successful territories load
      // (previously both were parsed together, so one bad response left the
      // page on its "No territories yet." state until a manual Refresh).
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setIsOwner(false);
        setMessage({ type: "error", text: data.error || t('fsm.routes.accessDenied') });
      } else if (Array.isArray(data.territories)) {
        setTerritories(data.territories);
      } else {
        setMessage({ type: "error", text: data.error || t('fsm.territories.loadFailed') });
      }
      const customerData = await customerRes.json().catch(() => ({}));
      if (Array.isArray(customerData.customers)) setCustomers(customerData.customers);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('tracking.networkError') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const saveTerritory = async () => {
    if (!name.trim()) {
      setMessage({ type: "error", text: t('fsm.territories.nameRequired') });
      return;
    }
    try {
      const isEditing = editingTerritoryId !== null;
      const res = await authorizedFetch(isEditing ? `/api/territories/${editingTerritoryId}` : "/api/territories", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          center_lat: geoSelection?.centerLat ?? null,
          center_lng: geoSelection?.centerLng ?? null,
          radius_km: geoSelection?.radiusKm ?? null,
        }),
      });
      const data = await res.json();
      if (data.territory) {
        // An edit never changes the row's creation date: the update route
        // only writes name, description and geo fields.
        setMessage({ type: "ok", text: isEditing ? t('fsm.territories.updatedOk') : `Territory "${name.trim()}" created.` });
        setName("");
        setDescription("");
        setGeoSelection(null);
        setUseGeoName(false);
        setEditingTerritoryId(null);
        await load();
        if (!isEditing) {
          setExpandedTerritoryId(data.territory.id);
          setSelectedCustomerIds([]);
        }
      } else {
        setMessage({ type: "error", text: data.error || (isEditing ? t('fsm.territories.updateFailed') : t('fsm.territories.createFailed')) });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('tracking.networkError') });
    }
  };

  const startEditTerritory = (territory: Territory) => {
    setName(territory.name);
    setDescription(territory.description ?? "");
    setGeoSelection(
      territory.center_lat != null && territory.center_lng != null
        ? {
            name: territory.name,
            description: territory.description ?? "",
            centerLat: territory.center_lat,
            centerLng: territory.center_lng,
            radiusKm: territory.radius_km ?? 3,
          }
        : null,
    );
    setUseGeoName(territory.center_lat != null && territory.center_lng != null);
    setEditingTerritoryId(territory.id);
    document.getElementById("territory-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEditTerritory = () => {
    setName("");
    setDescription("");
    setGeoSelection(null);
    setUseGeoName(false);
    setEditingTerritoryId(null);
  };

  const handleDeleteTerritory = async (territory: Territory) => {
    if (!window.confirm(t('fsm.territories.confirmDelete'))) return;
    try {
      const res = await authorizedFetch(`/api/territories/${territory.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setMessage({ type: "ok", text: t('fsm.territories.deletedOk') });
        if (expandedTerritoryId === territory.id) setExpandedTerritoryId(null);
        await load();
      } else {
        setMessage({ type: "error", text: data.error || t('fsm.territories.deleteFailed') });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('tracking.networkError') });
    }
  };

  const openCustomers = (territoryId: string) => {
    if (expandedTerritoryId === territoryId) {
      setExpandedTerritoryId(null);
      return;
    }
    setExpandedTerritoryId(territoryId);
    setSelectedCustomerIds(customers.filter((customer) => customer.assigned_territory_id === territoryId).map((customer) => customer.id));
    setCustomerSearch("");
  };

  const saveCustomers = async (territory: Territory) => {
    setSavingCustomers(true);
    try {
      const response = await authorizedFetch(`/api/territories/${territory.id}/customers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: selectedCustomerIds }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? t('fsm.territories.saveCustomersFailed'));
      setMessage({ type: "ok", text: `${selectedCustomerIds.length} customer(s) saved in ${territory.name}.` });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t('fsm.territories.saveCustomersFailed') });
    } finally {
      setSavingCustomers(false);
    }
  };

  const handleGeoSelect = (selection: TerritoryGeoSelection | null) => {
    setGeoSelection(selection);
    if (selection) {
      setUseGeoName(true);
      if (!name.trim()) setName(selection.name);
      if (!description.trim()) setDescription(selection.description);
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
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0" }}>{t('fsm.territories.title')}</h2>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0" }}>
            Sales areas used to organize customers, routes, and field staff assignments.
          </p>
        </div>
        <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={load}>
          {t('fsm.routes.refresh')}
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
          id="territory-form"
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
          <style>{mapsOverlayCss}</style>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", ...overlayInputCss }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>{t('fsm.territories.nameLabel')}</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gulberg Zone" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", ...overlayInputCss }}>
            <label style={{ fontSize: "0.75rem", color: "#374151" }}>{t('fsm.territories.descriptionLabel')}</label>
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button style={{ ...buttonStyle, ...overlayInputCss }} onClick={saveTerritory}>
            {editingTerritoryId ? t('fsm.territories.update') : t('fsm.territories.addTerritory')}
          </button>
          {editingTerritoryId && (
            <button style={{ ...buttonStyle, ...overlayInputCss, background: "#fff", color: "#111827", border: "1px solid #d1d5db" }} onClick={cancelEditTerritory}>
              {t('fsm.territories.cancelEdit')}
            </button>
          )}

          <div style={{ gridColumn: "1 / -1" }}>
            <TerritoryMapPicker onSelect={handleGeoSelect} />
          </div>

          {useGeoName && geoSelection && (
            <div style={{ gridColumn: "1 / -1", fontSize: "0.8rem", color: "#374151" }}>
              <span style={{ fontWeight: 600 }}>{t('fsm.territories.geoName')}</span> {geoSelection.name} &nbsp;
              <span style={{ fontWeight: 600 }}>{t('fsm.territories.geoRadius')}</span> {t('fsm.territories.geoRadiusValue').replace('{radius}', String(geoSelection.radiusKm))}
            </div>
          )}
        </div>
      )}

      {loading && territories.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>{t('fsm.territories.loading')}</p>
      ) : territories.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>{t('fsm.territories.empty')}</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {territories.map((territory, index) => {
            const memberCount = customers.filter((customer) => customer.assigned_territory_id === territory.id).length;
            const query = customerSearch.trim().toLowerCase();
            const visibleCustomers = customers.filter((customer) =>
              customer.is_active !== false
              && (!customer.assigned_territory_id || customer.assigned_territory_id === territory.id)
              && (!query || [customer.customer_name, customer.shop_name, customer.city, customer.area].some((value) => String(value ?? "").toLowerCase().includes(query)))
            );
            return <div key={territory.id} style={{ borderTop: index === 0 ? "none" : "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{territory.name}</div>
                {territory.description && (
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{territory.description}</div>
                )}
                {territory.center_lat != null && territory.center_lng != null && (
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.125rem" }}>
                    {territory.center_lat.toFixed(6)}, {territory.center_lng.toFixed(6)}
                    {territory.radius_km != null ? ` · ${t('fsm.territories.radiusDisplay').replace('{radius}', String(territory.radius_km))}` : ""}
                  </div>
                )}
                <div style={{ fontSize: "0.72rem", color: "#4b5563", marginTop: "0.2rem" }}>{t('fsm.territories.memberCount').replace('{count}', String(memberCount))}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {isOwner && (
                <>
                  <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={() => startEditTerritory(territory)}>
                    {t('fsm.territories.edit')}
                  </button>
                  <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={() => handleDeleteTerritory(territory)}>
                    {t('fsm.territories.delete')}
                  </button>
                </>
              )}
              <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }} onClick={() => openCustomers(territory.id)}>
                {expandedTerritoryId === territory.id ? t('fsm.territories.closeCustomers') : t('fsm.territories.manageCustomers')}
              </button>
              <span
                style={{
                  fontSize: "0.7rem",
                  background: territory.is_active ? "#dcfce7" : "#f3f4f6",
                  color: territory.is_active ? "#166534" : "#6b7280",
                  borderRadius: "999px",
                  padding: "0.125rem 0.5rem",
                }}
              >
                {territory.is_active ? t('products.active') : t('products.inactive')}
              </span>
              </div>
              </div>
              {expandedTerritoryId === territory.id && (
                <div style={{ borderTop: "1px solid #e5e7eb", background: "#fafafa", padding: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                    <div><div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{t('fsm.territories.customersIn').replace('{name}', territory.name)}</div><div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{t('fsm.territories.customersAvailable')}</div></div>
                    <input style={{ ...inputStyle, minWidth: "240px" }} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder={t('fsm.territories.searchPlaceholder')} />
                  </div>
                  <div style={{ maxHeight: "300px", overflowY: "auto", display: "grid", gap: "0.4rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                    {visibleCustomers.map((customer) => (
                      <label key={customer.id} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.55rem", background: "#fff", fontSize: "0.78rem" }}>
                        <input type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={(event) => setSelectedCustomerIds((current) => event.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))} />
                        <span><strong>{customer.customer_name}</strong>{customer.shop_name ? ` · ${customer.shop_name}` : ""}<br /><span style={{ color: "#6b7280" }}>{[customer.area, customer.city].filter(Boolean).join(", ") || t('team.noArea')}</span></span>
                      </label>
                    ))}
                  </div>
                  <button style={{ ...buttonStyle, marginTop: "0.75rem" }} disabled={savingCustomers} onClick={() => saveCustomers(territory)}>{savingCustomers ? t('fsm.territories.saving') : t('fsm.territories.saveCustomers').replace('{count}', String(selectedCustomerIds.length))}</button>
                </div>
              )}
            </div>
          })}
        </div>
      )}
    </div>
  );
}
