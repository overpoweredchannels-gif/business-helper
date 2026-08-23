"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMaps } from "@/lib/maps/client-loader";

export interface RouteMapStop {
  key: string;
  customerId?: string | null;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface RouteMapBuilderProps {
  territoryArea?: { centerLat: number; centerLng: number; radiusKm: number } | null;
  customers?: Array<{ id: string; customer_name: string; shop_name?: string | null }>;
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
  customers = [],
  stops,
  onAddStop,
  onRemoveStop,
  onReorder,
}: RouteMapBuilderProps) {
  const googleRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const pickedMarkerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [pickedPlace, setPickedPlace] = useState<{
    name: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);

  const selectMapPlace = useCallback((place: { name: string; address: string; lat: number; lng: number }) => {
    setPickedPlace(place);
    setSearchValue(`${place.name}${place.address && place.address !== place.name ? ` — ${place.address}` : ""}`);
    setSelectionError(null);
    if (pickedMarkerRef.current) pickedMarkerRef.current.setMap(null);
    if (googleRef.current && mapRef.current) {
      pickedMarkerRef.current = new googleRef.current.maps.Marker({
        position: { lat: place.lat, lng: place.lng },
        map: mapRef.current,
        title: place.name,
        animation: googleRef.current.maps.Animation.DROP,
      });
      mapRef.current.setCenter({ lat: place.lat, lng: place.lng });
      mapRef.current.setZoom(17);
    }
  }, []);

  const clearPickedPlace = () => {
    setPickedPlace(null);
    setSelectionError(null);
    if (pickedMarkerRef.current) {
      pickedMarkerRef.current.setMap(null);
      pickedMarkerRef.current = null;
    }
  };

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

    const reverseGeocode = (lat: number, lng: number) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results: any[], geocodeStatus: string) => {
        const result = geocodeStatus === "OK" ? results?.[0] : null;
        if (!result) {
          setSelectionError("Google Maps could not identify this point. Search for the shop or click a labeled place.");
          return;
        }
        selectMapPlace({
          name: result.formatted_address ?? "Map location",
          address: result.formatted_address ?? "",
          lat,
          lng,
        });
      });
    };

    map.addListener("click", (event: any) => {
      if (!event.latLng) return;
      const lat = event.latLng.lat();
      const lng = event.latLng.lng();
      if (event.placeId && google.maps.places) {
        event.stop?.();
        const places = new google.maps.places.PlacesService(map);
        places.getDetails(
          { placeId: event.placeId, fields: ["name", "formatted_address", "geometry"] },
          (place: any, placeStatus: string) => {
            if (placeStatus === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
              selectMapPlace({
                name: place.name ?? place.formatted_address ?? "Map location",
                address: place.formatted_address ?? "",
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
              });
              return;
            }
            reverseGeocode(lat, lng);
          },
        );
        return;
      }
      reverseGeocode(lat, lng);
    });

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
        selectMapPlace({
          name: place.name ?? place.formatted_address ?? "Stop",
          address: place.formatted_address ?? "",
          lat,
          lng,
        });
      });
    }

    setStatus("ready");
  }, [selectMapPlace, territoryArea]);

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
    const customer = customers.find((item) => item.id === selectedCustomerId);
    onAddStop({
      key: `${pickedPlace.lat}-${pickedPlace.lng}-${Date.now()}`,
      customerId: customer?.id ?? null,
      label: customer
        ? `${customer.customer_name}${customer.shop_name ? ` (${customer.shop_name})` : ""} — ${pickedPlace.name}`
        : pickedPlace.name,
      address: pickedPlace.address,
      latitude: pickedPlace.lat,
      longitude: pickedPlace.lng,
    });
    setPickedPlace(null);
    setSearchValue("");
    setSelectedCustomerId("");
    if (pickedMarkerRef.current) {
      pickedMarkerRef.current.setMap(null);
      pickedMarkerRef.current = null;
    }
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
        <select
          value={selectedCustomerId}
          onChange={(event) => setSelectedCustomerId(event.target.value)}
          style={{
            flex: "1 1 220px",
            padding: "0.5rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            background: "#fff",
            color: "#111827",
          }}
        >
          <option value="">Custom location (no customer)</option>
          {customers
            .filter((customer) => !stops.some((stop) => stop.customerId === customer.id))
            .map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customer_name}{customer.shop_name ? ` (${customer.shop_name})` : ""}
              </option>
            ))}
        </select>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search shop, street, or area for stop #1/#2/#3..."
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value);
            clearPickedPlace();
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
          {selectedCustomerId ? "Tag customer at stop" : "Add custom stop"} {stops.length + 1}
        </button>
      </div>

      <div style={{ marginBottom: "0.5rem", border: `1px solid ${pickedPlace ? "#86efac" : "#e5e7eb"}`, borderRadius: "0.375rem", background: pickedPlace ? "#f0fdf4" : "#f9fafb", padding: "0.6rem 0.75rem", fontSize: "0.78rem" }}>
        {pickedPlace ? (
          <>
            <div><strong>Customer:</strong> {customers.find((customer) => customer.id === selectedCustomerId)?.customer_name ?? "Custom location"}</div>
            <div><strong>Google Maps location:</strong> {pickedPlace.name}</div>
            <div style={{ color: "#4b5563" }}>{pickedPlace.address || "No formatted address returned"}</div>
            <div style={{ color: "#6b7280" }}>{pickedPlace.lat.toFixed(6)}, {pickedPlace.lng.toFixed(6)}</div>
          </>
        ) : <span style={{ color: "#6b7280" }}>Search for a shop or click a labeled shop/place directly on the map to select its exact location.</span>}
        {selectionError && <div style={{ color: "#b91c1c", marginTop: "0.25rem" }}>{selectionError}</div>}
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
                {stop.customerId && <span style={{ color: "#166534", marginLeft: "0.5rem" }}>Customer tagged</span>}
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
