import assert from "node:assert/strict";
import {
  buildAssignableRoles,
  hasAssignableRolePermission,
  isAssignableRoleId,
} from "../src/lib/identity/assignable-roles";

// Custom role assignment slice.
//
// Rules under test:
// 1. The assignable list is the 11 built-in staffRoles (label = id,
//    exactly as the dropdown showed before) plus the org's custom
//    roles (label = display name, value = org-prefixed id).
// 2. A custom role id is assignable; an unknown/dangling id is not —
//    so the client save falls back to "staff" only for ids that are
//    neither built-in nor a live custom role.
// 3. Effective permissions resolve for custom roles too: a custom role
//    with import_export grants it, one without it does not, and a
//    dangling role id grants nothing. Built-in roles resolve exactly
//    as before (roles.ts), and the server enforces the same way
//    (api-context.ts RoleRepository fallback).

const CUSTOM_ROLES = [
  {
    id: "6d428742236b41fb82d2d579688f0d5_cashier",
    name: "Cashier",
    permissions: ["sales_view", "sales_create", "import_export"] as const,
  },
  {
    id: "6d428742236b41fb82d2d579688f0d5_stocker",
    name: "Stocker",
    permissions: ["inventory_view"] as const,
  },
];

function main() {
  // ─── 1. Assignable list: built-in + custom ──────────────────────────
  const roles = buildAssignableRoles(
    CUSTOM_ROLES.map((role) => ({
      ...role,
      permissions: [...role.permissions],
    })),
  );

  // The 11 built-in staff roles, unchanged, label = id.
  const builtIn = roles.filter((role) => role.isBuiltIn);
  assert.deepEqual(
    builtIn.map((role) => role.id),
    [
      "owner",
      "admin",
      "manager",
      "staff",
      "accountant",
      "sales",
      "salesman",
      "field_officer",
      "collection_officer",
      "delivery_rider",
      "supervisor",
    ],
  );
  for (const role of builtIn) {
    assert.equal(role.name, role.id);
  }

  // The custom roles, after the built-in ones, label = display name.
  const custom = roles.filter((role) => !role.isBuiltIn);
  assert.equal(custom.length, 2);
  assert.equal(custom[0].id, "6d428742236b41fb82d2d579688f0d5_cashier");
  assert.equal(custom[0].name, "Cashier");
  assert.deepEqual(custom[0].permissions, ["sales_view", "sales_create", "import_export"]);
  assert.equal(custom[1].id, "6d428742236b41fb82d2d579688f0d5_stocker");
  assert.equal(custom[1].name, "Stocker");

  // No custom roles: the list is exactly the built-in 11.
  assert.equal(buildAssignableRoles([]).length, 11);

  // ─── 2. Assignable id check ────────────────────────────────────────
  assert.equal(isAssignableRoleId("salesman", roles), true);
  assert.equal(isAssignableRoleId("owner", roles), true);
  assert.equal(isAssignableRoleId("staff", roles), true);
  assert.equal(
    isAssignableRoleId("6d428742236b41fb82d2d579688f0d5_cashier", roles),
    true,
  );
  assert.equal(
    isAssignableRoleId("6d428742236b41fb82d2d579688f0d5_stocker", roles),
    true,
  );
  // Unknown / dangling ids are not assignable (a deleted custom role,
  // a typo, or a role id from another organization).
  assert.equal(isAssignableRoleId("not_a_role", roles), false);
  assert.equal(isAssignableRoleId("cashier", roles), false);
  assert.equal(
    isAssignableRoleId("otherorg123_cashier", roles),
    false,
  );
  assert.equal(isAssignableRoleId("", roles), false);

  // ─── 3. Effective permissions ──────────────────────────────────────
  const customInput = CUSTOM_ROLES.map((role) => ({
    ...role,
    permissions: [...role.permissions],
  }));
  // Custom role with the permission grants it.
  assert.equal(
    hasAssignableRolePermission(
      "6d428742236b41fb82d2d579688f0d5_cashier",
      "import_export",
      customInput,
    ),
    true,
  );
  assert.equal(
    hasAssignableRolePermission(
      "6d428742236b41fb82d2d579688f0d5_cashier",
      "sales_create",
      customInput,
    ),
    true,
  );
  // Custom role without the permission does not grant it.
  assert.equal(
    hasAssignableRolePermission(
      "6d428742236b41fb82d2d579688f0d5_cashier",
      "inventory_manage",
      customInput,
    ),
    false,
  );
  assert.equal(
    hasAssignableRolePermission(
      "6d428742236b41fb82d2d579688f0d5_stocker",
      "import_export",
      customInput,
    ),
    false,
  );
  assert.equal(
    hasAssignableRolePermission(
      "6d428742236b41fb82d2d579688f0d5_stocker",
      "inventory_view",
      customInput,
    ),
    true,
  );
  // A dangling role id grants nothing.
  assert.equal(
    hasAssignableRolePermission("not_a_role", "sales_view", customInput),
    false,
  );
  assert.equal(
    hasAssignableRolePermission("cashier", "sales_view", customInput),
    false,
  );
  assert.equal(
    hasAssignableRolePermission(null, "sales_view", customInput),
    false,
  );
  assert.equal(
    hasAssignableRolePermission(undefined, "sales_view", customInput),
    false,
  );
  // Built-in roles resolve exactly as before.
  assert.equal(
    hasAssignableRolePermission("manager", "sales_manage", customInput),
    true,
  );
  assert.equal(
    hasAssignableRolePermission("salesman", "sales_manage", customInput),
    false,
  );
  assert.equal(
    hasAssignableRolePermission("owner", "administration", customInput),
    true,
  );

  console.log("test-custom-role-assignment: all assertions passed");
}

main();
