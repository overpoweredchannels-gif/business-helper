import assert from "node:assert/strict";
import {
  requireOwnerDirect,
  requirePermissionDirect,
  requireRoleDirect,
  requireOrganizationDirect,
} from "../src/lib/identity/authorization";
import { getRolePermissions } from "../src/lib/identity/roles";
import type { ActorContext } from "../src/lib/identity/types";

const owner: ActorContext = {
  profileId: "profile-1",
  organizationId: "org-1",
  email: "owner@example.com",
  role: "owner",
  isOwner: true,
  isActive: true,
  permissions: [],
};

const manager: ActorContext = {
  profileId: "profile-2",
  organizationId: "org-1",
  email: "manager@example.com",
  role: "manager",
  isOwner: false,
  isActive: true,
  permissions: ["suppliers_manage", "reports_view"],
};

const viewer: ActorContext = {
  profileId: "profile-3",
  organizationId: "org-1",
  email: "viewer@example.com",
  role: "viewer",
  isOwner: false,
  isActive: true,
  permissions: ["reports_view"],
};

assert.equal(requireOwnerDirect(owner).allowed, true);
assert.equal(requireOwnerDirect(manager).allowed, false);

assert.equal(requirePermissionDirect(owner, "administration").allowed, true);
assert.equal(requirePermissionDirect(manager, "suppliers_manage").allowed, true);
assert.equal(requirePermissionDirect(manager, "administration").allowed, false);
assert.equal(requirePermissionDirect(viewer, "suppliers_manage").allowed, false);

assert.equal(requireRoleDirect(owner, "owner").allowed, true);
assert.equal(requireRoleDirect(manager, "owner").allowed, false);

assert.equal(requireOrganizationDirect(owner).allowed, true);
assert.equal(requireOrganizationDirect({ ...viewer, organizationId: "" }).allowed, false);

const salesmanPermissions = getRolePermissions("salesman");
assert.equal(salesmanPermissions.includes("field_sales"), true);
assert.equal(salesmanPermissions.includes("location_view"), true);
assert.equal(salesmanPermissions.includes("sales_view"), false);
assert.equal(salesmanPermissions.includes("customers_manage"), false);

console.log("identity authorization helpers OK");
