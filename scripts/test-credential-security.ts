import assert from "node:assert/strict";
import {
  authManager,
  completePasswordReset,
  login,
  registerAccount,
  requestPasswordReset,
} from "../src/lib/identity/auth";

// These legacy in-memory helpers emit best-effort database audit errors when
// the isolated test intentionally runs without Supabase credentials.
console.error = () => {};

const values = new Map<string, string>();
authManager.setStorage({
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
});

const registered = registerAccount({
  organizationId: "org-security-test",
  email: "security@example.com",
  password: "StrongPass123",
  role: "owner",
  displayName: "Security Test",
});

assert.ok(registered.account);
assert.equal(registered.account.passwordHashVersion, "scrypt-v1");
assert.match(registered.account.passwordHash, /^[a-f0-9]{128}$/);
assert.notEqual(registered.account.passwordHash, "StrongPass123");
assert.equal(login({ email: "security@example.com", password: "wrong123", deviceName: "test", rememberDevice: false }).session, undefined);

const signedIn = login({
  email: "security@example.com",
  password: "StrongPass123",
  deviceName: "test",
  rememberDevice: false,
});
assert.ok(signedIn.session);
assert.match(signedIn.session.deviceToken, /^[a-f0-9]{64}$/);

const reset = requestPasswordReset("security@example.com");
assert.match(reset.resetToken ?? "", /^reset_[a-f0-9]{32}$/);
assert.equal(completePasswordReset(reset.resetToken ?? "", "NewStrongPass456").success, true);
assert.ok(login({ email: "security@example.com", password: "NewStrongPass456", deviceName: "test", rememberDevice: false }).session);

console.log("credential security helpers OK");
