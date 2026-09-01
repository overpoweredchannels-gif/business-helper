// TradeOS FSM — Staff self-onboarding.
//
// Employees sign in with a Profile ID (login_id) + Password. They never need an
// email. Internally TradeOS uses Supabase Auth with a generated hidden email
// address (never shown/entered by the employee). The employee is linked to the
// owner's organization and all access is governed by the owner's permissions.

export const INVITE_TTL_HOURS = 72;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Deterministic-ish Profile ID from a name, made unique per organization. */
export function buildBaseLoginId(fullName: string): string {
  const cleaned = fullName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (cleaned.length === 0) return "STAFF";
  const letters = cleaned.replace(/[^A-Z]/g, "");
  const initials = letters.length >= 2 ? letters.slice(0, 2) : (letters + "T").slice(0, 2);
  const digits = String(cleaned.length).padStart(2, "0");
  return `${initials}${digits}`;
}

/** Ensures a Profile ID is unique against existing login_ids for the org. */
export async function makeUniqueLoginId(
  baseBase: string,
  isTaken: (loginId: string) => Promise<boolean>,
): Promise<string> {
  const base = baseBase.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "STAF";
  let candidate = base;
  let attempts = 0;
  while (attempts < 50 && (await isTaken(candidate))) {
    attempts++;
    candidate = `${base}${attempts}`;
  }
  return candidate;
}

/** 8-character invite code (same alphabet as role invitations). */
export function generateInviteCode(): string {
  const randomValues = new Uint32Array(8);
  crypto.getRandomValues(randomValues);
  let code = "";
  for (const value of randomValues) {
    code += CODE_CHARS[value % CODE_CHARS.length];
  }
  return code;
}

/** Hidden Supabase email for an employee — never surfaced to the user. */
export function buildHiddenEmail(loginId: string, organizationId: string): string {
  const safe = loginId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const orgPart = organizationId.slice(0, 10).replace(/-/g, "");
  return `${safe}_${orgPart}@staff.tradeos.internal`;
}

export function buildInviteLink(origin: string, inviteCode: string): string {
  const base = `${origin}/invite`.replace(/\/+$/, "");
  return `${base}?code=${encodeURIComponent(inviteCode)}`;
}

export function buildWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}`;
}

export function buildWhatsAppInviteMessage(input: {
  organizationName: string;
  employeeName: string;
  designationLabel?: string | null;
  loginId: string;
  inviteLink: string;
}): string {
  const lines = [
    `Welcome to ${input.organizationName} (TradeOS)`,
    "",
    `Hello ${input.employeeName},`,
    input.designationLabel ? `You have been added as ${input.designationLabel}.` : "",
    "",
    `Profile ID: ${input.loginId}`,
    "",
    "Click the link below to activate your account and create your password:",
    "",
    input.inviteLink,
    "",
    "After activation, log in using:",
    `Profile ID: ${input.loginId}`,
    "Password: (the one you create)",
    "",
    "You do NOT need an email address.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export interface InviteConfig {
  origin: string;
  organizationName: string;
  designationLabels: Record<string, string>;
}

export function designationLabel(designation: string, labels: Record<string, string>): string {
  return labels[designation] ?? designation.replace(/_/g, " ");
}

export function validateStaffPassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters long.";
  if (password.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Za-z]/.test(password)) return "Password must contain at least one letter.";
  if (!/\d/.test(password)) return "Password must contain at least one number.";
  return null;
}
