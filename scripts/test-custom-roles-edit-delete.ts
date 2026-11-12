import assert from "node:assert/strict";
import {
  CUSTOM_ROLE_PERMISSIONS,
  buildRoleDeleteBlockedMessage,
  filterAllowedPermissions,
  isDuplicateCustomRoleName,
  validateCustomRoleEditName,
} from "../src/lib/identity/custom-role-edit";

// Custom roles edit/delete slice.
//
// Rules under test:
// 1. Edit name validation mirrors the create form: required, at most 50
//    characters, never a built-in role name.
// 2. A rename is a duplicate only when ANOTHER custom role in the same
//    organization already carries the name (case-insensitive, ignoring
//    surrounding whitespace); renaming a role to its own current name is
//    not a duplicate. (A rename never changes the role id, so the
//    duplicate can never trip the primary key — the check is explicit.)
// 3. Only the 23 permissions the API accepts survive the filter —
//    including field_sales, draft_approval and import_export, which the
//    roles UI used to never offer.
// 4. The delete-block message names the role and the exact number of
//    staff members still holding it.

function main() {
  // ─── 1. Name validation ────────────────────────────────────────────────
  assert.equal(validateCustomRoleEditName(""), "Role name is required.");
  assert.equal(validateCustomRoleEditName("   "), "Role name is required.");
  assert.equal(
    validateCustomRoleEditName("x".repeat(51)),
    "Role name must be 50 characters or fewer.",
  );
  assert.equal(validateCustomRoleEditName("x".repeat(50)), null);
  assert.equal(
    validateCustomRoleEditName("Owner"),
    "A built-in role with this name already exists.",
  );
  assert.equal(
    validateCustomRoleEditName("MANAGER"),
    "A built-in role with this name already exists.",
  );
  assert.equal(
    validateCustomRoleEditName("  supervisor  "),
    "A built-in role with this name already exists.",
  );
  assert.equal(validateCustomRoleEditName("Cashier"), null);
  assert.equal(validateCustomRoleEditName("  Cashier  "), null);

  // ─── 2. Duplicate names ────────────────────────────────────────────────
  const existing = [
    { id: "org1_cashier", name: "Cashier" },
    { id: "org1_stocker", name: "Stocker" },
  ];
  assert.equal(isDuplicateCustomRoleName("Cashier", existing), true);
  assert.equal(isDuplicateCustomRoleName("cashier", existing), true);
  assert.equal(isDuplicateCustomRoleName("  CASHIER  ", existing), true);
  assert.equal(isDuplicateCustomRoleName("Stocker", existing), true);
  assert.equal(isDuplicateCustomRoleName("Packer", existing), false);
  // Renaming a role to its own current name is not a duplicate.
  assert.equal(
    isDuplicateCustomRoleName("Cashier", existing, "org1_cashier"),
    false,
  );
  assert.equal(
    isDuplicateCustomRoleName("Stocker", existing, "org1_cashier"),
    true,
  );
  assert.equal(isDuplicateCustomRoleName("Cashier", []), false);

  // ─── 3. Permission filter ──────────────────────────────────────────────
  assert.equal(CUSTOM_ROLE_PERMISSIONS.length, 23);
  for (const permission of ["field_sales", "draft_approval", "import_export"]) {
    assert.ok(
      (CUSTOM_ROLE_PERMISSIONS as string[]).includes(permission),
      `${permission} must be assignable from the UI`,
    );
  }
  assert.deepEqual(
    filterAllowedPermissions(["sales_view", "not_a_permission", "field_sales"]),
    ["sales_view", "field_sales"],
  );
  assert.deepEqual(filterAllowedPermissions("sales_view"), []);
  assert.deepEqual(filterAllowedPermissions(undefined), []);
  assert.deepEqual(filterAllowedPermissions([]), []);

  // ─── 4. Delete-block message ───────────────────────────────────────────
  const blocked = buildRoleDeleteBlockedMessage("Cashier", 3);
  assert.match(blocked, /Cashier/);
  assert.match(blocked, /3 staff member\(s\)/);
  assert.match(blocked, /Reassign them to another role first/);
  const blockedOne = buildRoleDeleteBlockedMessage("Stocker", 1);
  assert.match(blockedOne, /1 staff member\(s\)/);

  console.log(
    "Custom roles edit/delete tests passed: name validation, duplicate-name rule, 23-permission filter, delete-block message.",
  );
}

main();
