import type { LocationSample } from "./types";
import type { QueuedLocation } from "./storage";

export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
}

export function validDutyCutoff(value: string | null, now = Date.now()): boolean {
  const end = value ? Date.parse(value) : NaN;
  return Number.isFinite(end) && end > now;
}

export function appendDutyPoints(queued: QueuedLocation[], points: LocationSample[], sessionId: string | null, scheduledEndAt: string | null): QueuedLocation[] {
  const end = scheduledEndAt ? Date.parse(scheduledEndAt) : NaN;
  if (!sessionId || !Number.isFinite(end)) return queued;
  const seen = new Set(queued.map((item) => `${item.dutySessionId}:${item.point.capturedAt}`));
  return [...queued, ...points.filter((point) => {
    const key = `${sessionId}:${point.capturedAt}`;
    const time = Date.parse(point.capturedAt);
    if (!Number.isFinite(time) || time > end || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((point) => ({ dutySessionId: sessionId, scheduledEndAt, point }))];
}
