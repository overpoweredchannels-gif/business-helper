import assert from "node:assert/strict";
import { buildOrganizationContext } from "../src/lib/identity/api-context";

const context = buildOrganizationContext({
  profileId: "profile-123",
  organizationId: "org-123",
  email: "owner@example.com",
  role: "owner",
  isOwner: true,
  isActive: true,
});

assert.equal(context.actor.organizationId, "org-123");
assert.equal(context.permissionContext.organizationId, "org-123");
assert.equal(context.permissionContext.role, "owner");
assert.equal(context.permissionContext.isOwner, true);

console.log("tenant context helper OK");
