/**
 * Employees page JSON guard (live PC bug, 2026-11-28).
 *
 * Defect (UMAIR's installed app v0.1.23, OP TRADERS): opening Employees
 * showed the red error
 *   Failed to execute 'json' on 'Response': Unexpected end of JSON input
 * and no employee ever loaded. Root cause: EmployeeManagement.load()
 * called res.json() on three parallel fetches without checking the
 * response first, and the 403 check sat AFTER .json(). Any empty-body
 * response (e.g. an uncaught server error surfacing as a bare 500)
 * throws exactly that error from res.json(), and the catch shows it
 * as the page error while the list never loads.
 *
 * Fix: src/lib/tradeos/safe-json.ts exports readJsonBody(), which reads
 * the body as text and returns null for an empty / non-JSON body instead
 * of throwing. EmployeeManagement uses it for every fetch response, and
 * the 403 branch now works off the parsed body (null-safe).
 *
 * This is a NEW instance, not a regression: git log has no prior fix for
 * "Unexpected end of JSON input" or for guarding .json() in this file.
 * The same error text reappears because the fragile unguarded-.json()
 * pattern is shared across call sites; each unfixed site can surface
 * the identical message.
 *
 * Run: npx tsx scripts/test-employees-json-guard.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readJsonBody } from "../src/lib/tradeos/safe-json";

let passed = 0;

function check(condition: boolean, label: string): void {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  console.log("(a) the reported failure, reproduced with the old call");
  // The exact response the Employees page received: an empty body.
  // The old code did `await res.json()` on it — that throws.
  const empty = new Response("", { status: 500 });
  let oldThrew: Error | null = null;
  try {
    await empty.json();
  } catch (err) {
    oldThrew = err as Error;
  }
  check(oldThrew instanceof Error, "res.json() on an empty body throws (the reported error)");
  check(
    oldThrew?.message.includes("Unexpected end of JSON input") ?? false,
    "the thrown message is exactly 'Unexpected end of JSON input'",
  );

  console.log("(b) the fix: readJsonBody never throws on an empty body");
  check((await readJsonBody(new Response("", { status: 500 }))) === null, "empty 500 body -> null");
  check((await readJsonBody(new Response("", { status: 200 }))) === null, "empty 200 body -> null");
  check((await readJsonBody(new Response("   \n  ", { status: 500 }))) === null, "whitespace-only body -> null");

  console.log("(c) valid JSON bodies still parse");
  const list = await readJsonBody(new Response(JSON.stringify({ employees: [] }), { status: 200 }));
  check(Array.isArray(list?.employees) && list.employees.length === 0, "empty employee list parses to { employees: [] }");
  const forbidden = await readJsonBody(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  check(forbidden?.error === "Forbidden", "403 JSON error body parses, so the 403 branch still works");

  console.log("(d) a non-JSON error page does not throw either");
  check(
    (await readJsonBody(new Response("<!DOCTYPE html><html>error</html>", { status: 500 }))) === null,
    "HTML error page -> null",
  );

  console.log("(e) the component is wired to the guard");
  const componentSource = readFileSync(
    new URL("../src/components/fsm/EmployeeManagement.tsx", import.meta.url),
    "utf8",
  );
  check(
    componentSource.includes('import { readJsonBody } from "@/lib/tradeos/safe-json"'),
    "EmployeeManagement imports readJsonBody from safe-json",
  );
  check(!componentSource.includes(".json()"), "EmployeeManagement has no remaining .json() call on a fetch response");
  check(
    componentSource.includes("readJsonBody(res)") &&
      componentSource.includes("readJsonBody(optionsRes)") &&
      componentSource.includes("readJsonBody(summariesRes)"),
    "load() parses all three parallel fetches through readJsonBody",
  );

  console.log("(f) the test is wired into the suite");
  const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  check(
    packageSource.includes('"test:employees-json-guard": "tsx scripts/test-employees-json-guard.ts"'),
    "package.json has the test:employees-json-guard script",
  );
  check(
    packageSource.includes("npm run test:employees-json-guard"),
    "the npm test chain runs test:employees-json-guard",
  );

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
