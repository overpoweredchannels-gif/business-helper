import assert from "node:assert/strict";
import { reportProductionError } from "../src/lib/monitoring/error-reporter";

async function main() {
  const lines: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => lines.push(values.map(String).join(" "));

  try {
    await reportProductionError({
      source: "server",
      message: "request failed token=super-secret bearer abc.def.ghi",
      stack: "password=hunter2\n at handler",
      path: "/api/customers?email=private@example.com",
      routePath: "/api/customers",
      routeType: "route",
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /tradeos-runtime-error/);
  assert.match(lines[0], /\[REDACTED\]/);
  assert.doesNotMatch(lines[0], /super-secret|hunter2|private@example\.com/);
  assert.match(lines[0], /"path":"\/api\/customers"/);

  console.log("production monitoring redaction OK");

  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalWebhook = process.env.TRADEOS_ALERT_WEBHOOK_URL;
  const originalDevelopmentAlerts = process.env.TRADEOS_ALERTS_IN_DEVELOPMENT;
  let now = 1_000_000;
  let deliveries = 0;
  try {
    process.env.TRADEOS_ALERT_WEBHOOK_URL = "https://alerts.example.test";
    process.env.TRADEOS_ALERTS_IN_DEVELOPMENT = "true";
    Date.now = () => now;
    console.error = () => {};
    globalThis.fetch = async () => {
      deliveries++;
      return new Response(null, { status: 204 });
    };
    const input = { source: "server" as const, message: "persistent outage regression" };
    await reportProductionError(input);
    assert.equal(deliveries, 1, "First occurrence sends an alert");
    now += 30_000;
    await reportProductionError(input);
    assert.equal(deliveries, 1, "Duplicates within the window are suppressed");
    now += 30_000;
    await reportProductionError(input);
    assert.equal(deliveries, 2, "Continuous errors alert again after the window");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    console.error = originalConsoleError;
    if (originalWebhook === undefined) delete process.env.TRADEOS_ALERT_WEBHOOK_URL;
    else process.env.TRADEOS_ALERT_WEBHOOK_URL = originalWebhook;
    if (originalDevelopmentAlerts === undefined) delete process.env.TRADEOS_ALERTS_IN_DEVELOPMENT;
    else process.env.TRADEOS_ALERTS_IN_DEVELOPMENT = originalDevelopmentAlerts;
  }
  console.log("production monitoring sustained-error alerting OK");
}

void main();
