import { createSupabaseService } from "@/lib/supabase/server";
import { randomBytes } from "crypto";
import { EmployeeRepository } from "../repositories/employee-repository";
import { RoleRepository } from "../repositories/role-repository";
import {
  buildBaseLoginId,
  makeUniqueLoginId,
  generateInviteCode,
  buildHiddenEmail,
  validateStaffPassword,
  INVITE_TTL_HOURS,
} from "../staff-invitation";
import { buildLegacyPermissionRow } from "../legacy";
import { logAuditEvent } from "../audit";
import type { ActorContext } from "../types";
import type { Employee } from "@/lib/tradeos/types";
import { getStaffProfileRole, isEmployeeDesignation } from "../staff-roles";
import {
  buildLockoutMessage,
  checkLoginAllowed,
  clearFailedLogins,
  normalizeLockoutIdentifier,
  recordFailedLogin,
  SupabaseLoginAttemptStore,
} from "../login-lockout";

export interface StaffInviteResult {
  ok: boolean;
  error?: string;
  employee?: Employee;
  inviteLink?: string;
  loginId?: string;
  code?: string;
  expiresAt?: string;
}

export interface StaffInviteInfo {
  ok: boolean;
  error?: string;
  employeeId?: string;
  fullName?: string;
  loginId?: string;
  designation?: string;
  organizationName?: string;
  phone?: string;
  status?: string;
}

export interface StaffAcceptResult {
  ok: boolean;
  error?: string;
  loginId?: string;
}

export interface StaffLoginResult {
  ok: boolean;
  error?: string;
  accessToken?: string;
  refreshToken?: string;
  // Set when the sign-in was refused because the identifier is locked
  // after 5 failed attempts (15-minute lock). The route maps this to 429.
  locked?: boolean;
  retryAfterSeconds?: number;
}

const HIDDEN_EMAIL_DOMAIN = "staff.tradeos.internal";

/**
 * Generic credential error (HYBRID Slice 2 oracle fix): identical for an
 * unknown Profile ID and a wrong password, so the response never reveals
 * whether the ID exists. The old split messages (one for an unknown ID,
 * another for a wrong password) leaked exactly that.
 */
export const STAFF_LOGIN_GENERIC_ERROR = "Profile ID ya password ghalat hai";

/**
 * Dummy hidden email for the password-check path when the Profile ID is
 * unknown. No such account exists, so signInWithPassword always fails —
 * but it costs the same GoTrue round-trip as a real password check, so the
 * unknown-ID response takes the same time as a wrong-password response.
 */
const UNKNOWN_PROFILE_DUMMY_EMAIL = `no-such-profile@${HIDDEN_EMAIL_DOMAIN}`;

export class StaffOnboardingService {
  private readonly employeeRepository: EmployeeRepository;

  constructor(private readonly createClient = createSupabaseService) {
    this.employeeRepository = new EmployeeRepository(createClient);
  }

