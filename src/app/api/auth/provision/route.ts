import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService, createSupabaseUserClient } from "@/lib/supabase/server";
import { buildLegacyPermissionRow } from "@/lib/identity/legacy";
import { normalizeRole } from "@/lib/identity/permissions";
import { applyCors, corsHeadersFor, desktopPreflightResponse } from "@/lib/desktop/cors";
import type { UserIdentity } from "@supabase/supabase-js";

export const runtime = "nodejs";

const getSupabaseService = () => {
  return createSupabaseService();
};

// The access token comes ONLY from the Authorization Bearer header
// (hardening rule 1: org/user come from the verified token, never from the
// request body). A token in the body is not accepted.
const getAccessToken = (request: NextRequest) => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return null;
};

const makeErrorResponse = (message: string, status: number, code?: string) =>
  NextResponse.json({ ok: false, error: message, code }, { status });

const buildOwnerPermissionPayload = (organizationId: string, userId: string) => ({
  organization_id: organizationId,
  profile_id: userId,
  can_manage_products: true,
  can_manage_customers: true,
  can_manage_suppliers: true,
  can_create_purchases: true,
  can_create_sales: true,
  can_manage_payments: true,
  can_manage_expenses: true,
  can_view_profit: true,
  can_view_reports: true,
  can_manage_tasks: true,
  can_manage_settings: true,
});

// Ensures the authenticated user's access token carries the organization_id
// custom claim that current_org_id() reads for RLS. GoTrue stores admin-set
// claims in app_metadata (embedded in every new/refreshed token). Best-effort:
// a claim-write failure must never block login/provisioning.
const ensureOrgClaim = async (
  supabaseService: ReturnType<typeof getSupabaseService>,
  user: { id: string; app_metadata?: Record<string, unknown> | null },
  organizationId: string
) => {
  try {
    const currentClaim = user.app_metadata?.organization_id;
    if (String(currentClaim ?? "") !== organizationId) {
      const { error } = await supabaseService.auth.admin.updateUserById(user.id, {
        app_metadata: { ...(user.app_metadata ?? {}), organization_id: organizationId },
      });
      if (error) {
        console.warn(`[PROVISION] failed to set organization_id claim for ${user.id}: ${error.message}`);
        return false;
      }
      console.log(`[PROVISION] organization_id claim set for ${user.id} -> ${organizationId}`);
    }
    const { data: verifiedUser, error: verifyError } = await supabaseService.auth.admin.getUserById(
      user.id
    );
    if (verifyError) {
      console.warn(`[PROVISION] could not verify claim on auth.users for ${user.id}: ${verifyError.message}`);
      return false;
    }
    const verifiedClaim = verifiedUser.user?.app_metadata?.organization_id;
    console.log(
      `[PROVISION] verified auth.users app_metadata.organization_id for ${user.id}: ${
        verifiedClaim ?? "(missing)"
      }`
    );
    return String(verifiedClaim ?? "") === organizationId;
  } catch (claimErr) {
    console.warn("[PROVISION] unexpected error while setting organization_id claim:", claimErr);
    return false;
  }
};

// Preflight for desktop cross-origin calls (a POST with Authorization +
// Content-Type triggers one). The browser must be able to read every
// response — including 401s — so POST applies the same headers via applyCors.
export async function OPTIONS(request: NextRequest) {
  return desktopPreflightResponse(request, "POST");
}

export async function POST(request: NextRequest) {
  return applyCors(await runProvision(request), corsHeadersFor(request));
}

