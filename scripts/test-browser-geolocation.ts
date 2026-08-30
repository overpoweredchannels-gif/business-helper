import assert from "node:assert/strict";
import {
  acquireBrowserLocation,
  getBrowserLocationErrorMessage,
} from "../src/lib/location/browser-geolocation";

const position = (accuracy: number): GeolocationPosition => ({
  coords: {
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    latitude: 31.5204,
    longitude: 74.3587,
    speed: null,
    toJSON: () => ({}),
  },
  timestamp: Date.now(),
  toJSON: () => ({}),
});

function geolocationMock(run: (
  success: PositionCallback,
  error: PositionErrorCallback
) => void): Pick<Geolocation, "watchPosition" | "clearWatch"> & { cleared: number[] } {
  const cleared: number[] = [];
  return {
    cleared,
    watchPosition(success, error) {
      setTimeout(() => run(success, error ?? (() => undefined)), 0);
      return 7;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
}

async function main() {
  const precise = geolocationMock((success) => success(position(12)));
  assert.equal((await acquireBrowserLocation({ geolocation: precise, deadlineMs: 50 })).coords.accuracy, 12);
  assert.deepEqual(precise.cleared, [7]);

  const coarse = geolocationMock((success) => success(position(350)));
  assert.equal(
    (await acquireBrowserLocation({ geolocation: coarse, deadlineMs: 50, coarseFixWaitMs: 2 })).coords.accuracy,
    350
  );

  const denied = geolocationMock((_success, error) => error({
    code: 1,
    message: "denied",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }));
  await assert.rejects(acquireBrowserLocation({ geolocation: denied, deadlineMs: 50 }));
  assert.match(getBrowserLocationErrorMessage({ code: 1 }), /permission was denied/i);

  const timedOut = geolocationMock((_success, error) => error({
    code: 3,
    message: "timeout",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }));
  await assert.rejects(acquireBrowserLocation({ geolocation: timedOut, deadlineMs: 5 }));

  console.log("Browser geolocation fallback tests passed.");
}

void main();