  /** Owner generates a Profile ID + invite for an employee. No email needed. */
  async generateInvite(actor: ActorContext, employeeId: string): Promise<StaffInviteResult> {
    if (!actor.isOwner) {
      return { ok: false, error: "Only the store owner can invite staff." };
    }
    if (!actor.organizationId || !actor.profileId) {
      return { ok: false, error: "Organization context required." };
    }

    const employee = await this.employeeRepository.findForInvitation(employeeId, actor.organizationId);
    if (!employee || employee.organization_id !== actor.organizationId) {
      return { ok: false, error: "Employee not found in this organization." };
    }
    if (employee.invite_status === "accepted") {
      return { ok: false, error: "This employee has already accepted their invitation." };
    }

    const supabase = this.createClient();

    // If already invited (pending), return existing invite data instead of creating duplicates.
    if (
      (employee.invite_status === "pending" || employee.invite_status === "revoked") &&
      employee.profile_id && employee.login_id && employee.hidden_email && employee.invite_code
    ) {
      const isExpired = Boolean(employee.invite_expires_at && new Date(employee.invite_expires_at).getTime() <= Date.now());
      if (isExpired || employee.invite_status === "revoked") {
        const inviteCode = generateInviteCode();
        const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();
        const { data: refreshed, error: refreshError } = await supabase.from("employees").update({
          invite_code: inviteCode,
          invite_status: "pending",
          invite_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }).eq("id", employee.id).eq("organization_id", actor.organizationId)
          .eq("invite_status", employee.invite_status).eq("invite_code", employee.invite_code).select("*").single();
        if (refreshError) return { ok: false, error: `Failed to renew invitation: ${refreshError.message}` };
        return { ok: true, employee: refreshed as Employee, loginId: employee.login_id, code: inviteCode, expiresAt };
      }
      return {
        ok: true,
        employee: employee as Employee,
        loginId: employee.login_id,
        code: employee.invite_code,
        expiresAt: employee.invite_expires_at ?? undefined,
      };
    }

    // Helper: check if a hidden_email already exists in Supabase auth
    const isHiddenEmailTaken = async (email: string): Promise<boolean> => {
      try {
        const { data } = await supabase.auth.admin.listUsers();
        return data.users.some((u) => u.email?.toLowerCase() === email.toLowerCase());
      } catch {
        return false; // if list fails, assume not taken (will be caught at create)
      }
    };

    // The unique constraint that will reject this insert lives on `profiles.login_id`
    // (global, `profiles_login_id_uidx`) and may contain orphaned/other-org leftovers
    // not present in `employees`. Check BOTH tables so the generated id can't collide.
    const isLoginIdTaken = async (loginId: string): Promise<boolean> => {
      const employeeHit = await supabase
        .from("employees")
        .select("id")
        .eq("organization_id", actor.organizationId)
        .eq("login_id", loginId)
        .maybeSingle();
      if (employeeHit.data) return true;
      const profileHit = await supabase
        .from("profiles")
        .select("id")
        .eq("login_id", loginId)
        .maybeSingle();
      return Boolean(profileHit.data);
    };

    // Generate a login_id that is unique in BOTH employees table AND auth (via hidden_email)
    let loginId = await makeUniqueLoginId(buildBaseLoginId(employee.full_name ?? "STAFF"), isLoginIdTaken);
    let inviteCode = generateInviteCode();
    let hiddenEmail = buildHiddenEmail(loginId, actor.organizationId);
    let expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    // Ensure hidden_email is also unique in auth (handles leftovers from failed prior attempts)
    for (let attempt = 0; attempt < 5 && await isHiddenEmailTaken(hiddenEmail); attempt++) {
      loginId = await makeUniqueLoginId(`${loginId}${attempt + 1}`, isLoginIdTaken);
      inviteCode = generateInviteCode();
      hiddenEmail = buildHiddenEmail(loginId, actor.organizationId);
      expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    }

    const designation = employee.designation;
    const roleIsCustom = Boolean(designation && !isEmployeeDesignation(designation));
    if (roleIsCustom && !await new RoleRepository().find(actor.organizationId, designation)) {
      return { ok: false, error: "Choose a designation from this organization's roles before inviting this employee." };
    }
    const defaultRole = roleIsCustom ? designation : getStaffProfileRole(designation);
    const displayName = employee.full_name?.trim() ?? "Staff";

    // The owner wants visibility in Staff & Permissions immediately and
    // permissions applied BEFORE the invite link is handed out. Those lists are driven by
    // the profiles + staff_permissions tables, so we provision the hidden auth account,
    // profile row, and permission row now (account stays inactive until the employee
    // activates it). The staff member only ever sees their Profile ID + password.
    const tempPassword = `idp_${randomBytes(12).toString("base64url")}X1`;
    let userId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
          email: hiddenEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: displayName, staff_onboarding: true },
        });
        if (createError) {
          const msg = createError.message.toLowerCase();
          if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("duplicate")) {
            // Should not happen since we pre-checked, but handle as fallback
            loginId = await makeUniqueLoginId(`${loginId}${attempt + 1}`, isLoginIdTaken);
            hiddenEmail = buildHiddenEmail(loginId, actor.organizationId);
            continue;
          }
          return { ok: false, error: createError.message };
        }
        if (!createdUser.user) {
          return { ok: false, error: "Failed to prepare staff account." };
        }
        userId = createdUser.user.id;
        await supabase.auth.admin.updateUserById(userId, {
          app_metadata: {
            ...(createdUser.user.app_metadata ?? {}),
            organization_id: actor.organizationId,
          },
        });
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("duplicate")) {
          loginId = await makeUniqueLoginId(`${loginId}${attempt + 1}`, isLoginIdTaken);
          hiddenEmail = buildHiddenEmail(loginId, actor.organizationId);
          continue;
        }
        return { ok: false, error: err instanceof Error ? err.message : "Failed to prepare staff account." };
      }
    }

    if (!userId) {
      return { ok: false, error: "Failed to prepare a unique staff account after multiple attempts." };
    }

    const profilePayload = {
      id: userId,
      organization_id: actor.organizationId,
      auth_user_id: userId,
      email: hiddenEmail,
      login_id: loginId,
      phone: employee.phone,
      full_name: displayName,
      display_name: displayName,
      role: defaultRole,
      is_active: false, // remains inactive until activated via invite link
    };
    const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);
      return { ok: false, error: `Profile creation failed: ${profileError.message}` };
    }

    const permissionRow = buildLegacyPermissionRow(actor.organizationId, userId, defaultRole);
    const { error: permissionError } = await supabase
      .from("staff_permissions")
      .upsert(permissionRow, { onConflict: "organization_id,profile_id" });
    if (permissionError) {
      await supabase.from("profiles").delete().eq("id", userId).eq("organization_id", actor.organizationId);
      await supabase.auth.admin.deleteUser(userId);
      return { ok: false, error: `Permission assignment failed: ${permissionError.message}` };
    }

    const { data: updated, error } = await supabase
      .from("employees")
      .update({
        profile_id: userId,
        login_id: loginId,
        hidden_email: hiddenEmail,
        invite_code: inviteCode,
        invite_status: "pending",
        invite_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", employee.id)
      .select(
        "id, organization_id, profile_id, employee_id, full_name, phone, cnic, email, designation, department, joining_date, status, assigned_supervisor_id, assigned_territory_id, assigned_route_id, photo_url, emergency_contact, is_active, created_at, updated_at, login_id, hidden_email, invite_code, invite_status, invite_expires_at",
      )
      .single();

    if (error) {
      await supabase.from("staff_permissions").delete().eq("profile_id", userId).eq("organization_id", actor.organizationId);
      await supabase.from("profiles").delete().eq("id", userId).eq("organization_id", actor.organizationId);
      await supabase.auth.admin.deleteUser(userId);
      return { ok: false, error: `Failed to create invitation: ${error.message}` };
    }

    await logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "staff_invite_created",
      entityType: "employee",
      entityId: employee.id,
      description: `Generated Profile ID ${loginId} for ${employee.full_name}.`,
      success: true,
    });

    return {
      ok: true,
      employee: updated as Employee,
      loginId,
      code: inviteCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeInvite(actor: ActorContext, employeeId: string): Promise<{ ok: boolean; error?: string }> {
    if (!actor.isOwner || !actor.organizationId) {
      return { ok: false, error: "Only the store owner can revoke invitations." };
    }
    const { data, error } = await this.createClient().from("employees")
      .update({ invite_status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", employeeId)
      .eq("organization_id", actor.organizationId)
      .eq("invite_status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "No pending invitation could be revoked for this employee." };
    return { ok: true };
  }

  /** Public lookup for the accept page (no auth). */
  async getInviteInfo(code: string): Promise<StaffInviteInfo> {
    const normalized = code.trim().toUpperCase();
    const supabase = this.createClient();
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id, full_name, login_id, designation, phone, invite_status, invite_expires_at, organization_id",
      )
      .eq("invite_code", normalized)
      .maybeSingle();

    if (error || !data) {
      return { ok: false, error: "Invitation not found." };
    }
    if (data.invite_status === "accepted") {
      return { ok: false, error: "This invitation has already been used." };
    }
    if (data.invite_status === "revoked") {
      return { ok: false, error: "This invitation has been revoked." };
    }
    if (
      data.invite_status === "expired" ||
      (data.invite_expires_at && new Date(data.invite_expires_at).getTime() < Date.now())
    ) {
      return { ok: false, error: "This invitation has expired. Ask your manager for a new one." };
    }
    if (data.invite_status !== "pending") return { ok: false, error: "Invitation not found." };

    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", data.organization_id)
      .maybeSingle();

    return {
      ok: true,
      employeeId: String(data.id),
      fullName: data.full_name ?? "",
      loginId: data.login_id ?? "",
      designation: data.designation ?? null,
      organizationName: org?.name ?? "",
      phone: data.phone ?? null,
      status: data.invite_status ?? "pending",
    };
  }

  /** Employee sets their password to activate the pre-provisioned hidden-email account. */
  async acceptInvite(code: string, password: string): Promise<StaffAcceptResult> {
    const passwordError = validateStaffPassword(password);
    if (passwordError) {
      return { ok: false, error: passwordError };
    }

    const info = await this.getInviteInfo(code);
    if (!info.ok || info.error) {
      return { ok: false, error: info.error ?? "Invitation could not be used." };
    }

    const normalized = code.trim().toUpperCase();
    const supabase = this.createClient();

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, organization_id, full_name, login_id, hidden_email, designation, phone, email, profile_id")
      .eq("invite_code", normalized)
      .single();
    if (employeeError || !employee) {
      return { ok: false, error: "Invitation could not be loaded." };
    }

    const userId = employee.profile_id;
    if (!userId) {
      return { ok: false, error: "Staff account is not provisioned. Ask your manager to re-issue the invite." };
    }

    const hiddenEmail =
      employee.hidden_email ??
      buildHiddenEmail(employee.login_id ?? "staff", employee.organization_id);

    // Claim this exact pending invitation before setting a usable
    // password. Revocation and acceptance cannot both claim the row.
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase.from("employees")
      .update({ invite_status: "accepted", updated_at: claimedAt })
      .eq("id", employee.id).eq("organization_id", employee.organization_id)
      .eq("invite_code", normalized).eq("invite_status", "pending")
      .select("id").maybeSingle();
    if (claimError) return { ok: false, error: "Invitation could not be accepted." };
    if (!claimed) {
      const latest = await this.getInviteInfo(normalized);
      return { ok: false, error: latest.error ?? "Invitation could not be accepted." };
    }

    try {
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password });
      if (updateError) throw new Error(`Password setup failed: ${updateError.message}`);

      const { data: profile, error: profileError } = await supabase.from("profiles")
        .update({ is_active: true }).eq("id", userId).eq("organization_id", employee.organization_id)
        .select("id").maybeSingle();
      if (profileError || !profile) throw new Error("Profile activation failed. Try again.");
    } catch (err) {
      const { error: releaseError } = await supabase.from("employees")
        .update({ invite_status: "pending", updated_at: new Date().toISOString() })
        .eq("id", employee.id).eq("organization_id", employee.organization_id)
        .eq("invite_code", normalized).eq("invite_status", "accepted").eq("updated_at", claimedAt);
      if (releaseError) {
        console.error("Could not release the invitation claim after activation failed:", releaseError);
        return { ok: false, error: "Invitation activation failed. Contact your manager." };
      }
      const message = err instanceof Error ? err.message : "Invitation activation failed.";
      return { ok: false, error: /used before/i.test(message) ? "Choose a different password and try again." : message };
    }

    await logAuditEvent({
      organizationId: employee.organization_id,
      actorProfileId: userId,
      actorEmail: hiddenEmail,
      action: "staff_invitation_accepted",
      entityType: "employee",
      entityId: employee.id,
      description: `${employee.full_name} activated their Profile ID ${employee.login_id}.`,
      success: true,
    });

    return { ok: true, loginId: employee.login_id ?? undefined };
  }

  /** Profile ID + Password login → returns Supabase session tokens for setSession. */
  async staffLogin(loginId: string, password: string): Promise<StaffLoginResult> {
    const normalized = loginId.trim().toUpperCase();
    if (!normalized || !password) {
      return { ok: false, error: "Profile ID and password are required." };
    }

    // The injected client factory (default: createSupabaseService) — the
    // slice test injects a mock client here; runtime behaviour is unchanged.
    const supabase = this.createClient();
    const lockoutStore = new SupabaseLoginAttemptStore(supabase);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, is_active, organization_id")
      .eq("login_id", normalized)
      .maybeSingle();

    // Brute-force lockout (phase 23): the key is the resolved staff email
    // when the Profile ID maps to an account, otherwise the entered
    // Profile ID itself — so guessing non-existent Profile IDs is throttled
    // too. The lock is checked BEFORE the password is tested, so a locked
    // attempt never reaches signInWithPassword.
    const lockoutKey = profile?.email
      ? normalizeLockoutIdentifier(profile.email)
      : normalized.toLowerCase();
    const allowed = await checkLoginAllowed(lockoutStore, lockoutKey);
    if (!allowed.allowed) {
      const retryAfterSeconds = allowed.retryAfterSeconds ?? 0;
      return {
        ok: false,
        error: buildLockoutMessage(retryAfterSeconds),
        locked: true,
        retryAfterSeconds,
      };
    }

    if (profileError || !profile) {
      // Unknown Profile ID: record the attempt under the entered ID so
      // enumeration guessing is throttled per ID. The message stays the
      // same generic one — it never reveals whether the lock engaged.
      await recordFailedLogin(lockoutStore, lockoutKey, null);
      // Oracle fix (Slice 2): run the same password-check path as a real
      // account — a dummy sign-in that always fails — so the unknown-ID
      // response takes the same time as a wrong-password response. The
      // result is discarded; the dummy check must never break the flow.
      try {
        await supabase.auth.signInWithPassword({
          email: UNKNOWN_PROFILE_DUMMY_EMAIL,
          password,
        });
      } catch {
        // ignore — the dummy check is timing-only
      }
      return { ok: false, error: STAFF_LOGIN_GENERIC_ERROR };
    }
    if (profile.is_active === false) {
      // Determine whether the account is pending activation (is_active false until
      // the employee opens their invite link) versus actually deactivated (active no
      // longer). Look up the linked employee row — for the SERVER LOG only.
      // The client always gets the generic error (Slice 2 oracle discipline):
      // the response never reveals whether the account is pending or deactivated.
      const { data: emp } = await supabase
        .from("employees")
        .select("invite_status")
        .eq("profile_id", profile.id)
        .maybeSingle();
      const pendingActivation = emp?.invite_status === "pending" || emp?.invite_status === "none";
      console.warn("[staffLogin] sign-in refused for an inactive profile", {
        loginId: normalized,
        profileId: profile.id,
        pendingActivation,
      });
      return { ok: false, error: STAFF_LOGIN_GENERIC_ERROR };
    }
    if (!profile.email) {
      // Same oracle discipline: an account without an email is not ready
      // to sign in, but the client only ever sees the generic error.
      console.warn("[staffLogin] sign-in refused for a profile without an email", {
        loginId: normalized,
        profileId: profile.id,
      });
      return { ok: false, error: STAFF_LOGIN_GENERIC_ERROR };
    }

    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (signInError || !session.session) {
      // Wrong password: record the failure. The attempt that trips the
      // lock still returns the generic error; the lock message appears on
      // the NEXT attempt (via the check above). Every sign-in failure —
      // wrong password or any other GoTrue error — returns the same generic
      // message, so the response never reveals whether the ID exists.
      await recordFailedLogin(
        lockoutStore,
        lockoutKey,
        profile.organization_id ?? null,
      );
      return { ok: false, error: STAFF_LOGIN_GENERIC_ERROR };
    }

    // Successful sign-in clears the failed-attempt count for this email.
    await clearFailedLogins(lockoutStore, lockoutKey);

    return {
      ok: true,
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
    };
  }
}

export { HIDDEN_EMAIL_DOMAIN };
