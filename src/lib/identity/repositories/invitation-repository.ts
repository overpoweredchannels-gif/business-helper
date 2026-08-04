import { createSupabaseService } from "@/lib/supabase/server";
import { Invitation, RoleType } from "../types";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITATION_TTL_HOURS = 72;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function mapRow(row: Record<string, unknown>): Invitation {
  return {
    code: String(row.code ?? ""),
    organizationId: String(row.organization_id ?? ""),
    email: String(row.email ?? ""),
    role: String(row.role ?? "viewer") as RoleType,
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    acceptedBy: row.accepted_by ? String(row.accepted_by) : null,
    employeeId: row.employee_id ? String(row.employee_id) : null,
    fullName: row.full_name ? String(row.full_name) : null,
    phone: row.phone ? String(row.phone) : null,
    designation: row.designation ? String(row.designation) : null,
  };
}

const INVITATION_COLUMNS =
  "code, organization_id, email, role, created_by, created_at, expires_at, accepted_at, accepted_by, employee_id, full_name, phone, designation";

export class InvitationRepository {
  async create(input: {
    organizationId: string;
    email: string;
    role: RoleType;
    createdBy: string;
    employeeId?: string | null;
    fullName?: string | null;
    phone?: string | null;
    designation?: string | null;
    ttlHours?: number;
  }): Promise<{ invitation?: Invitation; error?: string }> {
    const supabase = createSupabaseService();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (input.ttlHours ?? INVITATION_TTL_HOURS) * 60 * 60 * 1000,
    );

    let code = generateCode();
    let duplicate = true;
    for (let attempt = 0; attempt < 5 && duplicate; attempt++) {
      const { data } = await supabase
        .from("role_invitations")
        .select("code")
        .eq("code", code)
        .maybeSingle();
      duplicate = Boolean(data);
      if (duplicate) {
        code = generateCode();
      }
    }

    const { data, error } = await supabase
      .from("role_invitations")
      .insert({
        code,
        organization_id: input.organizationId,
        email: input.email,
        role: input.role,
        created_by: input.createdBy,
        employee_id: input.employeeId ?? null,
        full_name: input.fullName ?? null,
        phone: input.phone ?? null,
        designation: input.designation ?? null,
        expires_at: expiresAt.toISOString(),
        status: "pending",
      })
      .select(INVITATION_COLUMNS)
      .single();

    if (error) {
      return { error: error.message };
    }

    return { invitation: mapRow(data) };
  }

  async findByCode(code: string): Promise<Invitation | null> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_invitations")
      .select(INVITATION_COLUMNS)
      .eq("code", code)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapRow(data);
  }

  async accept(code: string, profileId: string): Promise<{ invitation?: Invitation; error?: string }> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_invitations")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: profileId,
        status: "accepted",
      })
      .eq("code", code)
      .select(INVITATION_COLUMNS)
      .single();

    if (error) {
      return { error: error.message };
    }

    return { invitation: mapRow(data) };
  }

  async revoke(code: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_invitations")
      .update({ status: "revoked" })
      .eq("code", code)
      .eq("status", "pending")
      .select("code")
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data) {
      return { success: false, error: "Active invitation not found." };
    }

    return { success: true };
  }

  async listForOrganization(organizationId: string): Promise<Invitation[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("role_invitations")
      .select(INVITATION_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      return [];
    }

    return (data ?? []).map(mapRow);
  }
}

export class InvitationService {
  constructor(private readonly repository = new InvitationRepository()) {}

  async createInvitation(input: {
    organizationId: string;
    email: string;
    role: RoleType;
    createdBy: string;
    employeeId?: string | null;
    fullName?: string | null;
    phone?: string | null;
    designation?: string | null;
    ttlHours?: number;
  }): Promise<{ invitation?: Invitation; error?: string }> {
    const email = input.email.trim().toLowerCase();
    const emailError = validateEmail(email);
    if (emailError) {
      return { error: emailError };
    }

    const existing = await this.repository.listForOrganization(input.organizationId);
    const active = existing.find(
      (i) =>
        i.email === email &&
        !i.acceptedAt &&
        new Date(i.expiresAt).getTime() > Date.now(),
    );
    if (active) {
      return { error: "An active invitation already exists for this email." };
    }

    return this.repository.create({ ...input, email });
  }

  async getByCode(code: string): Promise<{ invitation?: Invitation; error?: string }> {
    const normalized = code.trim().toUpperCase();
    const invitation = await this.repository.findByCode(normalized);
    if (!invitation) {
      return { error: "Invitation not found." };
    }
    if (invitation.acceptedAt) {
      return { error: "This invitation has already been used." };
    }
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      return { error: "This invitation has expired." };
    }
    return { invitation };
  }

  async acceptInvitation(code: string, profileId: string): Promise<{ invitation?: Invitation; error?: string }> {
    const result = await this.getByCode(code);
    if (result.error || !result.invitation) {
      return result;
    }
    return this.repository.accept(result.invitation.code, profileId);
  }

  async revokeInvitation(code: string): Promise<{ success: boolean; error?: string }> {
    return this.repository.revoke(code.trim().toUpperCase());
  }

  async listForOrganization(organizationId: string): Promise<Invitation[]> {
    return this.repository.listForOrganization(organizationId);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) {
    return "Email is required.";
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return "Please enter a valid email address.";
  }
  return null;
}
