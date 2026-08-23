import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { uploadLocation } from "./api";
import { getDutySessionId, getQueuedLocations, saveQueuedLocations } from "./storage";
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
  const sessionId = await getDutySessionId();
  const queued = await getQueuedLocations();
  const pending = [
    ...queued,
    ...(sessionId ? points.map((point) => ({ dutySessionId: sessionId, point })) : []),
  ];
  if (pending.length === 0) return;

  if (!sessionId && points.length > 0) {
    return;
  }

  let uploaded = 0;
  for (const item of pending) {
    try {
      await uploadLocation(item.dutySessionId, item.point);
      uploaded += 1;
    } catch {
      break;
    }
  }
  await saveQueuedLocations(pending.slice(uploaded));
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
