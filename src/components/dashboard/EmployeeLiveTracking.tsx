"use client";

import { useState, useEffect, useCallback } from "react";
import { MapPin, Map, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmployeeLiveTrackingProps {
  isStaff: boolean;
  onTrackingToggle: (isActive: boolean) => void;
}

export function EmployeeLiveTracking({ isStaff, onTrackingToggle }: EmployeeLiveTrackingProps) {
  const [isTracking, setIsTracking] = useState(false);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleTracking = useCallback(() => {
    setIsTracking(!isTracking);
    onTrackingToggle(!isTracking);
  }, [isTracking, onTrackingToggle]);

  const fetchLocation = useCallback(async () => {
    try {
      if (typeof navigator === "undefined") {
        setLastLocation({ lat: 37.7749, lng: -122.4194 }); // San Francisco fallback
        return;
      }

      if (!navigator.geolocation) {
        setError("Geolocation not supported");
        return;
      }

      setError(null);
      const position = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          reject,
          { enableHighAccuracy: true, timeout: 20000 }
        );
      });

      setLastLocation({
        lat: position.latitude,
        lng: position.longitude,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (isTracking) {
      fetchLocation();
      const interval = setInterval(fetchLocation, 30000);
      return () => clearInterval(interval);
    }
  }, [isTracking]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            <MapPin className="size-3 mr-1" /> Live Tracking
          </h3>
          <span className="text-xs text-text/60 uppercase tracking-wired">Live Location</span>
        </div>
        <div className="flex items-center gap-2">
          {isTracking ? (
            <button
              onClick={toggleTracking}
              className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive/90 hover:opacity-90"
              title="Stop tracking"
            >
              <LogOut className="size-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={toggleTracking}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              title="Start tracking"
            >
              <MapPin className="size-3.5" /> Start
            </button>
          )}
          {isTracking && <span className="text-xs text-primary/90">Live</span>}
        </div>
      </div>

      {lastLocation ? (
        <div className="mt-3">
          <p className="text-xs text-text/60">
            <span className="font-medium">Location:</span> 
            {lastLocation.lat.toFixed(4)}, {lastLocation.lng.toFixed(4)}
          </p>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${lastLocation.lat},${lastLocation.lng}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 text-xs text-primary underline underline-offset-2 hover:opacity-90">
            <MapPin className="size-3" /> Open in Google Maps
          </a>
        </div>
      ) : (
        <p className="text-xs text-text/60">Fetching location…</p>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}