export type ProductionErrorSource = "server" | "client";

export interface ProductionErrorInput {
  source: ProductionErrorSource;
  message: string;
  stack?: string | null;
  digest?: string | null;
  path?: string | null;
  method?: string | null;
  routePath?: string | null;
  routeType?: string | null;
  organizationId?: string | null;
  profileId?: string | null;
}

interface ProductionErrorEvent extends ProductionErrorInput {
  event: "tradeos_runtime_error";
  occurredAt: string;
  environment: string;
  release: string | null;
}

const recentAlerts = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

function redact(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value
    .replace(/bearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[JWT REDACTED]")
    .replace(/(password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, maxLength);
}

function pathWithoutQuery(value: string | null | undefined): string | null {
  const safe = redact(value, 500);
  return safe?.split("?", 1)[0] ?? null;
}

function buildEvent(input: ProductionErrorInput): ProductionErrorEvent {
  return {
    event: "tradeos_runtime_error",
    occurredAt: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    release: process.env.VERCEL_GIT_COMMIT_SHA || null,
    source: input.source,
    message: redact(input.message, 1_000) || "Unknown runtime error",
    stack: redact(input.stack, 4_000),
    digest: redact(input.digest, 200),
    path: pathWithoutQuery(input.path),
    method: redact(input.method, 20),
    routePath: pathWithoutQuery(input.routePath),
    routeType: redact(input.routeType, 50),
    organizationId: redact(input.organizationId, 100),
    profileId: redact(input.profileId, 100),
  };
}

function shouldSendAlert(event: ProductionErrorEvent): boolean {
  const key = [event.source, event.message, event.path, event.routePath].join("|");
  const now = Date.now();
  const lastSent = recentAlerts.get(key);

  for (const [entry, timestamp] of recentAlerts) {
    if (now - timestamp > DEDUPE_WINDOW_MS * 2) recentAlerts.delete(entry);
  }

  if (lastSent !== undefined && now - lastSent < DEDUPE_WINDOW_MS) return false;
  recentAlerts.set(key, now);
  return true;
}

export async function reportProductionError(input: ProductionErrorInput): Promise<void> {
  const event = buildEvent(input);

  // Vercel captures stderr as structured runtime logs even when no alert
  // webhook is configured.
  console.error("[tradeos-runtime-error]", JSON.stringify(event));

  const webhookUrl = process.env.TRADEOS_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;
  if (process.env.NODE_ENV !== "production" && process.env.TRADEOS_ALERTS_IN_DEVELOPMENT !== "true") return;
  if (!shouldSendAlert(event)) return;

  const summary = `[TradeOS ${event.environment}] ${event.source} error: ${event.message}`;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: summary,
        content: summary,
        tradeos: event,
      }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[tradeos-alert-delivery-failed]", response.status, response.statusText);
    }
  } catch (error) {
    console.error(
      "[tradeos-alert-delivery-failed]",
      error instanceof Error ? error.message : String(error)
    );
  }
}
