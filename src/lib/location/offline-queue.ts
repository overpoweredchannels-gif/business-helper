import type { OfflineLocationPoint } from "./types";

const STORAGE_KEY = "tradeos_location_offline_queue";

export function getOfflineQueue(): OfflineLocationPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToOfflineQueue(point: Omit<OfflineLocationPoint, "id" | "retryCount">): void {
  const queue = getOfflineQueue();
  queue.push({
    ...point,
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    retryCount: 0,
  });
  if (queue.length > 500) queue.splice(0, queue.length - 500);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    if (queue.length > 100) {
      queue.splice(0, queue.length - 100);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
      } catch {}
    }
  }
}

export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export async function syncOfflineQueue(
  uploadFn: (point: OfflineLocationPoint) => Promise<boolean>
): Promise<{ synced: number; failed: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: OfflineLocationPoint[] = [];

  for (const point of queue) {
    try {
      const ok = await uploadFn(point);
      if (ok) {
        synced++;
      } else {
        point.retryCount++;
        if (point.retryCount < 5) remaining.push(point);
        else failed++;
      }
    } catch {
      point.retryCount++;
      if (point.retryCount < 5) remaining.push(point);
      else failed++;
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {}

  return { synced, failed };
}

export function getOfflineQueueSize(): number {
  return getOfflineQueue().length;
}
