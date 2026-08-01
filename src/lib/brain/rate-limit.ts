const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

function now(): number {
  return Date.now();
}

export function checkRateLimit(key: string, maxRequests: number = MAX_REQUESTS_PER_WINDOW, windowMs: number = WINDOW_MS): { allowed: boolean; remaining: number; resetAt: number } {
  const t = now();
  const entry = windows.get(key);

  if (!entry || t >= entry.resetAt) {
    windows.set(key, { count: 1, resetAt: t + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: t + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

export function resetRateLimit(key: string): void {
  windows.delete(key);
}
