/**
 * AI Insight cross-tab sync (P1 Area J extension, 2026-11-20).
 *
 * Defect: `refreshAiAlertsAfterSave` (page.tsx) resolves stale alerts
 * and regenerates fresh ones on the SERVER, but only the tab that made
 * the save re-reads its rows (`fetchAiAlerts`). A second open tab of
 * the same app keeps showing its rendered alerts until it reloads —
 * the card there stays stale even though the server state is fresh.
 *
 * Fix: after a save refreshes alerts, the saving tab broadcasts an
 * invalidation to the other tabs; each other tab re-reads its rows
 * from the server (the broadcast carries only the org id, never alert
 * data — the receiving tab fetches the fresh state itself).
 *
 * Transport: BroadcastChannel is primary; a `localStorage` write is
 * the fallback, because a `storage` event fires in OTHER tabs only —
 * never in the tab that wrote — so the fallback can never echo back
 * to the sender. Every broadcast carries a fresh `at` timestamp so
 * the storage write is always a new value and the event fires every
 * time. Both transports are fail-open: a missing BroadcastChannel, a
 * blocked localStorage, or a malformed message can never throw into
 * the save flow or the receiving tab.
 *
 * No ping-pong: a receiving tab only fetches — it never broadcasts —
 * and a BroadcastChannel never delivers a message to the channel
 * object that posted it, so a broadcast can never loop.
 */

export const AI_ALERTS_CROSS_TAB_CHANNEL = "aankh-ai-alerts";
export const AI_ALERTS_CROSS_TAB_STORAGE_KEY = "aankh-ai-alerts-invalidated";

export interface AiAlertsInvalidatedMessage {
  type: "ai-alerts-invalidated";
  organizationId: string;
  at: string;
}

/** Build the cross-tab payload for an org. Pure — unit-testable. */
export function aiAlertsInvalidatedMessage(
  organizationId: string,
  at: string = new Date().toISOString(),
): AiAlertsInvalidatedMessage {
  return { type: "ai-alerts-invalidated", organizationId, at };
}

/** True only for a well-formed invalidation message. Pure — unit-testable. */
export function isAiAlertsInvalidatedMessage(value: unknown): value is AiAlertsInvalidatedMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "ai-alerts-invalidated" &&
    typeof record.organizationId === "string" &&
    record.organizationId.length > 0 &&
    typeof record.at === "string"
  );
}

interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface WindowLike {
  addEventListener(type: "storage", listener: (event: { key: string | null; newValue: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null; newValue: string | null }) => void): void;
}

let sharedChannel: BroadcastChannelLike | null = null;
let sharedChannelTried = false;

/** Lazily-created singleton: one channel per tab, never closed. */
function getSharedChannel(): BroadcastChannelLike | null {
  if (sharedChannelTried) return sharedChannel;
  sharedChannelTried = true;
  try {
    const ctor = (
      globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike }
    ).BroadcastChannel;
    if (typeof ctor === "function") {
      sharedChannel = new ctor(AI_ALERTS_CROSS_TAB_CHANNEL);
    }
  } catch {
    sharedChannel = null;
  }
  return sharedChannel;
}

function getStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function"
    ) {
      return storage;
    }
  } catch {
    return null;
  }
  return null;
}

function getWindow(): WindowLike | null {
  try {
    const win = (globalThis as { window?: WindowLike }).window;
    if (win && typeof win.addEventListener === "function") return win;
  } catch {
    return null;
  }
  return null;
}

/**
 * Tell the other tabs of this app that this org's AI alerts changed
 * on the server. Fail-open: never throws.
 */
export function broadcastAiAlertsInvalidated(organizationId: string): void {
  const orgId = typeof organizationId === "string" ? organizationId.trim() : "";
  if (orgId === "") return;
  const message = aiAlertsInvalidatedMessage(orgId);
  try {
    getSharedChannel()?.postMessage(message);
  } catch {
    // Fail-open: the storage fallback below still reaches other tabs.
  }
  try {
    getStorage()?.setItem(AI_ALERTS_CROSS_TAB_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Fail-open: a blocked storage still leaves the BroadcastChannel path.
  }
}

/**
 * Subscribe this tab to invalidations for one org. The handler runs
 * only for messages naming that org, on either transport. Returns an
 * unsubscribe function. Fail-open: never throws.
 */
export function subscribeAiAlertsInvalidated(
  organizationId: string,
  onInvalidate: () => void,
): () => void {
  const orgId = typeof organizationId === "string" ? organizationId.trim() : "";
  if (orgId === "") return () => undefined;

  const handleMessage = (value: unknown): void => {
    if (isAiAlertsInvalidatedMessage(value) && value.organizationId === orgId) {
      try {
        onInvalidate();
      } catch {
        // Fail-open: a failing handler must never break the subscriber.
      }
    }
  };

  const channel = getSharedChannel();
  const channelListener = (event: { data: unknown }): void => handleMessage(event.data);
  try {
    channel?.addEventListener("message", channelListener);
  } catch {
    // Fail-open: the storage fallback below still delivers.
  }

  const win = getWindow();
  const storageListener = (event: { key: string | null; newValue: string | null }): void => {
    if (event.key !== AI_ALERTS_CROSS_TAB_STORAGE_KEY || typeof event.newValue !== "string") {
      return;
    }
    try {
      handleMessage(JSON.parse(event.newValue) as unknown);
    } catch {
      // Malformed storage payload — ignore.
    }
  };
  try {
    win?.addEventListener("storage", storageListener);
  } catch {
    // Fail-open: the BroadcastChannel path still delivers.
  }

  return () => {
    try {
      channel?.removeEventListener("message", channelListener);
    } catch {
      // Ignore: the channel is going away with the tab anyway.
    }
    try {
      win?.removeEventListener("storage", storageListener);
    } catch {
      // Ignore: the window is going away with the tab anyway.
    }
  };
}
