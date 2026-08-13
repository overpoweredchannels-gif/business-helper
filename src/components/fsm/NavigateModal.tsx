"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Navigation, MapPin, Clock, Route as RouteIcon, AlertCircle } from "lucide-react";
import { getEta, getPlaceName, formatEta, type EtaResult } from "@/lib/maps/client-maps";
import type { CurrentLocationView } from "@/lib/location/types";

interface NavigateModalProps {
  employee: CurrentLocationView;
  onClose: () => void;
}

export default function NavigateModal({ employee, onClose }: NavigateModalProps) {
  const [ownerPos, setOwnerPos] = useState<{ lat: number; lng: number } | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [eta, setEta] = useState<EtaResult | null>(null);
  const [etaDone, setEtaDone] = useState(false);
  const [destPlace, setDestPlace] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    if (!navigator.geolocation) {
      queueMicrotask(() =>
        setOwnerError("Your browser does not support location. ETA is unavailable.")
      );
      return;
    }
    let alive = true;
    // Ask for YOUR (owner's) location once so we can show real travel time.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!alive) return;
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOwnerPos(p);
      },
      () => {
        if (!alive) return;
        setOwnerError("Location access was denied — ETA is unavailable. You can still navigate via Google Maps.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
    return () => {
      alive = false;
    };
  }, []);

  // ETA from owner's live position to the employee's live position.
  useEffect(() => {
    if (!ownerPos || employee.latitude == null || employee.longitude == null) return;
    let alive = true;
    getEta(ownerPos.lat, ownerPos.lng, employee.latitude, employee.longitude)
      .then((r) => {
        if (alive) setEta(r);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setEtaDone(true);
      });
    return () => {
      alive = false;
    };
  }, [ownerPos, employee.latitude, employee.longitude]);

  // Show the destination's street / shop name instead of plain coordinates.
  useEffect(() => {
    if (employee.latitude == null || employee.longitude == null) return;
    let alive = true;
    getPlaceName(employee.latitude, employee.longitude)
      .then((place) => {
        if (alive && place?.label) setDestPlace(place.label);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [employee.latitude, employee.longitude]);

  const destLat = employee.latitude;
  const destLng = employee.longitude;
  const hasDest = destLat != null && destLng != null;

  // Deep link that opens turn-by-turn in Google Maps (works on mobile + desktop).
  const navUrl = hasDest
    ? `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving`
    : undefined;

  // Embed a route preview if we know both the owner's and employee's positions.
  const routeEmbedUrl =
    ownerPos && hasDest
      ? `https://maps.google.com/maps?saddr=${ownerPos.lat},${ownerPos.lng}&daddr=${destLat},${destLng}&output=embed&z=13`
      : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-card sm:h-[90vh] sm:max-w-3xl sm:rounded-3xl sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground truncate">
              Navigate to {employee.employeeName}
            </div>
            <div className="text-xs text-body flex items-center gap-1.5">
              <MapPin className="size-3.5 text-primary" />
              <span className="truncate">{destPlace ?? "Live location"}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-body hover:bg-muted/60 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Route preview */}
        <div className="relative min-h-[260px] w-full flex-1 border-b border-border">
          {routeEmbedUrl ? (
            <iframe
              title={`Route to ${employee.employeeName}`}
              src={routeEmbedUrl}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              className="h-full w-full min-h-[260px]"
            />
          ) : (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-body">
              <RouteIcon className="size-6 text-light-text" />
              {ownerError ? (
                <p>{ownerError}</p>
              ) : (
                <>
                  <Loader2 className="size-5 animate-spin text-primary" />
                  <p>Waiting for your location to draw the route…</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* ETA card */}
        <div className="px-5 py-4 grid gap-3">
          <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-body">
              <Clock className="size-4 text-primary" />
              <span>
                {ownerPos && !etaDone ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" /> Calculating travel time…
                  </span>
                ) : eta ? (
                  <span className="text-foreground font-semibold">{formatEta(eta)} to reach</span>
                ) : (
                  <span>Travelling to {employee.employeeName}&apos;s live location</span>
                )}
              </span>
            </div>
            {ownerPos ? (
              <span className="text-[10px] text-success font-medium uppercase tracking-wide">using your location</span>
            ) : null}
          </div>

          {ownerError && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" /> {ownerError}
            </div>
          )}

          {navUrl && (
            <a
              href={navUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Navigation className="size-4" /> Start Turn-by-Turn Navigation
              <span className="text-[10px] font-normal opacity-80">(opens Google Maps)</span>
            </a>
          )}

          <p className="text-center text-[11px] text-light-text">
            Tap the button to get step-by-step driving directions to {employee.employeeName}&apos;s current position.
          </p>
        </div>
      </div>
    </div>
  );
}