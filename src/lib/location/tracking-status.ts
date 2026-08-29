export type TrackingStatus =
  | "live"
  | "delayed"
  | "stale"
  | "no_location"
  | "permission_denied"
  | "gps_disabled"
  | "battery_restricted"
  | "error"
  | "off_duty";

export const LIVE_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
export const DELAYED_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

const DEVICE_FAILURES = new Set<TrackingStatus>([
  "permission_denied",
  "gps_disabled",
  "battery_restricted",
  "error",
]);

export function deriveTrackingStatus(input: {
  isOnDuty: boolean;
  capturedAt?: string | null;
  deviceStatus?: string | null;
  nowMs?: number;
}): { trackingStatus: TrackingStatus; lastUpdateAge: number } {
  const nowMs = input.nowMs ?? Date.now();
  const capturedMs = input.capturedAt ? new Date(input.capturedAt).getTime() : Number.NaN;
  const lastUpdateAge = Number.isFinite(capturedMs) ? Math.max(0, nowMs - capturedMs) : Infinity;

  if (!input.isOnDuty) return { trackingStatus: "off_duty", lastUpdateAge };

  const deviceStatus = input.deviceStatus as TrackingStatus | null | undefined;
  if (deviceStatus && DEVICE_FAILURES.has(deviceStatus)) {
    return { trackingStatus: deviceStatus, lastUpdateAge };
  }

  if (!Number.isFinite(capturedMs)) return { trackingStatus: "no_location", lastUpdateAge };
  if (lastUpdateAge <= LIVE_LOCATION_MAX_AGE_MS) return { trackingStatus: "live", lastUpdateAge };
  if (lastUpdateAge <= DELAYED_LOCATION_MAX_AGE_MS) return { trackingStatus: "delayed", lastUpdateAge };
  return { trackingStatus: "stale", lastUpdateAge };
}

export function trackingStatusLabel(status: TrackingStatus): string {
  switch (status) {
    case "live":
      return "Live";
    case "delayed":
      return "Delayed";
    case "stale":
      return "Offline / stale";
    case "no_location":
      return "Waiting for location";
    case "permission_denied":
      return "Location permission disabled";
    case "gps_disabled":
      return "GPS disabled";
    case "battery_restricted":
      return "Battery restriction suspected";
    case "error":
      return "Tracking error";
    default:
      return "Off duty";
  }
}
