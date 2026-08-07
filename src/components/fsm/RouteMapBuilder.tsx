"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMaps } from "@/lib/maps/client-loader";

export interface RouteMapStop {
  key: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface RouteMapBuilderProps {
  territoryArea?: { centerLat: number; centerLng: number; radiusKm: number } | null;
  stops: RouteMapStop[];
  onAddStop: (stop: RouteMapStop) => void;
  onRemoveStop: (key: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

/**
 * Interactive route planner. When a territory is selected its coverage area is
 * drawn. Type a place/shop/street into the search box and press Add to drop a
 * numbered stop; the app draws markers + a connecting polyline and previews the
 * route. Every stop carries exact lat/lng so the salesman can navigate it.
 */
export default function RouteMapBuilder({
  territoryArea,
  stops,
  onAddStop,
  onRemoveStop,
  onReorder,
}: RouteMapBuilderProps) {
  const googleRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylineRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [pickedPlace, setPickedPlace] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);

  // Keep territory area in sync (draw circle).
  useEffect(() => {
    if (!googleRef.current || !mapRef.current || !circleRef.current) return;
    if (territoryArea) {
      circleRef.current.setCenter({ lat: territoryArea.centerLat, lng: territoryArea.centerLng });
      circleRef.current.setRadius(territoryArea.radiusKm * 1000);
      mapRef.current.setCenter({ lat: territoryArea.centerLat, lng: territoryArea.centerLng });
      mapRef.current.setZoom(13);
    } else {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
  }, [territoryArea]);

  const redraw = useCallback(() => {
    if (!googleRef.current || !mapRef.current) return;
    const google = googleRef.current;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (stops.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    const path = stops.map((stop, index) => {
      const latlng = new google.maps.LatLng(stop.latitude, stop.longitude);
      const marker = new google.maps.Marker({
        position: latlng,
        map: mapRef.current,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontWeight: "700",
        },
        title: stop.label,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      markersRef.current.push(marker);
      bounds.extend(latlng);
      return latlng;
    });

    if (path.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path,
        map: mapRef.current,
        strokeColor: "#2563eb",
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
    }

    mapRef.current.fitBounds(bounds, 60);
  }, [stops]);

  useEffect(() => {
    redraw();
  }, [stops, redraw]);

  const initMap = useCallback(() => {
    if (googleRef.current && mapRef.current) return;
    const canvas = document.getElementById("route-map-canvas");
    if (!canvas) return;

    const google = googleRef.current;
    const defaultCenter =
      territoryArea
        ? { lat: territoryArea.centerLat, lng: territoryArea.centerLng }
        : { lat: 31.5204, lng: 74.3587 };
    const map = new google.maps.Map(canvas, {
      zoom: 12,
      center: defaultCenter,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      streetViewControl: false,
      fullscreenControl: true,
      mapTypeControl: false,
    });
    mapRef.current = map;

    if (territoryArea) {
      circleRef.current = new google.maps.Circle({
        map,
        center: { lat: territoryArea.centerLat, lng: territoryArea.centerLng },
        radius: territoryArea.radiusKm * 1000,
        fillColor: "#22c55e",
        fillOpacity: 0.12,
        strokeColor: "#16a34a",
        strokeWeight: 2,
        clickable: false,
      });
    }

    if (searchInputRef.current && google.maps.places) {
      const auto = new google.maps.places.Autocomplete(searchInputRef.current, {
        types: ["establishment", "geocode"],
        fields: ["name", "formatted_address", "geometry"],
      });
      autocompleteRef.current = auto;
      auto.addListener("place_changed", () => {
        const place = auto.getPlace();
        if (!place || !place.geometry || !place.geometry.location) return;
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        map.setCenter({ lat, lng });
        map.setZoom(16);
        setSearchValue(`${place.name ?? ""}${place.formatted_address ? ` — ${place.formatted_address}` : ""}`);
        setPickedPlace({
          name: place.name ?? place.formatted_address ?? "Stop",
          address: place.formatted_address ?? "",
          lat,
          lng,
        });
      });
    }

    setStatus("ready");
  }, [territoryArea]);

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
      initMap();
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [initMap]);

  const addPicked = () => {
    if (!pickedPlace) {
      setLoadError("Search a place first, then press Add stop.");
      setStatus("ready");
      return;
    }
    onAddStop({
      key: `${pickedPlace.lat}-${pickedPlace.lng}-${Date.now()}`,
      label: pickedPlace.name,
      address: pickedPlace.address,
      latitude: pickedPlace.lat,
      longitude: pickedPlace.lng,
    });
    setPickedPlace(null);
    setSearchValue("");
  };

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
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search shop, street, or area for stop #1/#2/#3..."
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value);
            setPickedPlace(null);
          }}
          disabled={status !== "ready"}
          style={{
            flex: "1 1 240px",
            padding: "0.5rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            background: "#fff",
            color: "#111827",
          }}
        />
        <button
          onClick={addPicked}
          disabled={!pickedPlace}
          style={{
            padding: "0.5rem 1rem",
            background: pickedPlace ? "#111827" : "#9ca3af",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: pickedPlace ? "pointer" : "not-allowed",
          }}
        >
          Add stop {stops.length + 1}
        </button>
      </div>

      <div
        id="route-map-canvas"
        style={{ width: "100%", height: "340px", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
      />

      {territoryArea && (
        <p style={{ fontSize: "0.75rem", color: "#16a34a", margin: "0.5rem 0 0" }}>
          Territory area shown in green ({territoryArea.radiusKm} km radius). Add stops inside it to build the route.
        </p>
      )}

      {stops.length > 0 && (
        <div style={{ marginTop: "0.5rem", border: "1px solid #e5e7eb", borderRadius: "0.375rem", overflow: "hidden" }}>
          {stops.map((stop, index) => (
            <div
              key={stop.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.5rem 0.75rem",
                borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                gap: "0.5rem",
                flexWrap: "wrap",
                fontSize: "0.8rem",
              }}
            >
              <div>
                <span style={{ fontWeight: 600, color: "#374151" }}>
                  {index + 1}. {stop.label}
                </span>
                {stop.address && <span style={{ color: "#6b7280", marginLeft: "0.5rem" }}>{stop.address}</span>}
                <span style={{ color: "#9ca3af", marginLeft: "0.5rem" }}>
                  {stop.latitude.toFixed(6)}, {stop.longitude.toFixed(6)}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {onReorder && (
                  <>
                    <button
                      disabled={index === 0}
                      onClick={() => onReorder(index, index - 1)}
                      style={{ fontSize: "0.75rem", cursor: index === 0 ? "not-allowed" : "pointer" }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === stops.length - 1}
                      onClick={() => onReorder(index, index + 1)}
                      style={{ fontSize: "0.75rem", cursor: index === stops.length - 1 ? "not-allowed" : "pointer" }}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  onClick={() => onRemoveStop(stop.key)}
                  style={{
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    background: "#fee2e2",
                    color: "#991b1b",
                    border: "1px solid #fecaca",
                    borderRadius: "0.25rem",
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}