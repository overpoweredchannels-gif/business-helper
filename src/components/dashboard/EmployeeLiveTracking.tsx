"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Loader2, AlertCircle, LogOut, Radio, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { getMapProvider } from "@/lib/maps/map-provider";
import { getPlaceName } from "@/lib/maps/client-maps";
import { acquireBrowserLocation, getBrowserLocationErrorMessage } from "@/lib/location/browser-geolocation";

interface MeResponse {
  ok: boolean;
  me?: {
    profile?: { id?: string; organization_id?: string; full_name?: string | null };
    employee?: { full_name?: string | null; designation?: string | null } | null;
  };
  error?: string;
}

interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  capturedAt: string;
}

export function EmployeeLiveTracking() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [booting, setBooting] = useState(false);
  const [lastLocation, setLastLocation] = useState<LocationPoint | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSavedTimeRef = useRef(0);
  const lastSavedLocationRef = useRef<LocationPoint | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    setTracking(false);
  }, []);

  const uploadPoint = useCallback(
    async (sessionId: string, point: LocationPoint) => {
      try {
        const res = await authorizedFetch("/api/location/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dutySessionId: sessionId,
            latitude: point.latitude,
            longitude: point.longitude,
            accuracy: point.accuracy,
            speed: point.speed,
            heading: point.heading,
            altitude: point.altitude,
            capturedAt: point.capturedAt,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (res.status === 409) {
          if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current);
          }
          watchIdRef.current = null;
          sessionIdRef.current = null;
          setTracking(false);
          setMessage(data.error || "Duty ended at the scheduled cutoff. Start duty again on the next working day.");
          setError(null);
          return;
        }
        if (data.ok) {
          setLastSavedAt(point.capturedAt);
          lastSavedTimeRef.current = new Date(point.capturedAt).getTime();
          lastSavedLocationRef.current = point;
          setError(null);
        } else {
          throw new Error(data.error || "Upload failed");
        }
      } catch {
        setError("Your location was found, but the latest update could not be saved. TradeOS will retry on the next GPS update.");
      }
    },
    []
  );

  // Reverse-geocode the employee's current location so they see a real street/shop
  // name instead of raw coordinates.
  const lastLatitude = lastLocation?.latitude;
  const lastLongitude = lastLocation?.longitude;
  useEffect(() => {
    if (lastLatitude == null || lastLongitude == null) return;
    let alive = true;
    getPlaceName(lastLatitude, lastLongitude)
      .then((place) => {
        if (alive && place?.label) setPlaceName(place.label);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lastLatitude, lastLongitude]);

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
      const accuracy = position.coords.accuracy ?? null;
      const point: LocationPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy,
        speed: position.coords.speed ?? null,
        heading: position.coords.heading ?? null,
        altitude: position.coords.altitude ?? null,
        capturedAt: new Date().toISOString(),
      };
      setLastLocation(point);

      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      const now = new Date(point.capturedAt).getTime();
      const lastSavedLocation = lastSavedLocationRef.current;
      const distanceMeters =
        lastSavedTimeRef.current > 0 && lastSavedLocation
          ? Math.hypot(
              (point.latitude - lastSavedLocation.latitude) * 111320,
              (point.longitude - lastSavedLocation.longitude) * 111320 * Math.max(0.2, Math.cos((point.latitude * Math.PI) / 180))
            )
          : Number.POSITIVE_INFINITY;
      const enoughTimePassed = now - lastSavedTimeRef.current >= 30000;
      const meaningfulDistance = distanceMeters >= 25;

      if (enoughTimePassed || meaningfulDistance) {
        void uploadPoint(sessionId, point);
      }
    },
    [uploadPoint]
  );

  const resumeWatch = useCallback(
    (sessionId: string) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) return;
      if (watchIdRef.current !== null) return;
      sessionIdRef.current = sessionId;
      const watchId = navigator.geolocation.watchPosition(
        handlePosition,
        (geoError) => {
          if (geoError.code === geoError.TIMEOUT || geoError.code === 3) {
            setMessage("Live tracking is active and waiting for the next GPS update.");
            return;
          }
          setError(getBrowserLocationErrorMessage(geoError));
        },
        { enableHighAccuracy: true, maximumAge: 120000, timeout: 30000 }
      );
      watchIdRef.current = watchId;
      setTracking(true);
    },
    [handlePosition]
  );

  const loadIdentity = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/staff/me");
      const data: MeResponse = await res.json();
      if (data.ok && data.me) {
        setProfileId(data.me.profile?.id ?? null);
        setOrganizationId(data.me.profile?.organization_id ?? null);
        setDisplayName(
          data.me.employee?.full_name || data.me.profile?.full_name || null
        );
      } else {
        setError(data.error || "Failed to load your profile.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!profileId || !organizationId) return;
    try {
      const res = await authorizedFetch("/api/location/device-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          organizationId,
          profileId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; onDuty?: boolean; dutySessionId?: string | null; startedAt?: string | null };
      if (data.ok && data.onDuty && data.dutySessionId) {
        sessionIdRef.current = data.dutySessionId;
        setTracking(true);
        resumeWatch(data.dutySessionId);
        setMessage("Resumed sharing your live location.");
      }
    } catch {
      // status check is best-effort
    }
  }, [profileId, organizationId, resumeWatch]);

  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  useEffect(() => {
    if (!loading) void loadStatus();
  }, [loading, loadStatus]);

  const startTracking = useCallback(async () => {
    setError(null);
    setMessage(null);

    if (!profileId || !organizationId) {
      setError("Your profile is not loaded. Please refresh and try again.");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser does not support location tracking.");
      return;
    }

    setBooting(true);
    setMessage("Acquiring accurate GPS fix…");
    try {
      const position = await acquireBrowserLocation();

      const startPoint: LocationPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
        speed: position.coords.speed ?? null,
        heading: position.coords.heading ?? null,
        altitude: position.coords.altitude ?? null,
        capturedAt: new Date().toISOString(),
      };

      const res = await authorizedFetch("/api/location/device-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          organizationId,
          profileId,
          startLatitude: startPoint.latitude,
          startLongitude: startPoint.longitude,
          startAccuracy: startPoint.accuracy,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; dutySessionId?: string | null; message?: string; error?: string };
      if (!data.ok || !data.dutySessionId) {
        throw new Error(data.error || data.message || "Could not start live tracking.");
      }

      sessionIdRef.current = data.dutySessionId;
      setLastLocation(startPoint);
      lastSavedTimeRef.current = 0;
      lastSavedLocationRef.current = null;
      void uploadPoint(data.dutySessionId, startPoint);

      setTracking(true);
      setMessage("Live tracking started. Your location is being shared with your organization.");

      resumeWatch(data.dutySessionId);
    } catch (err) {
      setError(getBrowserLocationErrorMessage(err));
    } finally {
      setBooting(false);
    }
  }, [profileId, organizationId, resumeWatch, uploadPoint]);

  const stopTracking = useCallback(async () => {
    setError(null);
    stopWatch();

    if (profileId && organizationId) {
      try {
        await authorizedFetch("/api/location/device-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "signout", organizationId, profileId }),
        });
      } catch {
        // best-effort signout
      }
    }

    sessionIdRef.current = null;
    lastSavedLocationRef.current = null;
    setMessage("Live tracking stopped. Location sharing is off.");
  }, [profileId, organizationId, stopWatch]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-body">
          <Loader2 className="size-4 animate-spin text-primary" /> Loading live tracking…
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-3 shrink-0">
            {tracking && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex rounded-full size-3",
                tracking ? "bg-success" : "bg-muted-foreground"
              )}
            />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              <MapPin className="size-3.5 mr-1 inline-block" />
              Live Tracking
            </h3>
            <span className="text-xs text-body">
              {tracking ? "Sharing your live location" : "Location sharing is off"}
            </span>
          </div>
        </div>
        {tracking ? (
          <button
            onClick={() => void stopTracking()}
            className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            title="Stop sharing your location"
          >
            <LogOut className="size-3.5" /> Stop
          </button>
        ) : (
          <button
            onClick={() => void startTracking()}
            disabled={booting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            title="Allow location access and start sharing"
          >
            {booting ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}
            {booting ? "Starting…" : "Start"}
          </button>
        )}
      </div>

      {message && (
        <p className="mb-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">{message}</p>
      )}
      {error && (
        <p className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {tracking && lastLocation ? (
        <div className="mt-1 rounded-lg border border-border bg-muted/20 p-3 grid gap-3">
          <iframe
            title={`Your current live location`}
            src={getMapProvider().buildEmbedMapUrl(
              { latitude: lastLocation.latitude, longitude: lastLocation.longitude },
              displayName ?? "Current location"
            )}
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            className="w-full rounded-lg border border-border"
            style={{ height: 200 }}
          />
          <div className="text-xs text-body">
            {displayName ? <span className="font-medium text-foreground">{displayName} · </span> : null}
            {placeName ? (
              <span className="text-foreground/90">📍 {placeName}</span>
            ) : (
              <span className="font-mono">
                {lastLocation.latitude.toFixed(5)}, {lastLocation.longitude.toFixed(5)}
              </span>
            )}
            {lastLocation.accuracy != null && (
              <span
                className={`ml-1 inline-block rounded px-1 py-0.5 text-[10px] font-semibold ${
                  lastLocation.accuracy <= 100
                    ? "bg-success/10 text-success"
                    : "bg-warning/10 text-warning"
                }`}
              >
                ±{Math.round(lastLocation.accuracy)}m
              </span>
            )}
            <span className="ml-1 inline-flex items-center gap-1 text-success">
              <Crosshair className="size-3 animate-pulse" /> live
            </span>
          </div>
          {lastSavedAt && (
            <div className="text-[11px] text-body">
              Last updated {new Date(lastSavedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-body">
          Start live tracking to share your location with your organization. Location is uploaded while TradeOS
          stays open.
        </p>
      )}
    </div>
  );
}
