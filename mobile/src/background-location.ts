import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { TradeOSApiError, uploadLocation } from "./api";
import {
  clearDutySessionId,
  getDutyScheduledEndAt,
  getDutySessionId,
  getQueuedLocations,
  saveQueuedLocations,
} from "./storage";
import type { LocationSample } from "./types";

export const LOCATION_TASK_NAME = "tradeos-workforce-location";

const toSample = (location: Location.LocationObject): LocationSample => ({
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  accuracy: location.coords.accuracy ?? null,
  speed: location.coords.speed ?? null,
  heading: location.coords.heading ?? null,
  altitude: location.coords.altitude ?? null,
  capturedAt: new Date(location.timestamp).toISOString(),
});

async function uploadOrQueue(points: LocationSample[]): Promise<void> {
  const [sessionId, scheduledEndAt, queued] = await Promise.all([
    getDutySessionId(),
    getDutyScheduledEndAt(),
    getQueuedLocations(),
  ]);
  const scheduledEndMs = scheduledEndAt ? new Date(scheduledEndAt).getTime() : Number.NaN;
  const cutoffReached = Number.isFinite(scheduledEndMs) && Date.now() >= scheduledEndMs;
  const validNewPoints = points.filter((point) => {
    if (!Number.isFinite(scheduledEndMs)) return true;
    return new Date(point.capturedAt).getTime() <= scheduledEndMs;
  });
  const pending = [
    ...queued,
    ...(sessionId
      ? validNewPoints.map((point) => ({ dutySessionId: sessionId, scheduledEndAt, point }))
      : []),
  ];

  let processed = 0;
  let serverEndedCurrentDuty = false;
  for (const item of pending) {
    const itemEndMs = item.scheduledEndAt ? new Date(item.scheduledEndAt).getTime() : Number.NaN;
    if (Number.isFinite(itemEndMs) && new Date(item.point.capturedAt).getTime() > itemEndMs) {
      processed += 1;
      continue;
    }
    try {
      await uploadLocation(item.dutySessionId, item.point);
      processed += 1;
    } catch (reason) {
      if (
        reason instanceof TradeOSApiError &&
        reason.status >= 400 &&
        reason.status < 500 &&
        reason.status !== 401 &&
        reason.status !== 403
      ) {
        processed += 1;
        if (reason.status === 409 && item.dutySessionId === sessionId) {
          serverEndedCurrentDuty = true;
        }
        continue;
      }
      break;
    }
  }
  await saveQueuedLocations(pending.slice(processed));

  if (cutoffReached || serverEndedCurrentDuty) {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    await clearDutySessionId();
  }
}

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error || !data) return;
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    await uploadOrQueue(locations.map(toSample));
  });
}

export async function requestTrackingPermissions(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    throw new Error("Precise location permission is required for duty tracking.");
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    throw new Error("Choose Allow all the time so tracking can continue when the app is minimized.");
  }
}

export async function getCurrentSample(): Promise<LocationSample> {
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
  return toSample(location);
}

export async function startBackgroundTracking(): Promise<void> {
  const scheduledEndAt = await getDutyScheduledEndAt();
  if (!scheduledEndAt || Date.now() >= new Date(scheduledEndAt).getTime()) {
    await clearDutySessionId();
    throw new Error("This duty session has ended. Start duty again on the next working day.");
  }
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30000,
    distanceInterval: 25,
    deferredUpdatesInterval: 30000,
    deferredUpdatesDistance: 25,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.OtherNavigation,
    foregroundService: {
      notificationTitle: "TradeOS duty tracking is active",
      notificationBody: "Your work location is being shared during this duty session. Open TradeOS to stop.",
      notificationColor: "#2563EB",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopBackgroundTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

export async function flushQueuedLocations(): Promise<void> {
  await uploadOrQueue([]);
}
