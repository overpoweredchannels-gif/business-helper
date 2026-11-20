import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StaffOnboardingService,
  STAFF_LOGIN_GENERIC_ERROR,
} from "../src/lib/identity/services/staff-onboarding-service";

// HYBRID Slice 2 — staff login oracle fix.
//
// Rules under test (all code-level, mocked Supabase client, no network):
// 1. An unknown Profile ID returns exactly "Profile ID ya password ghalat hai".
// 2. A wrong password for a known Profile ID returns the exact same string.
// 3. The two errors are identical (assert.equal on the returned values).
// 4. The unknown-ID path runs the password check anyway (dummy sign-in):
//    its mean time is within 25ms of the wrong-password mean, and above a
//    30ms floor — without the dummy check it would take ~0ms.
// 5. Each unknown-ID attempt calls signInWithPassword exactly once, with
//    the dummy hidden email (never the entered ID as an email).
// 6. A correct password still signs in (ok:true + tokens) — no regression.
// 7. The 5-attempt lockout still engages (6th attempt locked:true, and the
//    lock check runs before the password check, so no extra sign-in call).
// 8. Unknown IDs lock out too (per-ID throttling, key = entered ID).
// 9. The old oracle strings appear nowhere in the staff login path
//    (service, route, sign-in form) nor anywhere under src/ or electron/.
// 10. A pending-activation account returns the generic error.
// 11. A deactivated account returns the generic error.
// 12. An account without an email returns the generic error.

const GENERIC = "Profile ID ya password ghalat hai";
const KNOWN_ID = "MU04";
const PENDING_ID = "MU97";
const DEACTIVATED_ID = "MU98";
const NOEMAIL_ID = "MU96";
const KNOWN_EMAIL = "mu04@staff.tradeos.internal";
const CORRECT_PASSWORD = "correct-password";
const SIGN_IN_DELAY_MS = 40;

assert.equal(STAFF_LOGIN_GENERIC_ERROR, GENERIC, "0. generic constant is the required string");

const KNOWN_PROFILE = {
  id: "profile-mu04",
  email: KNOWN_EMAIL,
  is_active: true,
  organization_id: "org-1",
};

const PENDING_PROFILE = {
  id: "profile-mu97",
  email: "mu97@staff.tradeos.internal",
  is_active: false,
  organization_id: "org-1",
};

const DEACTIVATED_PROFILE = {
  id: "profile-mu98",
  email: "mu98@staff.tradeos.internal",
  is_active: false,
  organization_id: "org-1",
};

const NOEMAIL_PROFILE = {
  id: "profile-mu96",
  email: null,
  is_active: true,
  organization_id: "org-1",
};

type AttemptRow = {
  email: string;
  organization_id: string | null;
  failed_attempts: number;
  locked_until: string | null;
  last_attempt_at: string;
};

function buildFakeSupabase() {
  const attempts = new Map<string, AttemptRow>();
  const signInCalls: Array<{ email: string; password: string }> = [];

  class FakeQuery {
    private filters: Record<string, unknown> = {};
    private mode: "select" | "delete" = "select";
    constructor(
      private table: string,
    ) {}
    select() {
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters[col] = val;
      return this;
    }
    is(col: string, val: unknown) {
      this.filters[col] = val;
      return this;
    }
    gt(col: string, val: unknown) {
      this.filters[col] = val;
      return this;
    }
    order() {
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    async maybeSingle() {
      return this.execute();
    }
    async single() {
      return this.execute();
    }
    then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
      return this.execute().then(onFulfilled, onRejected);
    }
    private async execute(): Promise<{ data: unknown; error: null }> {
      if (this.table === "profiles") {
        const byId: Record<string, unknown> = {
          [KNOWN_ID]: { ...KNOWN_PROFILE },
          [PENDING_ID]: { ...PENDING_PROFILE },
          [DEACTIVATED_ID]: { ...DEACTIVATED_PROFILE },
          [NOEMAIL_ID]: { ...NOEMAIL_PROFILE },
        };
        return {
          data: byId[String(this.filters.login_id)] ?? null,
          error: null,
        };
      }
      if (this.table === "login_attempts") {
        const key = String(this.filters.email ?? "");
        if (this.mode === "delete") {
          attempts.delete(key);
          return { data: null, error: null };
        }
        return { data: attempts.get(key) ?? null, error: null };
      }
      if (this.table === "employees") {
        // invite_status lookup, only hit for inactive profiles.
        const statusByProfile: Record<string, string> = {
          "profile-mu97": "pending",
          "profile-mu98": "accepted",
        };
        const status = statusByProfile[String(this.filters.profile_id)] ?? null;
        return { data: status === null ? null : { invite_status: status }, error: null };
      }
      return { data: null, error: null };
    }
  }

  const fake = {
    signInCalls,
    attempts,
    from(table: string) {
      return new FakeQuery(table) as never;
    },
    async rpc(name: string, params: { p_email: string; p_organization_id: string | null }) {
      assert.equal(name, "record_login_attempt");
      const key = params.p_email;
      const now = new Date();
      const existing = attempts.get(key);
      const failedAttempts = (existing?.failed_attempts ?? 0) + 1;
      const lockedUntil =
        failedAttempts >= 5
          ? new Date(now.getTime() + 15 * 60 * 1000).toISOString()
          : existing?.locked_until ?? null;
      const row: AttemptRow = {
        email: key,
        organization_id: params.p_organization_id,
        failed_attempts: failedAttempts,
        locked_until: lockedUntil,
        last_attempt_at: now.toISOString(),
      };
      attempts.set(key, row);
      return { data: [row], error: null };
    },
    auth: {
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        signInCalls.push({ email, password });
        await new Promise((resolve) => setTimeout(resolve, SIGN_IN_DELAY_MS));
        if (email === KNOWN_EMAIL && password === CORRECT_PASSWORD) {
          return {
            data: { session: { access_token: "access-1", refresh_token: "refresh-1" } },
            error: null,
          };
        }
        return { data: { session: null }, error: { message: "Invalid login credentials" } };
      },
    },
  };
  return fake;
}

