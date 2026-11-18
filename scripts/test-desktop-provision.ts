import assert from "node:assert/strict";
import { resolveDesktopCallbackRoute, shouldRunProvision } from "../src/lib/offline/desktop-provision";

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

// 4. Desktop auth-callback routing: a profile with an organization goes
// home; a profile without one (new user) goes to onboarding.
assert.equal(
  resolveDesktopCallbackRoute(true),
  "/",
  "7. Desktop callback with an organization routes home",
);
assert.equal(
  resolveDesktopCallbackRoute(false),
  "/onboarding",
  "8. Desktop callback without an organization routes to onboarding",
);

// 5. The routing decision is a pure function of its input — same input,
// same route.
assert.equal(
  resolveDesktopCallbackRoute(false),
  resolveDesktopCallbackRoute(false),
  "9. Same organization flag gives the same route",
);

console.log("test-desktop-provision: all assertions passed");
