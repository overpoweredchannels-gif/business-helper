"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CurrentLocationView } from "../../lib/location/types";

interface LiveMapProps {
  employees: CurrentLocationView[];
  googleMapsKey?: string;
  onEmployeeClick?: (employee: CurrentLocationView) => void;
  selectedEmployeeId?: string | null;
}

declare global {
  interface Window {
    initTradeOSMap?: () => void;
  }
}

export default function LiveMap({ employees, googleMapsKey, onEmployeeClick, selectedEmployeeId }: LiveMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const initMap = useCallback(() => {
    if (!mapRef.current || !window.google) return;
    const map = new window.google.maps.Map(mapRef.current, {
      zoom: 13,
      center: { lat: 31.5204, lng: 74.3587 },
      mapTypeId: window.google.maps.MapTypeId.ROADMAP,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapInstanceRef.current = map;
    infoWindowRef.current = new window.google.maps.InfoWindow();
    setMapLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.google && window.google.maps) {
      initMap();
      return;
    }
    if (!googleMapsKey) {
      setMapError("Google Maps API key not configured. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY in .env.local.");
      return;
    }
    window.initTradeOSMap = initMap;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&callback=initTradeOSMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      setMapError("Failed to load Google Maps. Check your API key and network.");
    };
    document.head.appendChild(script);
    return () => {
      delete window.initTradeOSMap;
      const scripts = document.head.querySelectorAll("script[src*='maps.googleapis.com']");
      scripts.forEach((s) => s.remove());
    };
  }, [googleMapsKey, initMap]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.google) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let hasBounds = false;

    for (const emp of employees) {
      if (!emp.hasLocation || !emp.latitude || !emp.longitude) continue;

      const marker = new window.google.maps.Marker({
        position: { lat: emp.latitude, lng: emp.longitude },
        map: mapInstanceRef.current,
        title: emp.employeeName,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: emp.isOnDuty ? 10 : 7,
          fillColor: emp.isOnDuty ? (emp.speed && emp.speed > 1 ? "#f59e0b" : "#22c55e") : "#9ca3af",
          fillOpacity: emp.profileId === selectedEmployeeId ? 1 : 0.8,
          strokeColor: emp.profileId === selectedEmployeeId ? "#ef4444" : "#ffffff",
          strokeWeight: emp.profileId === selectedEmployeeId ? 3 : 2,
        },
      });

      const age = emp.lastUpdateAge < 60000 ? "Just now" : `${Math.round(emp.lastUpdateAge / 60000)} min ago`;
      const speed = emp.speed ? `, ${Math.round(emp.speed * 3.6)} km/h` : "";
      const content = `
        <div style="min-width:180px;font-family:sans-serif;font-size:13px;line-height:1.5">
          <strong>${emp.employeeName}</strong><br/>
          Role: ${emp.role || "N/A"}<br/>
          Status: ${emp.isOnDuty ? "On Duty" : "Off Duty"}<br/>
          Updated: ${age}${speed}<br/>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${emp.latitude},${emp.longitude}"
             target="_blank" rel="noopener noreferrer"
             style="color:#2563eb;text-decoration:underline">
            Open in Google Maps
          </a>
        </div>
      `;

      marker.addListener("click", () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open(mapInstanceRef.current, marker);
        }
        if (onEmployeeClick) onEmployeeClick(emp);
      });

      markersRef.current.push(marker);
      bounds.extend(new window.google.maps.LatLng(emp.latitude, emp.longitude));
      hasBounds = true;
    }

    if (hasBounds) {
      mapInstanceRef.current.fitBounds(bounds, 50);
    }
  }, [employees, mapLoaded, selectedEmployeeId, onEmployeeClick]);

  if (mapError) {
    return (
      <div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem", color: "#991b1b" }}>
        {mapError}
      </div>
    );
  }

  if (!googleMapsKey) {
    return (
      <div style={{ padding: "1rem", background: "#fefce8", border: "1px solid #fde68a", borderRadius: "0.5rem", color: "#92400e" }}>
        Google Maps is not configured. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY in your environment variables to enable the live map.
      </div>
    );
  }

  return (
    <div ref={mapRef} style={{ width: "100%", height: "100%", minHeight: "400px", borderRadius: "0.5rem" }}>
      {!mapLoaded && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", color: "#6b7280" }}>
          Loading map...
        </div>
      )}
    </div>
  );
}
