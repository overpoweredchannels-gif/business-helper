export const DEFAULT_TARGET_ACCURACY_METERS = 100;
export const DEFAULT_LOCATION_DEADLINE_MS = 20_000;
export const DEFAULT_COARSE_FIX_WAIT_MS = 5_000;

type GeolocationLike = Pick<Geolocation, "watchPosition" | "clearWatch">;

export interface BrowserLocationOptions {
  geolocation?: GeolocationLike;
  targetAccuracyMeters?: number;
  deadlineMs?: number;
  coarseFixWaitMs?: number;
}

function accuracyOf(position: GeolocationPosition): number {
  const accuracy = position.coords.accuracy;
  return Number.isFinite(accuracy) ? accuracy : Number.POSITIVE_INFINITY;
}

function timeoutError(): GeolocationPositionError {
  return {
    code: 3,
    message: "Location request timed out.",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

/**
 * Acquire the best location Android can provide without rejecting a usable
 * coarse/cached fix. A precise result resolves immediately; otherwise the best
 * valid result is accepted after a short wait and the long-running watcher can
 * continue refining it after duty starts.
 */
export function acquireBrowserLocation(options: BrowserLocationOptions = {}): Promise<GeolocationPosition> {
  const geolocation = options.geolocation ?? (typeof navigator !== "undefined" ? navigator.geolocation : undefined);
  if (!geolocation) {
    return Promise.reject(new Error("This browser does not support location tracking."));
  }

  const targetAccuracyMeters = options.targetAccuracyMeters ?? DEFAULT_TARGET_ACCURACY_METERS;
  const deadlineMs = options.deadlineMs ?? DEFAULT_LOCATION_DEADLINE_MS;
  const coarseFixWaitMs = Math.min(options.coarseFixWaitMs ?? DEFAULT_COARSE_FIX_WAIT_MS, deadlineMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let bestPosition: GeolocationPosition | null = null;
    let lastError: GeolocationPositionError | null = null;
    let coarseTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let watchId: number | null = null;

    const cleanup = () => {
      if (coarseTimer) clearTimeout(coarseTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (watchId !== null) geolocation.clearWatch(watchId);
    };
    const finish = (position?: GeolocationPosition, error?: GeolocationPositionError | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (position) resolve(position);
      else reject(error ?? timeoutError());
    };
    const scheduleCoarseFallback = () => {
      if (coarseTimer) return;
      coarseTimer = setTimeout(() => {
        if (bestPosition) finish(bestPosition);
      }, coarseFixWaitMs);
    };

    deadlineTimer = setTimeout(() => {
      finish(bestPosition ?? undefined, lastError ?? timeoutError());
    }, deadlineMs);

    watchId = geolocation.watchPosition(
      (position) => {
        if (!bestPosition || accuracyOf(position) < accuracyOf(bestPosition)) {
          bestPosition = position;
        }
        if (accuracyOf(position) <= targetAccuracyMeters) {
          finish(position);
          return;
        }
        scheduleCoarseFallback();
      },
      (error) => {
        lastError = error;
        if (error.code === error.PERMISSION_DENIED || error.code === 1) {
          finish(undefined, error);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 120_000,
        timeout: deadlineMs,
      }
    );
  });
}

export function getBrowserLocationErrorMessage(error: unknown): string {
  const geoError =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: number; message?: string })
      : null;

  if (geoError?.code === 1) {
    return "Location permission was denied. Please allow precise location access and try again.";
  }
  if (geoError?.code === 2) {
    return "Location is currently unavailable. Turn on GPS/location services, move near a window if indoors, and try again.";
  }
  if (geoError?.code === 3) {
    return "No GPS position was available in time. Confirm that Location is turned on, then try again near a window or outdoors.";
  }

  return error instanceof Error ? error.message : geoError?.message ?? "Could not read current location.";
}
