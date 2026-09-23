import assert from "node:assert/strict";
import {
  DASHBOARD_WIDGETS,
  addDashboardSectionCard,
  dashboardWidgetDefinition,
  normalizeHiddenWidgets,
  readDashboardWidgetPrefs,
  removeDashboardSectionCard,
  removeDashboardWidget,
  removedDashboardWidgets,
  resetDashboardWidgets,
  setDashboardWidgetHidden,
} from "../src/lib/preferences/dashboard-widgets";
import {
  DASHBOARD_SECTION_CARDS,
  availableSectionCards,
  dashboardSectionCardDefinition,
  dashboardSectionFromWidgetId,
  dashboardSectionWidgetId,
  normalizeSectionCards,
} from "../src/lib/dashboard/section-cards";
import { SETUP_STEPS } from "../src/lib/setup/setup-steps";
import {
  SETUP_BANNER_RETENTION_DAYS,
  hasSetupBannerExpired,
  hasSetupBannerRetired,
  normalizeReviewedSteps,
  readSetupStage,
  rememberSetupBannerRetired,
  setupProgressStorageKey,
} from "../src/lib/setup/setup-progress";
import {
  DISPLAY_ZOOM_PRESETS,
  MAX_DISPLAY_ZOOM_PERCENT,
  MIN_DISPLAY_ZOOM_PERCENT,
  displayZoomFromPercent,
  displayZoomPercent,
  formatDisplayZoom,
  normalizeDisplayZoom,
} from "../src/lib/preferences/display-zoom";

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

const profileId = "profile-1";
const organizationId = "org-1";
const userId = "user-1";

// ── Widget registry ────────────────────────────────────────────────────────
const ids = DASHBOARD_WIDGETS.map((widget) => widget.id);
assert.equal(new Set(ids).size, ids.length, "Every dashboard card id is unique");
assert.ok(ids.includes("setup-import") && ids.includes("business-records-export"), "The removable setup and export cards are registered");
assert.ok(DASHBOARD_WIDGETS.every((widget) => widget.label.length > 0 && widget.whereToFind.length > 0), "Every card explains where to find it after removal");
assert.equal(dashboardWidgetDefinition("kpi-today-sales")?.label, "Today's Sales", "Key-number cards can be looked up for the edit panel");
assert.ok(ids.includes("chart-revenue") && ids.includes("chart-profit") && ids.includes("ai-insight"), "Each chart and the AI recommendation is its own removable card");
assert.deepEqual(normalizeHiddenWidgets(["charts"]), ["chart-revenue", "chart-profit", "chart-top-products", "chart-top-customers"], "Hiding the old grouped charts card still hides every chart");

// ── Remove / add back / reset ──────────────────────────────────────────────
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, [], "A fresh dashboard shows every card");
assert.deepEqual(setDashboardWidgetHidden(profileId, "setup-import", true).hidden, ["setup-import"], "A card can be removed");
setDashboardWidgetHidden(profileId, "kpi-today-profit", true);
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, ["setup-import", "kpi-today-profit"], "Removal is persisted for the profile");
assert.deepEqual(setDashboardWidgetHidden(profileId, "setup-import", false).hidden, ["kpi-today-profit"], "A removed card can be added back");
assert.deepEqual(readDashboardWidgetPrefs("profile-2").hidden, [], "Another profile keeps its own layout");
assert.deepEqual(resetDashboardWidgets(profileId).hidden, [], "Reset brings every card back");

assert.deepEqual(normalizeHiddenWidgets(["setup-import", "setup-import", 7, null, "not-a-card"]), ["setup-import"], "Unknown or repeated entries are ignored");
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, [], "Corrupt preferences cannot hide cards");
store.set(`tradeos_dashboard_widgets_${profileId}`, "{not json");
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, [], "Unreadable preferences fall back to showing every card");
store.delete(`tradeos_dashboard_widgets_${profileId}`);

store.set(`tradeos_dashboard_banners_${profileId}`, JSON.stringify({ "setup-import": true, greeting: false }));
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, ["setup-import"], "A banner folded in the earlier release starts removed");
assert.deepEqual(removedDashboardWidgets(readDashboardWidgetPrefs(profileId).hidden).map((widget) => widget.label), ["Setup & Data Import"], "The edit panel lists removed cards by name");
store.delete(`tradeos_dashboard_banners_${profileId}`);

// ── Cards dropped in from the sidebar ──────────────────────────────────────
const sections = DASHBOARD_SECTION_CARDS.map((card) => card.section);
assert.equal(new Set(sections).size, sections.length, "Every droppable section appears once");
assert.ok(sections.includes("brands") && sections.includes("categories") && sections.includes("customers") && sections.includes("suppliers") && sections.includes("task-manager") && sections.includes("activity-logs"), "The sections the user wants to drag in are available");
assert.equal(dashboardSectionWidgetId("sales"), "section:sales", "A dropped card gets a stable id");
assert.equal(dashboardSectionFromWidgetId("section:sales"), "sales", "A dropped card id maps back to its section");
assert.equal(dashboardSectionFromWidgetId("section:not-a-section"), null, "An unknown dropped id is ignored");
assert.deepEqual(normalizeSectionCards(["sales", "sales", "nope", 4, null]), ["sales"], "Invalid or repeated dropped sections are ignored");
assert.equal(dashboardSectionCardDefinition("task-manager")?.label, "Task Manager", "Dropped cards keep a readable name");
assert.equal(availableSectionCards(["sales"]).some((card) => card.section === "sales"), false, "An added section is no longer offered again");

