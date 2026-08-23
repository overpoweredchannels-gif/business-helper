import assert from "node:assert/strict";
import { resolveEligibleCustomerIds, routeCustomersForAssignmentScope } from "../src/lib/sales/salesman-workspace-service";

const territories = new Map<string, string | null>([
  ["customer-a", "territory-1"],
  ["customer-b", "territory-1"],
  ["customer-c", "territory-2"],
]);

assert.deepEqual(
  resolveEligibleCustomerIds({
    assignedTerritoryId: "territory-1",
    directCustomerIds: ["customer-a"],
    routeCustomerIds: ["customer-b", "customer-c"],
    customerTerritoryById: territories,
  }).sort(),
  ["customer-a", "customer-b"],
  "direct and route customers in the employee territory should be eligible",
);

assert.deepEqual(
  resolveEligibleCustomerIds({
    assignedTerritoryId: null,
    directCustomerIds: ["customer-a"],
    routeCustomerIds: ["customer-c"],
    customerTerritoryById: territories,
  }).sort(),
  ["customer-a", "customer-c"],
  "without a territory, direct and route assignments should remain eligible",
);

assert.deepEqual(
  routeCustomersForAssignmentScope(["customer-a"], ["customer-a", "customer-b"]),
  [],
  "an explicit selected-customer subset should override the complete route scope",
);

assert.deepEqual(
  routeCustomersForAssignmentScope([], ["customer-a", "customer-b"]),
  ["customer-a", "customer-b"],
  "without an explicit subset, every customer stop on the assigned route should be eligible",
);

console.log("salesman assignment scope OK");
