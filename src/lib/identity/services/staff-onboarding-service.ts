import { createSupabaseService } from "@/lib/supabase/server";
import { EmployeeRepository } from "../repositories/employee-repository";
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
}

const HIDDEN_EMAIL_DOMAIN = "staff.tradeos.internal";

const DESIGNATION_ROLE: Record<string, string> = {
  salesman: "salesman",
  delivery_rider: "delivery_rider",
  field_officer: "field_officer",
  collection_officer: "collection_officer",
  supervisor: "supervisor",
  manager: "manager",
  owner: "owner",
};

export class StaffOnboardingService {
  private readonly employeeRepository = new EmployeeRepository();

  /** Owner generates a Profile ID + invite for an employee. No email needed. */
  async generateInvite(actor: ActorContext, employeeId: string): Promise<StaffInviteResult> {
    if (!actor.isOwner) {
      return { ok: false, error: "Only the store owner can invite staff." };
    }
    if (!actor.organizationId || !actor.profileId) {
      return { ok: false, error: "Organization context required." };
    }

    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee || employee.organization_id !== actor.organizationId) {
      return { ok: false, error: "Employee not found in this organization." };
    }
    if (employee.invite_status === "accepted") {
      return { ok: false, error: "This employee has already accepted their invitation." };
    }

    const supabase = createSupabaseService();
    const isLoginIdTaken = async (loginId: string): Promise<boolean> => {
      const { data } = await supabase
        .from("employees")
        .select("id")
        .eq("organization_id", actor.organizationId)
        .eq("login_id", loginId)
        .maybeSingle();
      return Boolean(data);
    };
    const loginId = await makeUniqueLoginId(buildBaseLoginId(employee.full_name), isLoginIdTaken);
    const inviteCode = generateInviteCode();
    const hiddenEmail = buildHiddenEmail(loginId, actor.organizationId);
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    const defaultRole = DESIGNATION_ROLE[employee.designation ?? "salesman"] ?? "salesman";

    // The role in env:owner wants visibility in Staff & Permissions immediately and
    // permissions applied BEFORE the invite link is handed out. Those lists are driven by
    // the profiles + staff_permissions tables, so we provision the hidden auth account,
    // profile row, and permission row now (account stays inactive until the employee
    // activates it). The staff member only ever sees their Profile ID + password.
    const tempPassword = `idp_${Math.random().toString(36).slice(2, 10)}X1`;
    let userId: string;
    try {
      const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
        email: hiddenEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: employee.full_name, staff_onboarding: true },
      });
      if (createError || !createdUser.user) {
        return { ok: false, error: createError?.message ?? "Failed to prepare staff account." };
      }
      userId = createdUser.user.id;
      await supabase.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...(createdUser.user.app_metadata ?? {}),
          organization_id: actor.organizationId,
        },
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to prepare staff account." };
    }

    const profilePayload = {
      id: userId,
      organization_id: actor.organizationId,
      auth_user_id: userId,
      email: hiddenEmail,
      login_id: loginId,
      phone: employee.phone,
      display_name: employee.full_name,
      role: defaultRole,
      is_active: false, // remains inactive until activated via invite link
    };
    const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
    if (profileError) {
      return { ok: false, error: `Profile creation failed: ${profileError.message}` };
    }

    const permissionRow = buildLegacyPermissionRow(actor.organizationId, userId, defaultRole);
    const { error: permissionError } = await supabase
      .from("staff_permissions")
      .upsert(permissionRow, { onConflict: "organization_id,profile_id" });
    if (permissionError) {
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
      return { ok: false, error: `Failed to create invitation: ${error.message}` };
    }

    logAuditEvent({
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

  /** Public lookup for the accept page (no auth). */
  async getInviteInfo(code: string): Promise<StaffInviteInfo> {
    const normalized = code.trim().toUpperCase();
    const supabase = createSupabaseService();
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
      data.invite_expires_at &&
      new Date(data.invite_expires_at).getTime() < Date.now()
    ) {
      return { ok: false, error: "This invitation has expired. Ask your manager for a new one." };
    }

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
    const supabase = createSupabaseService();

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

    try {
      // Set the employee's real password; the account was already created on invite.
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password });
      if (updateError) {
        if (updateError.message && updateError.message.toLowerCase().includes("used before")) {
          return { ok: false, error: "This account has already been activated. Please sign in." };
        }
        return { ok: false, error: `Password setup failed: ${updateError.message}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Password setup failed.";
      if (/used before|already been/i.test(message)) {
        return { ok: false, error: "This account has already been activated. Please sign in." };
      }
      return { ok: false, error: message };
    }

    // Activate the pre-provisioned profile.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ is_active: true })
      .eq("id", userId);
    if (profileError) {
      return { ok: false, error: `Profile activation failed: ${profileError.message}` };
    }

    const { error: acceptError } = await supabase
      .from("employees")
      .update({
        invite_status: "accepted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", employee.id);
    if (acceptError) {
      return { ok: false, error: `Invitation acceptance failed: ${acceptError.message}` };
    }

    logAuditEvent({
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

    const supabase = createSupabaseService();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, is_active")
      .eq("login_id", normalized)
      .maybeSingle();

    if (profileError || !profile) {
      return { ok: false, error: "No account found for this Profile ID." };
    }
    if (profile.is_active === false) {
      // Determine whether the account is pending activation (is_active false until
      // the employee opens their invite link) versus actually deactivated (active no
      // longer). Look up the linked employee row.
      const { data: emp } = await supabase
        .from("employees")
        .select("invite_status")
        .eq("profile_id", profile.id)
        .maybeSingle();
      const pendingActivation = emp?.invite_status === "pending" || emp?.invite_status === "none";
      return {
        ok: false,
        error: pendingActivation
          ? "This account hasn't been activated yet. Open your WhatsApp invite link to create your password."
          : "This account has been deactivated by your manager.",
      };
    }
    if (!profile.email) {
      return { ok: false, error: "This account is not ready yet. Open your invite link first." };
    }

    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (signInError || !session.session) {
      return {
        ok: false,
        error: signInError?.message === "Invalid login credentials"
          ? "Incorrect Profile ID or password."
          : signInError?.message ?? "Sign in failed.",
      };
    }

    return {
      ok: true,
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
    };
  }
}

export { HIDDEN_EMAIL_DOMAIN };
