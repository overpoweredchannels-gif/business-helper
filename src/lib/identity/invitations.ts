import { Invitation, RoleType } from "./types";

const INVITATION_STORAGE_KEY = "tradeos_invitations";
const INVITATION_TTL_HOURS = 72;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
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

export function validatePassword(password: string): string | null {
  if (!password || password.length === 0) {
    return "Password is required.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 72) {
    return "Password must be 72 characters or fewer.";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must contain at least one letter.";
  }
  if (!/\d/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null;
}

class InvitationManager {
  private invitations: Invitation[] = [];
  private storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null = null;

  setStorage(
    storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void },
  ): void {
    this.storage = storage;
    const raw = storage.getItem(INVITATION_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.invitations = parsed;
        }
      } catch {
        this.invitations = [];
      }
    }
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(INVITATION_STORAGE_KEY, JSON.stringify(this.invitations));
  }

  createInvitation(input: {
    organizationId: string;
    email: string;
    role: RoleType;
    createdBy: string;
    ttlHours?: number;
  }): { invitation?: Invitation; error?: string } {
    const emailError = validateEmail(input.email);
    if (emailError) {
      return { error: emailError };
    }
    const email = input.email.trim().toLowerCase();
    const now = Date.now();
    const existing = this.invitations.find(
      (i) =>
        i.email === email &&
        i.organizationId === input.organizationId &&
        !i.acceptedAt &&
        new Date(i.expiresAt).getTime() > now,
    );
    if (existing) {
      return { error: "An active invitation already exists for this email." };
    }
    const invitation: Invitation = {
      code: generateCode(),
      organizationId: input.organizationId,
      email,
      role: input.role,
      createdBy: input.createdBy,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(
        now + (input.ttlHours ?? INVITATION_TTL_HOURS) * 60 * 60 * 1000,
      ).toISOString(),
      acceptedAt: null,
      acceptedBy: null,
    };
    this.invitations.push(invitation);
    this.persist();
    return { invitation };
  }

  getByCode(code: string): { invitation?: Invitation; error?: string } {
    const normalized = code.trim().toUpperCase();
    const invitation = this.invitations.find((i) => i.code === normalized);
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

  getByEmail(email: string): Invitation[] {
    const normalized = email.trim().toLowerCase();
    return this.invitations
      .filter((i) => i.email === normalized)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  acceptInvitation(code: string, profileId: string): { invitation?: Invitation; error?: string } {
    const result = this.getByCode(code);
    if (result.error || !result.invitation) {
      return result;
    }
    result.invitation.acceptedAt = new Date().toISOString();
    result.invitation.acceptedBy = profileId;
    this.persist();
    return { invitation: result.invitation };
  }

  revokeInvitation(code: string): { success: boolean; error?: string } {
    const normalized = code.trim().toUpperCase();
    const index = this.invitations.findIndex((i) => i.code === normalized && !i.acceptedAt);
    if (index === -1) {
      return { success: false, error: "Active invitation not found." };
    }
    this.invitations.splice(index, 1);
    this.persist();
    return { success: true };
  }

  listForOrganization(organizationId: string): Invitation[] {
    return this.invitations
      .filter((i) => i.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  cleanupExpired(): number {
    const before = this.invitations.length;
    this.invitations = this.invitations.filter(
      (i) => i.acceptedAt || new Date(i.expiresAt).getTime() > Date.now(),
    );
    if (this.invitations.length !== before) {
      this.persist();
    }
    return before - this.invitations.length;
  }
}

export const invitationManager = new InvitationManager();

export function createInvitation(input: {
  organizationId: string;
  email: string;
  role: RoleType;
  createdBy: string;
  ttlHours?: number;
}): { invitation?: Invitation; error?: string } {
  return invitationManager.createInvitation(input);
}

export function getInvitationByCode(code: string): { invitation?: Invitation; error?: string } {
  return invitationManager.getByCode(code);
}

export function acceptInvitation(code: string, profileId: string): { invitation?: Invitation; error?: string } {
  return invitationManager.acceptInvitation(code, profileId);
}

export function revokeInvitation(code: string): { success: boolean; error?: string } {
  return invitationManager.revokeInvitation(code);
}

export function listInvitations(organizationId: string): Invitation[] {
  return invitationManager.listForOrganization(organizationId);
}

export function cleanupExpiredInvitations(): number {
  return invitationManager.cleanupExpired();
}
