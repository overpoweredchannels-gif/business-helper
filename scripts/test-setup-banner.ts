import assert from "node:assert/strict";
import { SETUP_STEPS } from "../src/lib/setup/setup-steps";
import {
  SETUP_BANNER_RETENTION_DAYS,
  hasSetupBannerAutoFolded,
  hasSetupBannerExpired,
  isSetupComplete,
  normalizeReviewedSteps,
  readSetupReviewedSteps,
  readSetupStage,
  rememberSetupBannerAutoFolded,
  setupProgressStorageKey,
} from "../src/lib/setup/setup-progress";
import { readCollapsedBanners, writeCollapsedBanner } from "../src/lib/preferences/dashboard-banners";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  },
});

const organizationId = "org-1";
const userId = "user-1";
const completedAtKey = `tradeos-setup-completed-v1:${organizationId}:${userId}`;
const totalSteps = SETUP_STEPS.length;
const allSteps = SETUP_STEPS.map((_, index) => index);

// The checklist key is unchanged so progress saved by earlier releases still loads.
assert.equal(setupProgressStorageKey(organizationId, userId), `tradeos-setup-v1:${organizationId}:${userId}`,
  "The setup checklist storage key must stay compatible with saved progress");

assert.deepEqual(normalizeReviewedSteps([2, 0, 2, -1, 99, 1.5, "3", null]), [0, 2],
  "Only valid, unique step indexes are kept, in order");
assert.deepEqual(normalizeReviewedSteps("nope"), [], "Corrupt checklist progress falls back to nothing reviewed");
assert.equal(isSetupComplete(allSteps.slice(0, totalSteps - 1)), false, "A partially reviewed checklist is not complete");
assert.equal(isSetupComplete(allSteps), true, "Reviewing every step completes the checklist");

assert.deepEqual(readSetupReviewedSteps(organizationId, userId), [], "A new browser starts with nothing reviewed");
assert.equal(readSetupStage(organizationId, userId), "active", "The setup banner stays expanded while steps remain");

store.set(`tradeos-setup-v1:${organizationId}:${userId}`, JSON.stringify(allSteps));
assert.equal(readSetupStage(organizationId, userId), "complete", "A fully reviewed checklist folds the banner");
const completedAt = Number(store.get(completedAtKey));
assert.ok(Number.isFinite(completedAt) && completedAt > 0, "Completing setup stamps the moment it happened");
assert.equal(Number(store.get(completedAtKey)), completedAt, "The completion stamp is not refreshed on later visits");

const retentionMs = SETUP_BANNER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
assert.equal(hasSetupBannerExpired(null), false, "An unstarted checklist never expires the banner");
assert.equal(hasSetupBannerExpired(completedAt, completedAt + retentionMs - 1), false,
  "The completed banner is still visible just before the retention window ends");
assert.equal(hasSetupBannerExpired(completedAt, completedAt + retentionMs), true,
  "The completed banner expires once the retention window ends");

const staleStamp = Date.now() - retentionMs - 1000;
store.set(completedAtKey, String(staleStamp));
assert.equal(readSetupStage(organizationId, userId), "expired", "An old completion stamp hides the banner for good");
assert.equal(Number(store.get(completedAtKey)), staleStamp, "An expired banner does not refresh its completion stamp");

assert.equal(hasSetupBannerAutoFolded(organizationId, userId), false, "The banner has not auto-folded yet");
rememberSetupBannerAutoFolded(organizationId, userId);
assert.equal(hasSetupBannerAutoFolded(organizationId, userId), true, "Auto-folding is remembered per account");
assert.equal(hasSetupBannerAutoFolded(organizationId, "user-2"), false, "Auto-folding is not shared between users");

writeCollapsedBanner("profile-1", "greeting", true);
writeCollapsedBanner("profile-1", "setup-import", true);
assert.equal(readCollapsedBanners("profile-1").greeting, true, "The greeting line can be hidden on its own");
assert.equal(readCollapsedBanners("profile-1")["setup-import"], true, "Hiding the greeting keeps other banners folded");
writeCollapsedBanner("profile-1", "greeting", false);
assert.equal(readCollapsedBanners("profile-1").greeting, false, "The greeting line can be shown again");
assert.equal(readCollapsedBanners("profile-1")["setup-import"], true, "Showing the greeting does not expand other banners");
assert.equal(readCollapsedBanners("profile-2").greeting, undefined, "Banner state is stored per profile");

console.log(`Setup banner: checklist compatibility, completion fold, ${SETUP_BANNER_RETENTION_DAYS}-day expiry, auto-fold and greeting hide all behave as expected.`);
