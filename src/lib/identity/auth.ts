import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { RoleType, SessionInfo } from "./types";
import { validateEmail, validatePassword } from "./invitations";
import { sessionManager } from "./sessions";
import { logAuditEvent } from "./audit";
import { normalizeRole } from "./permissions";
import { roleExists } from "./permissions";

export interface StaffAccount {
  profileId: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordHashVersion?: "scrypt-v1";
  role: RoleType | null;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  mustChangePassword: boolean;
}

const ACCOUNTS_STORAGE_KEY = "tradeos_staff_accounts";
const RESET_TOKENS_STORAGE_KEY = "tradeos_reset_tokens";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MINUTES = 30;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function legacyHashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}::${password}`).digest("hex");
}

function hashesMatch(actualHex: string, expectedHex: string): boolean {
  try {
    const actual = Buffer.from(actualHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function verifyPassword(account: StaffAccount, password: string): boolean {
  const computed = account.passwordHashVersion === "scrypt-v1"
    ? hashPassword(password, account.passwordSalt)
    : legacyHashPassword(password, account.passwordSalt);
  return hashesMatch(computed, account.passwordHash);
}

function generateProfileId(): string {
  return `prof_${randomBytes(8).toString("hex")}`;
}

function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

class AuthManager {
  private accounts: StaffAccount[] = [];
  private resetTokens: Record<string, { profileId: string; expiresAt: string }> = {};
  private storage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
  } | null = null;

  setStorage(
    storage: {
      getItem: (k: string) => string | null;
      setItem: (k: string, v: string) => void;
    },
  ): void {
    this.storage = storage;
    const raw = storage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.accounts = parsed;
        }
      } catch {
        this.accounts = [];
      }
    }
    const rawTokens = storage.getItem(RESET_TOKENS_STORAGE_KEY);
    if (rawTokens) {
      try {
        this.resetTokens = JSON.parse(rawTokens);
      } catch {
        this.resetTokens = {};
      }
    }
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    this.storage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(this.accounts));
    this.storage.setItem(RESET_TOKENS_STORAGE_KEY, JSON.stringify(this.resetTokens));
  }

  registerAccount(input: {
    organizationId: string;
    email: string;
    password: string;
    role: RoleType | null;
    displayName: string;
  }): { account?: StaffAccount; error?: string } {
    const emailError = validateEmail(input.email);
    if (emailError) {
      return { error: emailError };
    }
    const passwordError = validatePassword(input.password);
    if (passwordError) {
      return { error: passwordError };
    }
    const email = input.email.trim().toLowerCase();
    if (this.accounts.some((a) => a.email === email)) {
      return { error: "An account with this email already exists." };
    }
    const salt = randomBytes(16).toString("hex");
    const account: StaffAccount = {
      profileId: generateProfileId(),
      organizationId: input.organizationId,
      email,
      passwordHash: hashPassword(input.password, salt),
      passwordSalt: salt,
      passwordHashVersion: "scrypt-v1",
      role: input.role ?? null,
      displayName: input.displayName.trim() || email.split("@")[0],
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      failedAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    };
    this.accounts.push(account);
    this.persist();
    return { account };
  }

  findAccountByEmail(email: string): StaffAccount | undefined {
    return this.accounts.find((a) => a.email === email.trim().toLowerCase());
  }

  findAccountByProfileId(profileId: string): StaffAccount | undefined {
    return this.accounts.find((a) => a.profileId === profileId);
  }

  login(input: {
    email: string;
    password: string;
    deviceName: string;
    rememberDevice: boolean;
  }): {
    account?: StaffAccount;
    session?: SessionInfo;
    error?: string;
  } {
    const email = input.email.trim().toLowerCase();
    const account = this.findAccountByEmail(email);
    const organizationId = account ? account.organizationId : "unknown";
    if (!account) {
      void logAuditEvent({
        organizationId,
        actorEmail: email,
        action: "login_failed",
        entityType: "profile",
        description: `Login failed for unknown email: ${email}`,
        success: false,
      });
      return { error: "Invalid email or password." };
    }
    if (!account.isActive) {
      void logAuditEvent({
        organizationId: account.organizationId,
        actorProfileId: account.profileId,
        actorEmail: account.email,
        action: "login_failed",
        entityType: "profile",
        entityId: account.profileId,
        description: "Login blocked: account deactivated.",
        success: false,
      });
      return { error: "This account has been deactivated. Contact your store owner." };
    }
    if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) {
      void logAuditEvent({
        organizationId: account.organizationId,
        actorProfileId: account.profileId,
        actorEmail: account.email,
        action: "login_failed",
        entityType: "profile",
        entityId: account.profileId,
        description: "Login blocked: account temporarily locked.",
        success: false,
      });
      return { error: "Too many failed attempts. Account locked for 15 minutes." };
    }

    if (!verifyPassword(account, input.password)) {
      account.failedAttempts += 1;
      if (account.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        account.lockedUntil = new Date(
          Date.now() + LOCKOUT_MINUTES * 60 * 1000,
        ).toISOString();
        account.failedAttempts = 0;
      }
      this.persist();
      void logAuditEvent({
        organizationId: account.organizationId,
        actorProfileId: account.profileId,
        actorEmail: account.email,
        action: "login_failed",
        entityType: "profile",
        entityId: account.profileId,
        description: `Wrong password (attempt ${account.failedAttempts}).`,
        success: false,
      });
      return { error: "Invalid email or password." };
    }

    account.failedAttempts = 0;
    account.lockedUntil = null;
    account.lastLoginAt = new Date().toISOString();
    if (account.passwordHashVersion !== "scrypt-v1") {
      account.passwordSalt = randomBytes(16).toString("hex");
      account.passwordHash = hashPassword(input.password, account.passwordSalt);
      account.passwordHashVersion = "scrypt-v1";
    }
    this.persist();

    const session = sessionManager.createSession({
      profileId: account.profileId,
      organizationId: account.organizationId,
      deviceName: input.deviceName,
      rememberDevice: input.rememberDevice,
    });

    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: "login",
      entityType: "profile",
      entityId: account.profileId,
      description: `Signed in from device: ${input.deviceName}`,
      success: true,
    });

    return { account, session };
  }

  logout(token: string): { success: boolean } {
    const session = sessionManager.validateSession(token).session;
    if (!session) {
      return { success: false };
    }
    sessionManager.revokeSession(token);
    void logAuditEvent({
      organizationId: session.organizationId,
      actorProfileId: session.profileId,
      action: "logout",
      entityType: "session",
      entityId: session.sessionId,
      description: `Signed out from device: ${session.deviceName}`,
      success: true,
    });
    return { success: true };
  }

  changePassword(input: {
    profileId: string;
    currentPassword: string;
    newPassword: string;
  }): { success: boolean; error?: string } {
    const account = this.findAccountByProfileId(input.profileId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }
    if (!verifyPassword(account, input.currentPassword)) {
      return { success: false, error: "Current password is incorrect." };
    }
    const passwordError = validatePassword(input.newPassword);
    if (passwordError) {
      return { success: false, error: passwordError };
    }
    account.passwordSalt = randomBytes(16).toString("hex");
    account.passwordHash = hashPassword(input.newPassword, account.passwordSalt);
    account.passwordHashVersion = "scrypt-v1";
    account.mustChangePassword = false;
    this.persist();
    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: "password_changed",
      entityType: "profile",
      entityId: account.profileId,
      description: "Password changed by user.",
      success: true,
    });
    return { success: true };
  }

  requestPasswordReset(email: string): { resetToken?: string; error?: string } {
    const emailError = validateEmail(email);
    if (emailError) {
      return { error: emailError };
    }
    const account = this.findAccountByEmail(email);
    if (!account) {
      return { error: "No account found for this email." };
    }
    const token = generateToken("reset");
    this.resetTokens[token] = {
      profileId: account.profileId,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
    };
    this.persist();
    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: "password_reset_requested",
      entityType: "profile",
      entityId: account.profileId,
      description: "Password reset requested.",
      success: true,
    });
    return { resetToken: token };
  }

  completePasswordReset(token: string, newPassword: string): { success: boolean; error?: string } {
    const reset = this.resetTokens[token];
    if (!reset) {
      return { success: false, error: "Invalid or expired reset token." };
    }
    if (new Date(reset.expiresAt).getTime() < Date.now()) {
      delete this.resetTokens[token];
      this.persist();
      return { success: false, error: "This reset link has expired. Request a new one." };
    }
    const account = this.findAccountByProfileId(reset.profileId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return { success: false, error: passwordError };
    }
    account.passwordSalt = randomBytes(16).toString("hex");
    account.passwordHash = hashPassword(newPassword, account.passwordSalt);
    account.passwordHashVersion = "scrypt-v1";
    account.failedAttempts = 0;
    account.lockedUntil = null;
    delete this.resetTokens[token];
    this.persist();
    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: "password_reset_completed",
      entityType: "profile",
      entityId: account.profileId,
      description: "Password reset completed.",
      success: true,
    });
    return { success: true };
  }

  setAccountRole(profileId: string, role: RoleType | null): { success: boolean; error?: string } {
    const account = this.findAccountByProfileId(profileId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }
    const normalized = normalizeRole(role);
    if (normalized && !roleExists(normalized)) {
      return { success: false, error: "Role does not exist." };
    }
    const previous = account.role;
    account.role = normalized;
    this.persist();
    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: "role_assigned",
      entityType: "profile",
      entityId: account.profileId,
      description: `Role changed from ${previous || "none"} to ${normalized || "none"}.`,
      success: true,
    });
    return { success: true };
  }

  setAccountActive(profileId: string, isActive: boolean): { success: boolean; error?: string } {
    const account = this.findAccountByProfileId(profileId);
    if (!account) {
      return { success: false, error: "Account not found." };
    }
    account.isActive = isActive;
    if (!isActive) {
      sessionManager.revokeAllForProfile(profileId);
    }
    this.persist();
    void logAuditEvent({
      organizationId: account.organizationId,
      actorProfileId: account.profileId,
      actorEmail: account.email,
      action: isActive ? "account_activated" : "account_deactivated",
      entityType: "profile",
      entityId: account.profileId,
      description: isActive ? "Account activated." : "Account deactivated; sessions revoked.",
      success: true,
    });
    return { success: true };
  }

  listAccounts(organizationId: string): StaffAccount[] {
    return this.accounts
      .filter((a) => a.organizationId === organizationId)
      .sort((a, b) => a.email.localeCompare(b.email));
  }
}

export const authManager = new AuthManager();

export function registerAccount(input: {
  organizationId: string;
  email: string;
  password: string;
  role: RoleType | null;
  displayName: string;
}): { account?: StaffAccount; error?: string } {
  return authManager.registerAccount(input);
}

export function login(input: {
  email: string;
  password: string;
  deviceName: string;
  rememberDevice: boolean;
}): { account?: StaffAccount; session?: SessionInfo; error?: string } {
  return authManager.login(input);
}

export function logout(token: string): { success: boolean } {
  return authManager.logout(token);
}

export function changePassword(input: {
  profileId: string;
  currentPassword: string;
  newPassword: string;
}): { success: boolean; error?: string } {
  return authManager.changePassword(input);
}

export function requestPasswordReset(email: string): { resetToken?: string; error?: string } {
  return authManager.requestPasswordReset(email);
}

export function completePasswordReset(token: string, newPassword: string): { success: boolean; error?: string } {
  return authManager.completePasswordReset(token, newPassword);
}

export function setAccountRole(profileId: string, role: RoleType | null): { success: boolean; error?: string } {
  return authManager.setAccountRole(profileId, role);
}

export function setAccountActive(profileId: string, isActive: boolean): { success: boolean; error?: string } {
  return authManager.setAccountActive(profileId, isActive);
}

export function listAccounts(organizationId: string): StaffAccount[] {
  return authManager.listAccounts(organizationId);
}
