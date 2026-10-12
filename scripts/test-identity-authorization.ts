import assert from "node:assert/strict";
import {
  requireOwnerDirect,
  requirePermissionDirect,
  requireRoleDirect,
  requireOrganizationDirect,
} from "../src/lib/identity/authorization";
import { getRolePermissions } from "../src/lib/identity/roles";
import { EmployeeService } from "../src/lib/identity/services/employee-service";
import { StaffOnboardingService } from "../src/lib/identity/services/staff-onboarding-service";
import { ProfileService } from "../src/lib/identity/services/profile-service";
import { getStaffProfileRole } from "../src/lib/identity/staff-roles";
import { canImportStaffEntity, updateImportedStaffProfile } from "../src/lib/import-export/staff-profile-update";
import type { EmployeeRepository } from "../src/lib/identity/repositories/employee-repository";
import type { ProfileRepository } from "../src/lib/identity/repositories/profile-repository";
import type { Employee } from "../src/lib/tradeos/types";
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

async function verifyStaffCreationSafety() {
  let createCalls = 0;
  let persistedDesignation: string | undefined;
  const repository = {
    create: async (input: Record<string, unknown>) => {
      createCalls += 1;
      persistedDesignation = String(input.designation ?? "");
      return { ...input, id: "employee-test", organization_id: "org-1" } as Employee;
    },
  } as unknown as EmployeeRepository;
  const service = new EmployeeService(repository);

  const restrictedCreate = await service.createEmployee(manager, {
    full_name: "Cannot Escalate",
    designation: "owner",
  });
  assert.match(restrictedCreate.error ?? "", /store owner/i);
  assert.equal(createCalls, 0, "restricted callers cannot create employees with elevated designations");

  const defaultCreate = await service.createEmployee(owner, { full_name: "Default Staff" });
  assert.ok(defaultCreate.employee);
  assert.equal(persistedDesignation, "salesman", "server-side default is the existing restricted role");
  assert.equal(getStaffProfileRole(persistedDesignation), "salesman", "invited profile inherits the restricted role");
  assert.equal(getStaffProfileRole(null), "salesman", "missing employee designation cannot default to owner");
  assert.equal(getStaffProfileRole("constructor"), "salesman");
  assert.equal(getStaffProfileRole("unknown"), "salesman");
  assert.equal(getStaffProfileRole("owner"), "owner", "owner role requires an explicit owner designation");

  const restrictedInvite = await new StaffOnboardingService().generateInvite(manager, "employee-test");
  assert.equal(restrictedInvite.ok, false, "restricted callers cannot create a staff profile through invitation");
  assert.match(restrictedInvite.error ?? "", /store owner/i);

  let profileWrites = 0;
  let savedProfile: Record<string, unknown> | undefined;
  const profileRepository = {
    updateInOrganization: async (id: string, organizationId: string, updates: Record<string, unknown>) => {
      profileWrites += 1;
      savedProfile = { id, organization_id: organizationId, ...updates };
      return savedProfile;
    },
    linkAuthUser: async (id: string) => ({ id, auth_user_id: id }),
  } as unknown as ProfileRepository;
  const profileService = new ProfileService(profileRepository);
  await assert.rejects(
    profileService.updateStaffProfile(manager, "profile-staff", { display_name: "Staff", role: "owner", is_active: true }),
    /owner access/i,
  );
  assert.equal(profileWrites, 0, "restricted callers cannot reach the privileged profile update repository");
  await service.updateEmployee(manager, "employee-test", { designation: "owner" }).then(result => assert.match(result.error ?? "", /store owner/i));
  await profileService.updateStaffProfile(owner, "profile-staff", { display_name: "Staff", role: "salesman", is_active: true });
  assert.equal(savedProfile?.role, "salesman", "existing employee roles remain editable without being downgraded");
  await assert.rejects(profileService.updateStaffProfile(owner, owner.profileId!, { display_name: "Owner", role: "staff", is_active: true }), /own owner role/);
  await profileService.updateStaffProfile(owner, "profile-staff", { display_name: "Staff", role: "owner", is_active: true });
  assert.equal(savedProfile?.role, "owner", "an owner may explicitly assign the existing owner role");
  assert.equal(savedProfile?.organization_id, owner.organizationId, "profile updates remain organization-scoped");
  assert.equal((await profileService.linkCurrentAuthUser(manager)).auth_user_id, manager.profileId, "self-link uses only the authenticated profile ID");
}

async function verifyStaffImportUsesOwnerGatedProfileEndpoint() {
  for (const entity of ["staff", "employees"]) {
    assert.equal(canImportStaffEntity(entity, false), false, `${entity} import cannot bypass owner authorization with import_export permission`);
    assert.equal(canImportStaffEntity(entity, true), true);
  }
  assert.equal(canImportStaffEntity("products", false), true, "unrelated import permissions are preserved");
  let capturedId = "";
  let capturedUpdates: Record<string, unknown> | undefined;
  await updateImportedStaffProfile("profile-staff", {
    display_name: "Imported Staff",
    role: "salesman",
    is_active: true,
  }, async (id, updates) => {
    capturedId = id;
    capturedUpdates = updates;
    return { id };
  });

  assert.equal(capturedId, "profile-staff");
  assert.deepEqual(capturedUpdates, {
    display_name: "Imported Staff",
    role: "salesman",
    is_active: true,
  });
  await assert.rejects(updateImportedStaffProfile("profile-staff", { display_name: "Staff", role: "owner", is_active: true }), /Owner-authorized/);
  const service = new ProfileService();
  await assert.rejects(updateImportedStaffProfile("profile-staff", { display_name: "Staff", role: "owner", is_active: true },
    (id, updates) => service.updateStaffProfile(manager, id, updates)), /Owner access/);
}

verifyStaffCreationSafety().then(verifyStaffImportUsesOwnerGatedProfileEndpoint).then(() => {
  console.log("identity authorization, staff defaults, and owner-gated profile updates OK");
});
