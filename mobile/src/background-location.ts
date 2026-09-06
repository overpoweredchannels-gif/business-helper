import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { appendDutyPoints, createSerialQueue, validDutyCutoff } from "./tracking-queue";
import { TradeOSApiError, uploadLocation } from "./api";
import {
  clearDutySessionId,
  getDutyScheduledEndAt,
  getDutySessionId,
  getQueuedLocations,
  saveQueuedLocations,
  hasLocationConsent,
  isStopPending,
} from "./storage";
import type { LocationSample } from "./types";

export const LOCATION_TASK_NAME = "tradeos-workforce-location";
const PERMANENT_LOCATION_REJECTION_STATUSES = new Set([400, 404, 409, 410, 422]);
const serialize = createSerialQueue();

const toSample = (location: Location.LocationObject): LocationSample => ({
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  accuracy: location.coords.accuracy ?? null,
  speed: location.coords.speed ?? null,
  heading: location.coords.heading ?? null,
  altitude: location.coords.altitude ?? null,
  capturedAt: new Date(location.timestamp).toISOString(),
});

async function processPoints(points: LocationSample[]): Promise<void> {
  const [sessionId, scheduledEndAt, queued] = await Promise.all([
    getDutySessionId(),
    getDutyScheduledEndAt(),
    getQueuedLocations(),
  ]);
  const scheduledEndMs = scheduledEndAt ? new Date(scheduledEndAt).getTime() : Number.NaN;
  const cutoffReached = !Number.isFinite(scheduledEndMs) || Date.now() >= scheduledEndMs;
  const mayCollect = await hasLocationConsent() && !(await isStopPending());
  const pending = appendDutyPoints(queued, mayCollect ? points : [], sessionId, scheduledEndAt);
  // Persist first: an OS termination during a slow request must not lose new points.
  await saveQueuedLocations(pending);
  if (cutoffReached || !mayCollect) await stopBackgroundTracking();

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
        PERMANENT_LOCATION_REJECTION_STATUSES.has(reason.status)
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

const uploadOrQueue = (points: LocationSample[]) => serialize(() => processPoints(points));

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
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error("GPS/location services are turned off. Turn on Location and try again.");
  }
}

export async function getCurrentSample(): Promise<LocationSample> {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 120_000,
    requiredAccuracy: 500,
  }).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const current = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("A fresh GPS fix is taking too long.")), 20_000);
      }),
    ]);
    return toSample(current);
  } catch (reason) {
    if (lastKnown) return toSample(lastKnown);
    throw new Error(
      reason instanceof Error
        ? `${reason.message} Turn on Location and try again near a window or outdoors.`
        : "Could not acquire a GPS position. Turn on Location and try again near a window or outdoors."
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startBackgroundTracking(): Promise<void> {
  const scheduledEndAt = await getDutyScheduledEndAt();
  if (!(await hasLocationConsent()) || await isStopPending()) {
    throw new Error("Tracking is stopped. Confirm consent and finish the pending Stop duty request before resuming.");
  }
  if (!validDutyCutoff(scheduledEndAt)) {
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
