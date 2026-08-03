import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import type { UserIdentity } from "@supabase/supabase-js";

export const runtime = "nodejs";

const getSupabaseService = () => {
  return createSupabaseService();
};

const getAccessToken = async (request: NextRequest) => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  try {
    const body = await request.json();
    if (body?.access_token && typeof body.access_token === "string") {
      return body.access_token;
    }
  } catch {
    // ignore malformed JSON
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

export async function POST(request: NextRequest) {
  const logTag = `[PROVISION ${Date.now()}]`;
  console.log(`${logTag} ===== PROVISION REQUEST RECEIVED =====`);

  // ── 1. Access token extraction ──
  const hasAuthHeader = request.headers.has("authorization") || request.headers.has("Authorization");
  console.log(`${logTag} CHECKPOINT 1: Authorization header present? ${hasAuthHeader}`);
  const accessToken = await getAccessToken(request);
  console.log(`${logTag} CHECKPOINT 1b: accessToken extracted? ${Boolean(accessToken)}, length=${accessToken?.length ?? 0}`);
  if (!accessToken) {
    console.log(`${logTag} FAIL: accessToken null/undefined, returning 401`);
    return makeErrorResponse("Missing access token for authenticated provisioning.", 401, "missing_token");
  }

  // ── 1b. Optional body params (for onboarding) ──
  let requestBodyOrgName: string | null = null;
  try {
    const body = await request.clone().json();
    if (body?.organization_name && typeof body.organization_name === "string") {
      requestBodyOrgName = body.organization_name.trim();
    }
  } catch {
    // body not JSON or no org name — fine
  }

  // ── 2. Supabase service client ──
  let supabaseService;
  try {
    supabaseService = getSupabaseService();
    console.log(`${logTag} CHECKPOINT 2: supabaseService created OK`);
  } catch (svcErr) {
    console.log(`${logTag} CRASH: getSupabaseService() threw:`, svcErr);
    return NextResponse.json(
      { ok: false, error: `Service client creation failed: ${svcErr instanceof Error ? svcErr.message : svcErr}` },
      { status: 500 }
    );
  }

  // ── 3. getUser(accessToken) ──
  let userData, userError;
  try {
    const result = await supabaseService.auth.getUser(accessToken);
    userData = result.data;
    userError = result.error;
    console.log(`${logTag} CHECKPOINT 3: getUser() completed. userData.user? ${Boolean(userData?.user)}, userError? ${userError?.message ?? "null"}`);
    console.log(`${logTag} CHECKPOINT 3b: user id = ${userData?.user?.id ?? "N/A"}, email = ${userData?.user?.email ?? "N/A"}`);
  } catch (getUserErr) {
    console.log(`${logTag} CRASH: supabaseService.auth.getUser(accessToken) THREW:`, getUserErr);
    console.log(`${logTag} CRASH details:`, JSON.stringify(getUserErr, Object.getOwnPropertyNames(getUserErr)));
    return NextResponse.json(
      { ok: false, error: `getUser threw: ${getUserErr instanceof Error ? getUserErr.message : String(getUserErr)}` },
      { status: 500 }
    );
  }

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

  const user = userData.user;

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

  // ── 5. Profile lookup ──
  let existingProfile, profileCheckError;
  try {
    const result = await supabaseService
      .from("profiles")
      .select("id, organization_id, auth_user_id")
      .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
      .maybeSingle();
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

  if (existingProfile) {
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

    if (requestBodyOrgName) {
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
        .upsert(buildOwnerPermissionPayload(existingProfile.organization_id, existingProfile.id), {
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
  }

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
    return NextResponse.json(
      { ok: false, error: `Profile insert threw: ${profileErr instanceof Error ? profileErr.message : String(profileErr)}` },
      { status: 500 }
    );
  }

  if (profileError) {
    console.log(`${logTag} FAIL: profileError=${profileError.message}`);
    console.error("Provisioning owner profile creation failed:", profileError.message);
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
