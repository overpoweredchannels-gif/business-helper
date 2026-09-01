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
}

void main();