async function runProvision(request: NextRequest) {
  const logTag = `[PROVISION ${Date.now()}]`;
  console.log(`${logTag} ===== PROVISION REQUEST RECEIVED =====`);

  // ── 1. Access token extraction (Bearer header only) ──
  const hasAuthHeader = request.headers.has("authorization") || request.headers.has("Authorization");
  console.log(`${logTag} CHECKPOINT 1: Authorization header present? ${hasAuthHeader}`);
  const accessToken = getAccessToken(request);
  console.log(`${logTag} CHECKPOINT 1b: accessToken extracted? ${Boolean(accessToken)}, length=${accessToken?.length ?? 0}`);
  if (!accessToken) {
    console.log(`${logTag} FAIL: accessToken null/undefined, returning 401`);
    return makeErrorResponse("Missing access token for authenticated provisioning.", 401, "missing_token");
  }

  // ── 1b. Optional body params (for onboarding) ──
  // Only the display name of a new organization is read from the body.
  // Identity (user id, organization_id) always comes from the verified
  // token below, never from the body (hardening rule 1).
  let requestBodyOrgName: string | null = null;
  try {
    const body = await request.clone().json();
    if (body?.organization_name && typeof body.organization_name === "string") {
      requestBodyOrgName = body.organization_name.trim();
    }
  } catch {
    // body not JSON or no org name — fine
  }

  // ── 2. Verify the Bearer token with the anon (user) client — BEFORE any
  // service client is created. This is the same verification resolveActor
  // performs (createSupabaseUserClient + auth.getUser), and it needs only
  // the public env vars, so a Bearer-less or fake-Bearer call answers 401
  // even on a server with no SUPABASE_SERVICE_ROLE_KEY (desktop smoke
  // probe, Slice 1). The service client is created only after the token
  // is proven valid, in step 3.
  let user;
  try {
    const userClient = createSupabaseUserClient(accessToken);
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    console.log(`${logTag} CHECKPOINT 2: getUser() completed. userData.user? ${Boolean(userData?.user)}, userError? ${userError?.message ?? "null"}`);
    if (userError || !userData?.user) {
      console.log(`${logTag} FAIL: getUser failed. userError=${userError?.message ?? "null"}, user?.id=${userData?.user?.id ?? "null"}`);
      if (userError) {
        console.error("Provisioning auth verification failed:", userError.message);
      }
      return makeErrorResponse(
        "Unable to verify authenticated user.",
        401,
        "auth_invalid_token"
      );
    }
    user = userData.user;
    console.log(`${logTag} CHECKPOINT 2b: user id = ${user.id}, email = ${user.email ?? "N/A"}`);
  } catch (verifyErr) {
    console.log(`${logTag} CRASH: Bearer verification THREW:`, verifyErr);
    return NextResponse.json(
      { ok: false, error: `Bearer verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}` },
      { status: 500 }
    );
  }

  // ── 3. Supabase service client (admin work below needs it) ──
  let supabaseService;
  try {
    supabaseService = getSupabaseService();
    console.log(`${logTag} CHECKPOINT 3: supabaseService created OK`);
  } catch (svcErr) {
    console.log(`${logTag} CRASH: getSupabaseService() threw:`, svcErr);
    return NextResponse.json(
      { ok: false, error: `Service client creation failed: ${svcErr instanceof Error ? svcErr.message : svcErr}` },
      { status: 500 }
    );
  }

  // ── 4. Email verification check ──
  const emailConfirmed = Boolean(
    user.email_confirmed_at ||
      user.confirmed_at ||
      user.identities?.some(
        (identity: UserIdentity) => Boolean(identity?.identity_data?.email_verified)
      )
  );
  console.log(`${logTag} CHECKPOINT 4: emailConfirmed=${emailConfirmed}`);
  console.log(`${logTag} CHECKPOINT 4b: email_confirmed_at=${user.email_confirmed_at ?? "null"}, confirmed_at=${user.confirmed_at ?? "null"}, identities=${JSON.stringify(user.identities?.map(i => ({ id: i.id, email_verified: i?.identity_data?.email_verified })) ?? [])}`);

  if (!emailConfirmed) {
    console.log(`${logTag} FAIL: email not confirmed, returning 403`);
    return makeErrorResponse("Please verify your email before using the workspace.", 403, "email_not_verified");
  }

  const userEmail = user.email ?? null;
  const userMetadata = typeof user.user_metadata === "object" && user.user_metadata !== null ? user.user_metadata : {};

  const rawFullName = typeof userMetadata.full_name === "string" ? userMetadata.full_name.trim() : "";
  const fullName = rawFullName || userEmail || "Owner";

  const rawOrgName = typeof userMetadata.organization_name === "string" ? userMetadata.organization_name.trim() : "";
  const orgName = rawOrgName || (userEmail ? `${userEmail.split("@")[0]}'s Business` : "New Organization");

  // ── 4b. Provision helpers: caller-profile lookup (shared by the
  // first check in step 5 and the race recovery in step 7) ──
  // Two provision POSTs for one fresh user can both pass the step-5
  // lookup, both insert an org, and then the loser's profile insert
  // fails on the profiles PK / auth_user_id unique index (23505),
  // leaving an orphaned org (proven by the idempotency test's
  // concurrent case, CI run 44791189953). The PostgREST calls in this
  // route run in separate auto-commit transactions, so no lock can be
  // held across them from here — the fix is recovery, not prevention:
  // on a failed profile insert the call deletes the org it just
  // created (only when no profile references it), re-reads the
  // caller's profile, and — when the winner's profile is there —
  // returns 200 with the winner's org instead of a 500. Final state
  // is exactly one org and zero orphans.
  type CallerProfileRow = {
    id: string;
    organization_id: string | null;
    auth_user_id: string | null;
    role: string | null;
    role_name: string | null;
  };

  const lookupCallerProfile = async () => {
    const result = await supabaseService
      .from("profiles")
      .select("id, organization_id, auth_user_id, role, role_name")
      .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
      .maybeSingle();
    return result;
  };

  // ── 5. Profile lookup ──
  let existingProfile, profileCheckError;
  try {
    const result = await lookupCallerProfile();
    existingProfile = result.data;
    profileCheckError = result.error;
    console.log(`${logTag} CHECKPOINT 5: profile lookup OK. existingProfile? ${Boolean(existingProfile)}, auth_user_id=${existingProfile?.auth_user_id ?? "N/A"}`);
  } catch (lookupErr) {
    console.log(`${logTag} CRASH: profile lookup THREW:`, lookupErr);
    return NextResponse.json(
      { ok: false, error: `Profile lookup threw: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}` },
      { status: 500 }
    );
  }

  if (profileCheckError) {
    console.log(`${logTag} FAIL: profileCheckError=${profileCheckError.message}`);
    console.error("Provisioning profile lookup failed:", profileCheckError.message);
    return makeErrorResponse(
      "Failed to check existing workspace profile.",
      500,
      "profile_lookup_failed"
    );
  }

  // Reconciles an already-provisioned user (the step-5 existing path
  // and the step-7 race recovery share this): backfills auth_user_id,
  // renames the org when the owner asked, ensures owner permissions
  // exist, ensures the org claim, and returns alreadyProvisioned:true
  // with the winner's organization_id.
  const reconcileExistingProfile = async (existingProfile: CallerProfileRow) => {
    if (!existingProfile.organization_id) {
      console.log(`${logTag} FAIL: existing profile has no organization_id`);
      return makeErrorResponse("Workspace profile is missing its organization.", 500, "profile_missing_org");
    }
    console.log(`${logTag} CHECKPOINT 5a: existing profile found. Re-provisioning path.`);

    const updates: Record<string, unknown> = {};
    if (!existingProfile.auth_user_id) {
      updates.auth_user_id = user.id;
    }

    if (Object.keys(updates).length > 0) {
      console.log(`${logTag} CHECKPOINT 5b: updating profile auth_user_id`);
      await supabaseService
        .from("profiles")
        .update(updates)
        .eq("id", existingProfile.id)
        .eq("organization_id", existingProfile.organization_id);
    }

    const existingRole = normalizeRole(existingProfile.role ?? existingProfile.role_name);
    const isExistingOwner = existingRole === "owner";

    if (requestBodyOrgName && isExistingOwner) {
      console.log(`${logTag} CHECKPOINT 5b2: updating organization name to "${requestBodyOrgName}"`);
      await supabaseService
        .from("organizations")
        .update({ name: requestBodyOrgName })
        .eq("id", existingProfile.organization_id);
    }

    let existingPermissions, permissionCheckError;
    try {
      const permResult = await supabaseService
        .from("staff_permissions")
        .select("profile_id")
        .eq("organization_id", existingProfile.organization_id)
        .eq("profile_id", existingProfile.id)
        .maybeSingle();
      existingPermissions = permResult.data;
      permissionCheckError = permResult.error;
      console.log(`${logTag} CHECKPOINT 5c: permission lookup OK. existingPermissions? ${Boolean(existingPermissions)}`);
    } catch (permLookupErr) {
      console.log(`${logTag} CRASH: permission lookup THREW:`, permLookupErr);
      return NextResponse.json(
        { ok: false, error: `Permission lookup threw: ${permLookupErr instanceof Error ? permLookupErr.message : String(permLookupErr)}` },
        { status: 500 }
      );
    }

    if (permissionCheckError) {
      console.log(`${logTag} FAIL: permissionCheckError=${permissionCheckError.message}`);
      console.error("Provisioning permission check failed:", permissionCheckError.message);
      return makeErrorResponse(
        "Failed to verify workspace permissions.",
        500,
        "permissions_check_failed"
      );
    }

    if (!existingPermissions) {
      console.log(`${logTag} CHECKPOINT 5d: creating missing permissions`);
      const { error: permissionError } = await supabaseService
        .from("staff_permissions")
        .upsert(
          isExistingOwner
            ? buildOwnerPermissionPayload(existingProfile.organization_id, existingProfile.id)
            : buildLegacyPermissionRow(
                existingProfile.organization_id,
                existingProfile.id,
                existingRole ?? "viewer"
              ), {
          onConflict: "organization_id,profile_id",
        });

      if (permissionError) {
        console.log(`${logTag} FAIL: permissionError=${permissionError.message}`);
        console.error("Provisioning failed: unable to create missing owner permissions", permissionError.message);
        return makeErrorResponse(
          "Failed to assign owner permissions for the workspace.",
          500,
          "permissions_create_failed"
        );
      }
    }

    console.log(`${logTag} CHECKPOINT 5z: returning alreadyProvisioned=true`);
    await ensureOrgClaim(supabaseService, user, existingProfile.organization_id);
    return NextResponse.json({ ok: true, alreadyProvisioned: true, organization_id: existingProfile.organization_id });
  };

  if (existingProfile) {
    return reconcileExistingProfile(existingProfile);
  }

  // Deletes an organization row this call just created, but ONLY when
  // no profile references it (guarded read first). Used to remove the
  // loser's orphaned org after a failed profile insert. Best-effort:
  // returns true when the row is gone, false when the delete was
  // skipped or failed — the caller logs the outcome; a skipped/failed
  // delete never blocks the winner's 200 response.
  const deleteOrphanOrganization = async (organizationId: string): Promise<boolean> => {
    try {
      const { data: referencing } = await supabaseService
        .from("profiles")
        .select("id")
        .eq("organization_id", organizationId)
        .limit(1)
        .maybeSingle();
      if (referencing) {
        console.warn(`${logTag} ORPHAN CLEANUP SKIPPED: org ${organizationId} is referenced by a profile — not deleting`);
        return false;
      }
      const { error: deleteError } = await supabaseService
        .from("organizations")
        .delete()
        .eq("id", organizationId);
      if (deleteError) {
        console.error(`${logTag} ORPHAN CLEANUP FAILED: could not delete org ${organizationId}: ${deleteError.message}`);
        return false;
      }
      console.log(`${logTag} ORPHAN CLEANUP: deleted unreferenced org ${organizationId}`);
      return true;
    } catch (cleanupErr) {
      console.error(`${logTag} ORPHAN CLEANUP THREW for org ${organizationId}:`, cleanupErr);
      return false;
    }
  };

  // Recovery after a profile insert failed (step 7): the usual cause is
  // the 23505 unique-violation from a concurrent provision for the same
  // user. Deletes this call's orphaned org, then re-reads the caller's
  // profile (one retry after 250ms — the winner's row is committed by
  // the time its insert returns, but the retry covers any timing skew).
  // Returns the winner's alreadyProvisioned response when the profile
  // is found, or null when there is nothing to recover (the caller then
  // returns its original 500, with the org already cleaned up).
  const recoverAfterProfileInsertFailure = async (
    organizationId: string
  ): Promise<NextResponse | null> => {
    await deleteOrphanOrganization(organizationId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const { data: winnerProfile, error: winnerError } = await lookupCallerProfile();
      if (winnerError) {
        console.warn(`${logTag} RACE RECOVERY: profile re-lookup failed: ${winnerError.message}`);
        return null;
      }
      if (winnerProfile) {
        console.log(`${logTag} RACE RECOVERY: winner profile found (org ${winnerProfile.organization_id}) — returning alreadyProvisioned`);
        return reconcileExistingProfile(winnerProfile);
      }
    }
    console.log(`${logTag} RACE RECOVERY: no winner profile found after retry — keeping original failure`);
    return null;
  };

  // ── 6. Organization creation ──
  const defaultOrg = {
    name: orgName,
    phone: null,
    address: null,
    city: null,
    invoice_footer_note: null,
    default_payment_terms: "Due on receipt",
  };

  let orgData, orgError;
  try {
    const result = await supabaseService
      .from("organizations")
      .insert(defaultOrg)
      .select()
      .single();
    orgData = result.data;
    orgError = result.error;
    console.log(`${logTag} CHECKPOINT 6: org insert OK. orgData?.id=${orgData?.id ?? "N/A"}`);
  } catch (orgErr) {
    console.log(`${logTag} CRASH: organization insert THREW:`, orgErr);
    return NextResponse.json(
      { ok: false, error: `Organization insert threw: ${orgErr instanceof Error ? orgErr.message : String(orgErr)}` },
      { status: 500 }
    );
  }

  if (orgError || !orgData?.id) {
    console.log(`${logTag} FAIL: orgError=${orgError?.message ?? "null"}, orgData?.id=${orgData?.id ?? "null"}`);
    if (orgError) {
      console.error("Provisioning organization creation failed:", orgError.message);
    }
    return makeErrorResponse(
      "Failed to create organization for workspace provisioning.",
      500,
      "organization_create_failed"
    );
  }

  const organizationId = orgData.id;
  console.log(`${logTag} CHECKPOINT 6b: organization created with id=${organizationId}`);

  // ── 7. Profile creation ──
  const profilePayload = {
    id: user.id,
    organization_id: organizationId,
    auth_user_id: user.id,
    full_name: fullName,
    email: userEmail,
    display_name: fullName,
    role: "owner",
    role_name: "owner",
    is_active: true,
  };
  console.log(`${logTag} CHECKPOINT 7: inserting profile with id=${profilePayload.id}, org_id=${profilePayload.organization_id}`);

  let profileError;
  try {
    const result = await supabaseService.from("profiles").insert(profilePayload);
    profileError = result.error;
    console.log(`${logTag} CHECKPOINT 7b: profile insert OK. profileError=${profileError?.message ?? "null"}`);
  } catch (profileErr) {
    console.log(`${logTag} CRASH: profile insert THREW:`, profileErr);
    // The insert may have succeeded server-side while the response was
    // lost — re-read before failing, and clean up the org we created
    // when no profile exists for it.
    const recovered = await recoverAfterProfileInsertFailure(organizationId);
    if (recovered) {
      return recovered;
    }
    return NextResponse.json(
      { ok: false, error: `Profile insert threw: ${profileErr instanceof Error ? profileErr.message : String(profileErr)}` },
      { status: 500 }
    );
  }

  if (profileError) {
    console.log(`${logTag} FAIL: profileError=${profileError.message} code=${profileError.code ?? "?"}`);
    console.error("Provisioning owner profile creation failed:", profileError.message);
    // RACE RECOVERY (concurrent first-time provision): the loser's
    // profile insert fails on the unique index after it already
    // created its org. Delete that orphaned org and, when the winner's
    // profile is visible, return 200 with the winner's org instead of
    // a 500. When no winner exists this returns null and the original
    // 500 below stands (the org is already cleaned up).
    const recovered = await recoverAfterProfileInsertFailure(organizationId);
    if (recovered) {
      return recovered;
    }
    return makeErrorResponse(
      "Failed to create owner profile.",
      500,
      "profile_create_failed"
    );
  }

  // ── 8. Permissions creation ──
  console.log(`${logTag} CHECKPOINT 8: upserting permissions for org=${organizationId}, user=${user.id}`);
  let permissionError;
  try {
    const result = await supabaseService
      .from("staff_permissions")
      .upsert(buildOwnerPermissionPayload(organizationId, user.id), {
        onConflict: "organization_id,profile_id",
      });
    permissionError = result.error;
    console.log(`${logTag} CHECKPOINT 8b: permissions upsert OK. permissionError=${permissionError?.message ?? "null"}`);
  } catch (permErr) {
    console.log(`${logTag} CRASH: permissions upsert THREW:`, permErr);
    return NextResponse.json(
      { ok: false, error: `Permissions upsert threw: ${permErr instanceof Error ? permErr.message : String(permErr)}` },
      { status: 500 }
    );
  }

  if (permissionError) {
    console.log(`${logTag} FAIL: permissionError=${permissionError.message}`);
    console.error("Provisioning failed: unable to create owner permissions", permissionError.message);
    return makeErrorResponse(
      "Failed to assign owner permissions for the workspace.",
      500,
      "permissions_create_failed"
    );
  }

  // ── 9. Audit log creation ──
  const auditPayload = {
    organization_id: organizationId,
    actor_profile_id: user.id,
    actor_email: userEmail,
    action: "initial_provision",
    entity_type: "organization",
    entity_id: organizationId,
    entity_label: orgData.name,
    description: "Initial workspace provisioning for owner.",
    old_values: null,
    new_values: {
      organization: defaultOrg,
      profile: profilePayload,
      permissions: buildOwnerPermissionPayload(organizationId, user.id),
    },
  };
  console.log(`${logTag} CHECKPOINT 9: inserting audit log`);

  let auditError;
  try {
    const result = await supabaseService.from("audit_logs").insert(auditPayload);
    auditError = result.error;
    console.log(`${logTag} CHECKPOINT 9b: audit log insert OK. auditError=${auditError?.message ?? "null"}`);
  } catch (auditErr) {
    console.log(`${logTag} CRASH: audit log insert THREW:`, auditErr);
    return NextResponse.json(
      { ok: false, error: `Audit log insert threw: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}` },
      { status: 500 }
    );
  }

  if (auditError) {
    console.error("Provisioning audit log creation failed:", auditError.message);
  }

  // ── 10. Final return ──
  const needsOnboarding = !rawOrgName;
  await ensureOrgClaim(supabaseService, user, organizationId);
  console.log(`${logTag} CHECKPOINT 10: SUCCESS — returning alreadyProvisioned=false, org_id=${organizationId}, needsOnboarding=${needsOnboarding}`);
  console.log(`${logTag} ===== PROVISION COMPLETE =====`);
  return NextResponse.json({ ok: true, alreadyProvisioned: false, organization_id: organizationId, needsOnboarding });
}