function newService() {
  const fake = buildFakeSupabase();
  const service = new StaffOnboardingService(() => fake as never);
  return { service, fake };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

async function main() {
  // ─── 1 + 2 + 3. Unknown ID and wrong password: same generic error ────
  const { service, fake } = newService();
  const unknown = await service.staffLogin("NOPE01", "whatever-password");
  assert.equal(unknown.ok, false, "1. unknown ID fails");
  assert.equal(unknown.error, GENERIC, "1. unknown ID returns the generic error");
  const wrong = await service.staffLogin(KNOWN_ID, "wrong-password");
  assert.equal(wrong.ok, false, "2. wrong password fails");
  assert.equal(wrong.error, GENERIC, "2. wrong password returns the generic error");
  assert.equal(unknown.error, wrong.error, "3. both errors are identical");

  // ─── 5. The dummy password check ran for the unknown ID ─────────────
  assert.equal(fake.signInCalls.length, 2, "5. two sign-in calls so far");
  assert.equal(
    fake.signInCalls[0]?.email,
    "no-such-profile@staff.tradeos.internal",
    "5. unknown-ID attempt signs in with the dummy hidden email",
  );
  assert.equal(fake.signInCalls[1]?.email, KNOWN_EMAIL, "5. wrong-password attempt uses the real email");

  // ─── 4. Same response time (5 timed iterations each) ────────────────
  // A fresh service per iteration: 5 failures on one ID would trip the
  // lockout mid-loop, and the locked path skips the password check — that
  // would measure the lock, not the credential check.
  const unknownTimes: number[] = [];
  const wrongTimes: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const u = newService();
    unknownTimes.push((await timed(() => u.service.staffLogin("NOPE01", "whatever-password"))).ms);
    const w = newService();
    wrongTimes.push((await timed(() => w.service.staffLogin(KNOWN_ID, "wrong-password"))).ms);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const unknownMean = mean(unknownTimes);
  const wrongMean = mean(wrongTimes);
  console.log(
    `timing: unknown-ID mean ${unknownMean.toFixed(1)}ms, wrong-password mean ${wrongMean.toFixed(1)}ms (sign-in delay ${SIGN_IN_DELAY_MS}ms)`,
  );
  assert.ok(
    unknownMean >= 30,
    `4. unknown-ID mean ${unknownMean.toFixed(1)}ms is below the 30ms floor — the dummy password check did not run`,
  );
  assert.ok(
    Math.abs(unknownMean - wrongMean) <= 25,
    `4. means differ by ${Math.abs(unknownMean - wrongMean).toFixed(1)}ms (> 25ms) — timing leaks whether the ID exists`,
  );

  // ─── 6. Correct password still signs in ─────────────────────────────
  // Fresh service: the timing loop above already recorded 5 failed
  // MU04 attempts, which trips the lockout on this instance.
  const goodCase = newService();
  const good = await goodCase.service.staffLogin(KNOWN_ID, CORRECT_PASSWORD);
  assert.equal(good.ok, true, "6. correct password succeeds");
  assert.equal(good.accessToken, "access-1", "6. access token returned");
  assert.equal(good.refreshToken, "refresh-1", "6. refresh token returned");

  // ─── 7. Lockout still engages for a known ID ────────────────────────
  const lockedCase = newService();
  for (let i = 0; i < 5; i += 1) {
    const r = await lockedCase.service.staffLogin(KNOWN_ID, "wrong-password");
    assert.equal(r.ok, false, `7. attempt ${i + 1} fails`);
    assert.equal(r.locked, undefined, `7. attempt ${i + 1} is not locked yet`);
    assert.equal(r.error, GENERIC, `7. attempt ${i + 1} returns the generic error`);
  }
  const signInsBeforeLock = lockedCase.fake.signInCalls.length;
  const sixth = await lockedCase.service.staffLogin(KNOWN_ID, "wrong-password");
  assert.equal(sixth.ok, false, "7. 6th attempt fails");
  assert.equal(sixth.locked, true, "7. 6th attempt is locked");
  assert.match(sixth.error ?? "", /Too many failed sign-in attempts/, "7. lock message surfaces");
  assert.equal(
    lockedCase.fake.signInCalls.length,
    signInsBeforeLock,
    "7. the lock check runs before the password check (no extra sign-in call)",
  );

  // ─── 8. Unknown IDs lock out too ────────────────────────────────────
  const unknownLock = newService();
  for (let i = 0; i < 5; i += 1) {
    const r = await unknownLock.service.staffLogin("NOPE01", "whatever-password");
    assert.equal(r.error, GENERIC, `8. unknown attempt ${i + 1} returns the generic error`);
  }
  const sixthUnknown = await unknownLock.service.staffLogin("NOPE01", "whatever-password");
  assert.equal(sixthUnknown.locked, true, "8. 6th unknown-ID attempt is locked");
  assert.match(sixthUnknown.error ?? "", /Too many failed sign-in attempts/, "8. unknown-ID lock message surfaces");

  // ─── 10 + 11 + 12. Inactive / deactivated / no-email: generic error ─
  // Sunday small fix: the client never learns whether the account is
  // pending activation, deactivated, or not ready — every state returns
  // the same generic string, and the real reason stays in the server
  // log only (rule 9 asserts the distinct strings are gone from the
  // login-path source).
  const pendingCase = newService();
  const pending = await pendingCase.service.staffLogin(PENDING_ID, "whatever-password");
  assert.equal(pending.ok, false, "10. pending-activation account fails");
  assert.equal(pending.error, GENERIC, "10. pending-activation returns the generic error");
  assert.equal(pendingCase.fake.signInCalls.length, 0, "10. pending-activation never reaches the password check");
  const deactivatedCase = newService();
  const deactivated = await deactivatedCase.service.staffLogin(DEACTIVATED_ID, "whatever-password");
  assert.equal(deactivated.ok, false, "11. deactivated account fails");
  assert.equal(deactivated.error, GENERIC, "11. deactivated returns the generic error");
  assert.equal(deactivatedCase.fake.signInCalls.length, 0, "11. deactivated never reaches the password check");
  const noEmailCase = newService();
  const noEmail = await noEmailCase.service.staffLogin(NOEMAIL_ID, "whatever-password");
  assert.equal(noEmail.ok, false, "12. no-email account fails");
  assert.equal(noEmail.error, GENERIC, "12. no-email returns the generic error");
  assert.equal(noEmailCase.fake.signInCalls.length, 0, "12. no-email never reaches the password check");

  // ─── 9. Old oracle strings are gone ─────────────────────────────────
  const root = join(__dirname, "..");
  const serviceSrc = readFileSync(join(root, "src/lib/identity/services/staff-onboarding-service.ts"), "utf8");
  const loginRouteSrc = readFileSync(join(root, "src/app/api/identity/staff/login/route.ts"), "utf8");
  const authFuseSrc = readFileSync(join(root, "src/components/ui/auth-fuse.tsx"), "utf8");
  for (const [name, src] of [
    ["staff-onboarding-service.ts", serviceSrc],
    ["staff/login route", loginRouteSrc],
    ["auth-fuse.tsx", authFuseSrc],
  ] as const) {
    assert.ok(!src.includes("No account found for this Profile ID"), `9. oracle string still in ${name}`);
    assert.ok(!src.includes("Incorrect Profile ID or password"), `9. wrong-password oracle string still in ${name}`);
    assert.ok(!src.includes("hasn't been activated yet"), `9. pending-activation oracle string still in ${name}`);
    assert.ok(!src.includes("has been deactivated by your manager"), `9. deactivated oracle string still in ${name}`);
    assert.ok(!src.includes("This account is not ready yet"), `9. not-ready oracle string still in ${name}`);
  }
  const grep = execSync(
    "grep -rn 'No account found for this Profile ID' src electron 2>/dev/null || true",
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(grep, "", `9. oracle string still present repo-wide:\n${grep}`);

  console.log("staff-login generic error: PASS (12 rules)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
