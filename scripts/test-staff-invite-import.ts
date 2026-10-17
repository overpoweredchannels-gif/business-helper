import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StaffOnboardingService } from "../src/lib/identity/services/staff-onboarding-service";
import { staffImportConfig, STAFF_IMPORT_UPDATE_BLOCKED } from "../src/lib/import-export/entities/staff";
import type { ActorContext } from "../src/lib/identity/types";
import type { ImportContext, ParsedRow } from "../src/lib/import-export/types";
import { runImport, buildPreviewResult } from "../src/lib/import-export/processor";

const org = "10000000-0000-0000-0000-000000000001";
const id = "20000000-0000-0000-0000-000000000001";
const actor = { organizationId: org, profileId: id, isOwner: true } as ActorContext;

async function inviteCase(status: string, expired = false, concurrent = false) {
  const employee: Record<string, unknown> = { id, organization_id: org, profile_id: id,
    full_name: "Local synthetic staff", designation: "salesman", login_id: "LOCAL01",
    hidden_email: "local01@staff.tradeos.internal", invite_code: "OLD_CODE", invite_status: status,
    invite_expires_at: new Date(Date.now() + (expired ? -60000 : 3600000)).toISOString() };
  let authCreates = 0, profileCreates = 0, renewals = 0;
  const client = {
    auth: { admin: { createUser: () => { authCreates++; throw new Error("Unexpected Auth creation"); } } },
    from(table: string) {
      let columns = "*";
      const filters: Record<string, string> = {};
      const query = {
        select(value: string) { columns = value; return query; },
        eq(key: string, value: string) { filters[key] = value; return query; },
        insert() { if (table === "profiles") profileCreates++; throw new Error("Unexpected insert"); },
        update(value: Record<string, unknown>) { assert.equal(table, "employees"); renewals++; Object.assign(employee, value); return query; },
        async maybeSingle() {
          assert.equal(filters.id, id); assert.equal(filters.organization_id, org);
          const projected = Object.fromEntries(columns.split(",").map(s => s.trim()).filter(Boolean).map(k => [k, employee[k]]));
          return { data: projected, error: null };
        },
        async single() { return { data: { ...employee }, error: null }; },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const service = new StaffOnboardingService(() => client);
  const results = await Promise.all(Array.from({ length: concurrent ? 2 : 1 }, () => service.generateInvite(actor, id)));
  assert.equal(authCreates, 0); assert.equal(profileCreates, 0);
  if (status === "accepted") {
    assert.equal(results[0].ok, false); assert.match(results[0].error!, /already accepted/); assert.equal(renewals, 0);
  } else {
    assert.ok(results.every(r => r.ok && r.loginId === "LOCAL01"));
    assert.equal(renewals, expired ? 1 : 0);
    assert.ok(results.every(r => expired ? r.code !== "OLD_CODE" : r.code === "OLD_CODE"));
  }
}

async function imports() {
  const stored: Record<string, unknown> = { id, organization_id: org, email: "local01@staff.tradeos.internal", role: "staff", display_name: "Before", is_active: true };
  const before = structuredClone(stored);
  const permissions = { granted_sections: ["sales"], can_create_sales: true };
  const beforePermissions = structuredClone(permissions);
  let lookupError: unknown = null, inserts = 0, updates = 0, permissionWrites = 0;
  const supabase = { from(table: string) {
    const filters: Record<string, string> = {};
    const query = {
      select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; },
      async maybeSingle() { assert.equal(table, "profiles"); return { data: lookupError ? null : filters.organization_id === org && filters.email === stored.email ? { id } : null, error: lookupError }; },
      insert() { inserts++; throw new Error("Unexpected profile INSERT"); },
      async upsert() { assert.equal(table, "staff_permissions"); permissionWrites++; return { error: { code: "PGRST204", message: "Missing can_manage_ai_assistant" } }; },
    }; return query;
  }};
  const ctx = { orgId: org, supabase, duplicateMode: "update", existingCache: new Map(), refCaches: new Map(),
    updateStaffProfile: async (profileId: string, values: Record<string, unknown>) => {
      assert.equal(profileId, id); updates++; Object.assign(stored, values); return stored;
    } } as unknown as ImportContext;
  const row: ParsedRow = { rowIndex: 2, raw: {}, values: { email: " LOCAL01@STAFF.TRADEOS.INTERNAL ", name: "After", role: "salesman", is_active: true }, errors: [], warnings: [], existingId: null, status: "new" };
  const existing = await staffImportConfig.findExisting!(row, ctx) as { id: string };
  assert.equal(existing.id, id);
  row.existingId = existing.id; row.status = "update";
  const previewRow = structuredClone(row);
  await staffImportConfig.reviewRows!([previewRow], ctx);
  const blockedPreview = buildPreviewResult([], [previewRow], "update");
  assert.equal(blockedPreview.stats.errorCount, 1);
  assert.ok(previewRow.errors.includes(STAFF_IMPORT_UPDATE_BLOCKED));
  // Bypass review deliberately: the execution guard must still prevent the
  // former profile-success/permission-PGRST204 partial-write failure.
  const result = await runImport(staffImportConfig, buildPreviewResult([], [row], "update"), ctx);
  assert.equal(result.updated, 0); assert.equal(result.failed, 1);
  assert.equal(result.failures[0].message, STAFF_IMPORT_UPDATE_BLOCKED);
  assert.equal(permissionWrites, 0); assert.equal(updates, 0); assert.equal(inserts, 0);
  assert.deepEqual(stored, before); assert.deepEqual(permissions, beforePermissions);
  assert.equal(staffImportConfig.postImportHook, undefined, "No post-hook can reintroduce partial permission writes");
  const skippedRow = structuredClone(row);
  await staffImportConfig.reviewRows!([skippedRow], { ...ctx, duplicateMode: "skip" });
  assert.equal(skippedRow.errors.length, 0);
  const skipped = await runImport(staffImportConfig, buildPreviewResult([], [skippedRow], "skip"), { ...ctx, duplicateMode: "skip" });
  assert.equal(skipped.skipped, 1); assert.equal(updates, 0); assert.equal(permissionWrites, 0);
  const unmatched = { ...row, values: { ...row.values, email: "contact@example.com" }, existingId: null, status: "new" as const };
  await assert.rejects(staffImportConfig.findExisting!(unmatched, ctx), /Employees → Invite/);
  await assert.rejects(staffImportConfig.findExisting!(row, { ...ctx, orgId: "other-org" }), /No staff profile matches/);
  const deniedCreate = await runImport(staffImportConfig, buildPreviewResult([], [unmatched], "update"), ctx);
  assert.equal(deniedCreate.failed, 1); assert.equal(inserts, 0);
  lookupError = { code: "PGRST116", message: "Multiple rows" };
  await assert.rejects(staffImportConfig.findExisting!(row, ctx), e => e === lookupError);
  lookupError = { code: "42501", message: "Lookup denied" };
  await assert.rejects(staffImportConfig.findExisting!(row, ctx), e => e === lookupError);
  assert.equal(inserts, 0); assert.equal(updates, 0); assert.equal(permissionWrites, 0);
}

async function main() {
  await inviteCase("pending"); await inviteCase("accepted"); await inviteCase("pending", true);
  await inviteCase("pending", false, true);
  await imports();
  console.log("PASS local invitation cases; staff matching and lookup errors; preview and bypass rejection preserve profile/permission state with zero writes; skip and unsupported INSERT guards. No remote access.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
