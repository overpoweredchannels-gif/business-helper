"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMaps } from "@/lib/maps/client-loader";

export interface TerritoryGeoSelection {
  name: string;
  description: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

interface TerritoryMapPickerProps {
  onSelect?: (selection: TerritoryGeoSelection | null) => void;
  initialCenter?: { lat: number; lng: number } | null;
  initialRadiusKm?: number;
}

const DEFAULT_RADIUS_KM = 3;
const MAX_RADIUS_KM = 10;
const MIN_RADIUS_KM = 1;

/**
 * Embeds a Google Map with a Places search box. Searching "+ a place (e.g. DHA
 * Phase 6)" centres the map, drops a draggable pin and draws a coverage circle.
 * The radius is adjustable (default 3 km) and the highlighted area represents
 * the territory coverage. Exposes name/description/center/radius via onSelect.
 */
export default function TerritoryMapPicker({
  onSelect,
  initialCenter,
  initialRadiusKm,
}: TerritoryMapPickerProps) {
  const googleRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    initialCenter ?? null,
  );
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ?? DEFAULT_RADIUS_KM);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");

  const emit = useCallback(
    (centerVal: { lat: number; lng: number } | null, rKm: number, name: string, addr: string) => {
      if (!centerVal) {
        onSelect?.(null);
        return;
      }
      onSelect?.({
        name,
        description: addr ? `Covers areas within ${rKm} km of ${addr}.` : `Covers a ${rKm} km radius area.`,
        centerLat: centerVal.lat,
        centerLng: centerVal.lng,
        radiusKm: rKm,
      });
    },
    [onSelect],
  );

  // Initialize map once the Google library is available.
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const google = await getGoogleMaps();
      if (cancelled) return;
      if (!google) {
        setStatus("error");
        setLoadError(
          "Google Maps API key is not configured. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and reload.",
        );
        return;
      }
      googleRef.current = google;

      const mapEl = document.getElementById("territory-map-canvas");
      if (!mapEl) return;
      const start = center ?? { lat: 31.5204, lng: 74.3587 };
      const map = new google.maps.Map(mapEl, {
        zoom: 12,
        center: start,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        streetViewControl: false,
        fullscreenControl: true,
        mapTypeControl: false,
      });
      mapRef.current = map;

      const marker = new google.maps.Marker({
        position: start,
        map,
        draggable: true,
        title: "Territory center",
      });
      markerRef.current = marker;

      const circle = new google.maps.Circle({
        map,
        center: start,
        radius: radiusKm * 1000,
        fillColor: "#2563eb",
        fillOpacity: 0.12,
        strokeColor: "#2563eb",
        strokeWeight: 2,
        editable: true,
        draggable: true,
      });
      circleRef.current = circle;

      const sync = (lat: number, lng: number, rMeters: number) => {
        const rKmVal = Math.max(MIN_RADIUS_KM, Math.min(MAX_RADIUS_KM, rMeters / 1000));
        setCenter({ lat, lng });
        setRadiusKm(rKmVal);
        emit({ lat, lng }, rKmVal, placeName, placeAddress);
      };

      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        circle.setCenter(pos);
        sync(pos.lat(), pos.lng(), circle.getRadius());
      });
      circle.addListener("radius_changed", () => {
        const pos = marker.getPosition();
        sync(pos.lat(), pos.lng(), circle.getRadius());
      });
      circle.addListener("center_changed", () => {
        const c = circle.getCenter();
        marker.setPosition(c);
        sync(c.lat(), c.lng(), circle.getRadius());
      });

      // Search (Places Autocomplete) wired to the input.
      if (searchInputRef.current && google.maps.places) {
        const auto = new google.maps.places.Autocomplete(searchInputRef.current, {
          types: ["(regions)"],
          fields: ["name", "formatted_address", "geometry"],
        });
        autocompleteRef.current = auto;
        auto.addListener("place_changed", () => {
          const place = auto.getPlace();
          if (!place || !place.geometry || !place.geometry.location) return;
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          map.setCenter(place.geometry.location);
          map.setZoom(13);
          marker.setPosition({ lat, lng });
          circle.setCenter({ lat, lng });
          circle.setRadius(radiusKm * 1000);
          setPlaceName(place.name ?? place.formatted_address ?? "");
          setPlaceAddress(place.formatted_address ?? "");
          emit({ lat, lng }, radiusKm, place.name ?? "", place.formatted_address ?? "");
        });
      }

      emit(start, radiusKm, placeName, placeAddress);
      setStatus("ready");
    };

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCenter]);

  // Keep the circle + map in sync with external radius/center changes.
  useEffect(() => {
    if (!googleRef.current || !circleRef.current || !mapRef.current) return;
    if (center) {
      circleRef.current.setCenter(center);
      if (markerRef.current) markerRef.current.setPosition(center);
      mapRef.current.setCenter(center);
    }
    circleRef.current.setRadius(radiusKm * 1000);
  }, [center, radiusKm]);

  if (loadError) {
    return (
      <div
        style={{
          padding: "1rem",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "0.5rem",
          color: "#991b1b",
          fontSize: "0.875rem",
        }}
      >
        {loadError}
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.75rem", color: "#374151", display: "block", marginBottom: "0.25rem" }}>
          Search an area (e.g. DHA Phase 6)
        </label>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search for a place, area, or landmark..."
          disabled={status !== "ready"}
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            background: "#fff",
            color: "#111827",
          }}
        />
      </div>

      <div
        id="territory-map-canvas"
        style={{ width: "100%", height: "340px", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#374151" }}>Coverage radius:</span>
          <input
            type="range"
            min={MIN_RADIUS_KM}
            max={MAX_RADIUS_KM}
            step={0.5}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            style={{ width: "140px" }}
            disabled={status !== "ready"}
          />
          <span style={{ fontSize: "0.75rem", color: "#374151", fontWeight: 600 }}>{radiusKm} km</span>
        </div>

        {center && (
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
            {placeName ? `${placeName} · ` : ""}
            {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
          </span>
        )}
      </div>

      {center && (
        <p style={{ fontSize: "0.8rem", color: "#166534", margin: "0.5rem 0 0" }}>
          Territory will cover all areas within a {radiusKm} km radius of the selected point.
        </p>
      )}
    </div>
  );
}