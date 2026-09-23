import { SETUP_STEPS } from "./setup-steps";

const PROGRESS_PREFIX = "tradeos-setup-v1";
const COMPLETED_AT_PREFIX = "tradeos-setup-completed-v1";
// The key keeps its earlier name so a browser that already retired the banner
// does not retire it a second time.
const RETIRED_PREFIX = "tradeos-setup-banner-folded-v1";

/** How long the completed Setup card stays on the dashboard before it disappears. */
export const SETUP_BANNER_RETENTION_DAYS = 3;

export type SetupStage = "active" | "complete" | "expired";

export function setupProgressStorageKey(organizationId: string, userId: string) {
  return `${PROGRESS_PREFIX}:${organizationId}:${userId}`;
}
function setupCompletedAtStorageKey(organizationId: string, userId: string) {
  return `${COMPLETED_AT_PREFIX}:${organizationId}:${userId}`;
}
function setupAutoFoldedStorageKey(organizationId: string, userId: string) {
  return `${RETIRED_PREFIX}:${organizationId}:${userId}`;
}

export function normalizeReviewedSteps(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is number => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) < SETUP_STEPS.length))].sort((left, right) => left - right);
}

export function readSetupReviewedSteps(organizationId: string, userId: string): number[] {
  try {
    return normalizeReviewedSteps(JSON.parse(localStorage.getItem(setupProgressStorageKey(organizationId, userId)) || "[]"));
  } catch {
    return [];
  }
}

export function isSetupComplete(reviewed: number[]) {
  return reviewed.length >= SETUP_STEPS.length;
}

function readStoredNumber(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function readSetupCompletedAt(organizationId: string, userId: string): number | null {
  return readStoredNumber(setupCompletedAtStorageKey(organizationId, userId));
}

/** Stamps the moment setup was first seen complete so the banner can expire later. */
function rememberSetupCompletedAt(organizationId: string, userId: string): number {
  const existing = readSetupCompletedAt(organizationId, userId);
  if (existing) return existing;
  const now = Date.now();
  try {
    localStorage.setItem(setupCompletedAtStorageKey(organizationId, userId), String(now));
  } catch {
    // Storage may be unavailable; the banner simply keeps its current state.
  }
  return now;
}

export function hasSetupBannerExpired(completedAt: number | null, now: number = Date.now()) {
  return completedAt !== null && now - completedAt >= SETUP_BANNER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function hasSetupBannerRetired(organizationId: string, userId: string) {
  return readStoredNumber(setupAutoFoldedStorageKey(organizationId, userId)) !== null;
}

export function rememberSetupBannerRetired(organizationId: string, userId: string) {
  try {
    localStorage.setItem(setupAutoFoldedStorageKey(organizationId, userId), String(Date.now()));
  } catch {
    // Storage may be unavailable; the card simply hides again next visit.
  }
}

export function readSetupStage(organizationId: string, userId: string): SetupStage {
  if (!isSetupComplete(readSetupReviewedSteps(organizationId, userId))) return "active";
  // Stamps the first time setup is seen complete, then expires the reminder
  // SETUP_BANNER_RETENTION_DAYS later.
  return hasSetupBannerExpired(rememberSetupCompletedAt(organizationId, userId)) ? "expired" : "complete";
}
