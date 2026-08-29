import assert from "node:assert/strict";
import {
  DELAYED_LOCATION_MAX_AGE_MS,
  LIVE_LOCATION_MAX_AGE_MS,
  deriveTrackingStatus,
  trackingStatusLabel,
} from "../src/lib/location/tracking-status";

const nowMs = Date.parse("2026-08-28T11:00:00.000Z");
const capturedAt = (ageMs: number) => new Date(nowMs - ageMs).toISOString();

assert.deepEqual(
  deriveTrackingStatus({ isOnDuty: false, capturedAt: capturedAt(1_000), nowMs }),
  { trackingStatus: "off_duty", lastUpdateAge: 1_000 }
);

assert.equal(
  deriveTrackingStatus({ isOnDuty: true, capturedAt: capturedAt(LIVE_LOCATION_MAX_AGE_MS), nowMs }).trackingStatus,
  "live"
);
assert.equal(
  deriveTrackingStatus({ isOnDuty: true, capturedAt: capturedAt(LIVE_LOCATION_MAX_AGE_MS + 1), nowMs }).trackingStatus,
  "delayed"
);
assert.equal(
  deriveTrackingStatus({ isOnDuty: true, capturedAt: capturedAt(DELAYED_LOCATION_MAX_AGE_MS + 1), nowMs }).trackingStatus,
  "stale"
);
assert.equal(
  deriveTrackingStatus({ isOnDuty: true, capturedAt: null, nowMs }).trackingStatus,
  "no_location"
);
assert.equal(
  deriveTrackingStatus({
    isOnDuty: true,
    capturedAt: capturedAt(1_000),
    deviceStatus: "permission_denied",
    nowMs,
  }).trackingStatus,
  "permission_denied"
);
assert.equal(trackingStatusLabel("battery_restricted"), "Battery restriction suspected");

console.log("Duty tracking status tests passed.");
