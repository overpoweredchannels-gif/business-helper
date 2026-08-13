"use client";

import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

export interface ReverseGeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

export interface EtaResult {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Client-side helpers for the live tracking UI. Both reverse-geocoding (raw
 * coordinates -> street/shop name) and ETA (owner -> employee) hit TradeOS API
 * routes so the Google Maps Platform key stays server-side. Results are cached
 * by a short-lived Map so the 15-second polling never spams the API.
 */

const labelCache = new Map<string, Promise<ReverseGeocodeResult | null>>();
const etaCache = new Map<string, Promise<EtaResult | null>>();

function roundedKey(a: number, b: number): string {
  return `${a.toFixed(4)},${b.toFixed(4)}`;
}

/** Human-readable place name for a coordinate ("Main Blvd, near ABC Store"). */
export function getPlaceName(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  const key = roundedKey(lat, lng);
  const cached = labelCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const res = await authorizedFetch(
        `/api/maps/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
      );
      const data = await res.json();
      if (data.ok && data.place?.label) {
        return {
          label: data.place.label,
          latitude: data.place.latitude,
          longitude: data.place.longitude,
          placeId: data.place.placeId,
        } as ReverseGeocodeResult;
      }
      return null;
    } catch {
      return null;
    }
  })();
  labelCache.set(key, pending);
  pending.finally(() => labelCache.delete(key)).catch(() => {});
  return pending;
}

/** Driving travel time + distance from an origin to a destination. */
export function getEta(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<EtaResult | null> {
  const key = `${roundedKey(originLat, originLng)}|${roundedKey(destLat, destLng)}`;
  const cached = etaCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const res = await authorizedFetch(
        `/api/maps/eta?originLat=${encodeURIComponent(originLat)}&originLng=${encodeURIComponent(originLng)}` +
          `&destLat=${encodeURIComponent(destLat)}&destLng=${encodeURIComponent(destLng)}`
      );
      const data = await res.json();
      if (data.ok && data.eta) {
        return {
          distanceMeters: data.eta.distanceMeters,
          durationSeconds: data.eta.durationSeconds,
        } as EtaResult;
      }
      return null;
    } catch {
      return null;
    }
  })();
  etaCache.set(key, pending);
  pending.finally(() => etaCache.delete(key)).catch(() => {});
  return pending;
}

function fmtDuration(totalSeconds: number): string {
  const mins = totalSeconds / 60;
  if (mins < 1) return `${Math.round(totalSeconds)}s`;
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${Math.round(mins % 60)}m`;
}

function fmtDistance(totalMeters: number): string {
  if (totalMeters < 1000) return `${Math.round(totalMeters)} m`;
  return `${(totalMeters / 1000).toFixed(1)} km`;
}

export function formatEta(eta: EtaResult): string {
  return `${fmtDuration(eta.durationSeconds)} · ${fmtDistance(eta.distanceMeters)}`;
}

export { fmtDuration, fmtDistance };