import assert from "node:assert/strict";
import { shouldRunProvision } from "../src/lib/offline/desktop-provision";

// 1. Web always provisions — online and offline alike (unchanged behaviour).
assert.equal(
  shouldRunProvision({ isDesktop: false, isOnline: true }),
  true,
  "1. Web + online runs provision",
);
assert.equal(
  shouldRunProvision({ isDesktop: false, isOnline: false }),
  true,
  "2. Web + offline runs provision",
);

// 2. Desktop never provisions — the local server has no service-role key,
// so the route 500s online and cannot succeed offline either.
assert.equal(
  shouldRunProvision({ isDesktop: true, isOnline: true }),
  false,
  "3. Desktop + online skips provision (no service-role key on the local server)",
);
assert.equal(
  shouldRunProvision({ isDesktop: true, isOnline: false }),
  false,
  "4. Desktop + offline skips provision (pre-existing Slice S1 skip)",
);

// 3. The decision is a pure function of its two inputs — same inputs,
// same answer, no environment read.
assert.equal(
  shouldRunProvision({ isDesktop: true, isOnline: true }),
  shouldRunProvision({ isDesktop: true, isOnline: true }),
  "5. Same inputs give the same answer",
);
assert.notEqual(
  shouldRunProvision({ isDesktop: true, isOnline: true }),
  shouldRunProvision({ isDesktop: false, isOnline: true }),
  "6. Only the desktop flag flips the answer when online",
);

console.log("test-desktop-provision: all assertions passed");
