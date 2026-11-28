import "./validation-environment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { GET as getCustomers, OPTIONS as customersPreflight } from "../src/app/api/customers/route";
import { OPTIONS as employeesPreflight } from "../src/app/api/identity/employees/route";
import { OPTIONS as employeePreflight } from "../src/app/api/identity/employees/[id]/route";
import { OPTIONS as assignmentPreflight } from "../src/app/api/identity/employees/[id]/assignment/route";

const read = (path: string) => readFileSync(path, "utf8");
const request = (origin: string, method = "OPTIONS") => new NextRequest("https://app.example.test/api/customers", {
  method, headers: { Origin: origin },
});

async function main() {
  for (const [preflight, methods] of [
    [customersPreflight, "GET, OPTIONS"],
    [employeesPreflight, "GET, POST, OPTIONS"],
    [employeePreflight, "GET, PATCH, DELETE, OPTIONS"],
    [assignmentPreflight, "PATCH, OPTIONS"],
  ] as const) {
    const response = preflight(request("http://127.0.0.1:49152"));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-methods"), methods);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:49152");
    assert.equal(preflight(request("https://other.example.test")).headers.get("access-control-allow-origin"), null);
  }
  const forbidden = await getCustomers(request("http://localhost:49543", "GET"));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), "http://localhost:49543");
  assert.equal(typeof (await forbidden.json()).error, "string");

  const employee = read("src/components/fsm/EmployeeManagement.tsx");
  assert.equal(employee.match(/\bcloudFetch\(/g)?.length, 8);
  assert.equal(employee.match(/\bauthorizedFetch\(/g)?.length, 1);
  assert.match(employee, /authorizedFetch\("\/api\/identity\/organization\/current"\)/);
  assert.doesNotMatch(employee, /\.json\(\)/);
  const history = read("src/components/sales/CustomerHistory.tsx");
  assert.match(history, /cloudFetch\("\/api\/customers\/assignment-options"\)[\s\S]*?readJsonBody\(response\)/);
  assert.match(history, /cloudFetch\(`\/api\/identity\/employees\/[\s\S]*?readJsonBody\(response\)/);
  const customers = read("src/app/api/customers/route.ts");
  assert.match(customers, /export async function POST[\s\S]*?createSupabaseUserClient\(getAccessToken/);
  const manifest = JSON.parse(read("DESKTOP_ROUTE_CLASSIFICATION.json"));
  for (const route of [
    "/api/customers", "/api/customers/assignment-options", "/api/identity/employees",
    "/api/identity/employees/summaries", "/api/identity/employees/[id]",
    "/api/identity/employees/[id]/assignment", "/api/identity/staff/invite",
  ]) {
    assert.equal(manifest.routes[route].classification, "CLOUD");
    assert.equal(manifest.routes[route].migrated, true);
  }
  assert.deepEqual(manifest.routes["/api/customers"].local_methods, ["POST"]);
  assert.equal(manifest.routes["/api/identity/employees/[id]/ledger"].migrated, undefined);
  assert.equal(manifest.routes["/api/identity/employees/[id]/reset-password"].migrated, undefined);
  console.log("Employees desktop CLOUD routing, authorization, preflight and local POST checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