assert.deepEqual(addDashboardSectionCard(profileId, "customers").added, ["customers"], "A section dropped on the dashboard is remembered");
addDashboardSectionCard(profileId, "sales");
assert.deepEqual(readDashboardWidgetPrefs(profileId).added, ["customers", "sales"], "Dropped cards are stored in the order they were added");
assert.deepEqual(removeDashboardSectionCard(profileId, "customers").added, ["sales"], "A dropped card can be taken off again");
assert.deepEqual(removeDashboardWidget(profileId, "section:sales").added, [], "Removing a dropped card routes to the dropped list, not the hidden list");
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, [], "Removing a dropped card leaves the built-in cards alone");
removeDashboardWidget(profileId, "greeting");
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, ["greeting"], "Removing a built-in card still hides it");
resetDashboardWidgets(profileId);
addDashboardSectionCard(profileId, "sales");
resetDashboardWidgets(profileId);
assert.deepEqual(readDashboardWidgetPrefs(profileId).added, ["sales"], "Reset restores built-in cards without discarding dropped ones");
assert.deepEqual(readDashboardWidgetPrefs(profileId).hidden, [], "Reset brings every built-in card back");
store.set(`tradeos_dashboard_widgets_${profileId}`, JSON.stringify({ hidden: [], added: ["ghost"] }));
assert.deepEqual(readDashboardWidgetPrefs(profileId).added, [], "A dropped card that is no longer supported is dropped from storage");

// ── Setup reminder retirement ──────────────────────────────────────────────
const allSteps = SETUP_STEPS.map((_, index) => index);
assert.equal(setupProgressStorageKey(organizationId, userId), `tradeos-setup-v1:${organizationId}:${userId}`, "Saved checklist progress keeps loading");
assert.deepEqual(normalizeReviewedSteps([2, 0, 2, -1, 99, 1.5, "3", null]), [0, 2], "Only valid, unique step indexes are kept");
assert.equal(readSetupStage(organizationId, userId), "active", "The setup card stays while steps are outstanding");

const retentionMs = SETUP_BANNER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
store.set(`tradeos-setup-v1:${organizationId}:${userId}`, JSON.stringify(allSteps));
assert.equal(readSetupStage(organizationId, userId), "complete", "Completing every step marks the checklist complete");
const completedAt = Number(store.get(`tradeos-setup-completed-v1:${organizationId}:${userId}`));
assert.ok(Number.isFinite(completedAt) && completedAt > 0, "The completion moment is stamped once");
assert.equal(hasSetupBannerExpired(completedAt, completedAt + retentionMs - 1), false, "The reminder is still shown just before the retention window ends");
assert.equal(hasSetupBannerExpired(completedAt, completedAt + retentionMs), true, "The reminder expires when the retention window ends");

store.set(`tradeos-setup-completed-v1:${organizationId}:${userId}`, String(Date.now() - retentionMs - 1000));
assert.equal(readSetupStage(organizationId, userId), "expired", "The reminder retires after the retention window");
assert.equal(hasSetupBannerRetired(organizationId, userId), false, "Retirement is only recorded once the dashboard applies it");
rememberSetupBannerRetired(organizationId, userId);
assert.equal(hasSetupBannerRetired(organizationId, userId), true, "Retirement is remembered so re-adding the card sticks");
assert.equal(hasSetupBannerRetired(organizationId, "user-2"), false, "Retirement is tracked per user");

// ── Screen zoom ────────────────────────────────────────────────────────────
assert.deepEqual([...DISPLAY_ZOOM_PRESETS].slice(0, 3), [0.5, 0.6, 0.7], "Zoom-out presets below the old 80% floor are offered");
assert.equal(normalizeDisplayZoom(0.65), 0.65, "A typed in-between percentage is kept as-is");
assert.equal(normalizeDisplayZoom(0.2), MIN_DISPLAY_ZOOM_PERCENT / 100, "Zoom is clamped at the minimum");
assert.equal(normalizeDisplayZoom(5), MAX_DISPLAY_ZOOM_PERCENT / 100, "Zoom is clamped at the maximum");
assert.equal(normalizeDisplayZoom(0.6666), 0.67, "Zoom is rounded to whole percent");
assert.equal(normalizeDisplayZoom("abc"), 1, "Unreadable zoom falls back to 100%");
assert.equal(normalizeDisplayZoom(0), 1, "A zero zoom falls back to 100%");
assert.equal(formatDisplayZoom(0.6), "60%", "Zoom is shown as a percentage");
assert.equal(displayZoomFromPercent("72"), 0.72, "A percentage typed by the user is stored as the matching ratio");
assert.equal(displayZoomFromPercent(20), MIN_DISPLAY_ZOOM_PERCENT / 100, "A percentage below the floor is clamped");
assert.equal(displayZoomFromPercent(500), MAX_DISPLAY_ZOOM_PERCENT / 100, "A percentage above the ceiling is clamped");
assert.equal(displayZoomFromPercent("abc"), 1, "An unreadable percentage keeps 100%");
assert.equal(displayZoomPercent(0.72), 72, "The saved ratio is shown back as a whole percentage");

console.log("Dashboard customization: widget registry, remove/add/reset, legacy banner migration, setup retirement and 50-200% zoom all behave as expected.");
