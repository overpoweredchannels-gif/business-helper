import assert from "node:assert/strict";
import { appendDutyPoints, createSerialQueue, validDutyCutoff } from "../mobile/src/tracking-queue";
import type { LocationSample } from "../mobile/src/types";

async function main() {
  const serialize = createSerialQueue();
  let stored: number[] = [];
  const write = (value: number) => serialize(async () => {
    const previous = [...stored];
    await Promise.resolve();
    stored = [...previous, value];
  });
  await Promise.all([write(1), write(2), write(3)]);
  assert.deepEqual(stored, [1, 2, 3], "Concurrent queue updates must preserve every write");
  await assert.rejects(serialize(async () => { throw new Error("offline"); }), /offline/);
  await write(4);
  assert.deepEqual(stored, [1, 2, 3, 4], "A failed upload must not block later work");
  const cutoff = "2026-09-06T12:00:00Z";
  const sample = (capturedAt: string): LocationSample => ({ latitude: 31, longitude: 74, accuracy: 5, speed: null, heading: null, altitude: null, capturedAt });
  const point = sample("2026-09-06T11:59:00Z");
  const queued = appendDutyPoints([], [point, point, sample("invalid"), sample("2026-09-06T12:01:00Z")], "duty-1", cutoff);
  assert.equal(queued.length, 1, "Duplicates, invalid timestamps and post-cutoff points are excluded");
  assert.equal(appendDutyPoints(queued, [point], "duty-1", cutoff).length, 1);
  assert.equal(appendDutyPoints(queued, [point], "duty-2", cutoff).length, 2);
  assert.deepEqual(appendDutyPoints([], [point], null, cutoff), []);
  assert.deepEqual(appendDutyPoints([], [point], "duty-1", "invalid"), []);
  assert.equal(validDutyCutoff(cutoff, Date.parse(point.capturedAt)), true);
  assert.equal(validDutyCutoff(cutoff, Date.parse(cutoff)), false);
  assert.equal(validDutyCutoff(null), false);
  assert.equal(validDutyCutoff("invalid"), false);
  console.log("Mobile tracking queue: concurrent writes, failure recovery, deduplication and duty cutoff passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
