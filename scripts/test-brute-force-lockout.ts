import assert from "node:assert/strict";
import {
  buildLockoutMessage,
  checkLoginAllowed,
  clearFailedLogins,
  InMemoryLoginAttemptStore,
  isLoginLocked,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCKOUT_MINUTES,
  normalizeLockoutIdentifier,
  recordFailedLogin,
  remainingLockSeconds,
} from "../src/lib/identity/login-lockout";

// Brute-force lockout slice (P0-7, approved by UMAIR 2026-11-16).
//
// Rules under test (all code-level, in-memory store, time-mocked):
// 1. The 5th failed attempt locks the email.
// 2. A 6th attempt while locked is rejected WITHOUT checking the password
//    (the lock check runs before authentication).
// 3. Per-email isolation: locking one email does not lock another.
// 4. The lock auto-expires after 15 minutes.
// 5. A successful login clears the attempt count.
// 6. The owner Unlock clears the lock.
// 7. A non-existent email's failed attempts are recorded and lock it.
// 8. Further failures while locked do NOT extend the lock.
// 9. After an expired lock, the next failure restarts the count at 1.
// 10. Fail-open: a broken store never blocks sign-in.
// 11. Lock message wording (minutes, singular/plural).
// 12. Identifier normalisation (trim + lowercase).
// 13. listLocked: a locked row with organization_id NULL (unknown
//     Profile ID) appears for any org; a locked row for a different org
//     does not appear; a locked row for the caller's org appears; an
//     expired lock does not appear.

const MINUTE_MS = 60 * 1000;

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * MINUTE_MS);
}

// Minimal harness mirroring staffLogin's order: lock check FIRST, then the
// password check, then record-or-clear. Lets assertion 2 prove the
// password is never tested while locked.
async function attemptLogin(
  store: InMemoryLoginAttemptStore,
  email: string,
  password: string,
  now: Date,
  signInCalls: { count: number },
): Promise<{ ok: boolean; locked: boolean }> {
  const allowed = await checkLoginAllowed(store, email, now);
  if (!allowed.allowed) {
    return { ok: false, locked: true };
  }
  signInCalls.count += 1;
  const authed = password === "correct-password";
  if (!authed) {
    await recordFailedLogin(store, email, null, now);
    return { ok: false, locked: false };
  }
  await clearFailedLogins(store, email);
  return { ok: true, locked: false };
}

async function main() {
  assert.equal(MAX_FAILED_LOGIN_ATTEMPTS, 5);
  assert.equal(LOGIN_LOCKOUT_MINUTES, 15);

  // ─── 12. Identifier normalisation ──────────────────────────────────
  assert.equal(
    normalizeLockoutIdentifier("  Cashier@Example.com "),
    "cashier@example.com",
  );
  assert.equal(normalizeLockoutIdentifier("MU04"), "mu04");

  // ─── 11. Lock message wording ──────────────────────────────────────
  assert.equal(
    buildLockoutMessage(15 * 60),
    "Too many failed sign-in attempts. Try again in 15 minutes.",
  );
  assert.equal(
    buildLockoutMessage(60),
    "Too many failed sign-in attempts. Try again in 1 minute.",
  );
  assert.equal(
    buildLockoutMessage(61),
    "Too many failed sign-in attempts. Try again in 2 minutes.",
  );

  const t0 = new Date("2026-11-16T10:00:00.000Z");

  // ─── 1. 5th failed attempt locks the email ─────────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 1; i <= 4; i++) {
      const result = await attemptLogin(
        store,
        "cashier@staff.tradeos.internal",
        "wrong",
        t0,
        calls,
      );
      assert.equal(result.ok, false);
      assert.equal(result.locked, false);
    }
    assert.equal(calls.count, 4);
    const fifth = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "wrong",
      t0,
      calls,
    );
    // The attempt that trips the lock still returns the generic error;
    // the lock message appears on the NEXT attempt.
    assert.equal(fifth.ok, false);
    assert.equal(fifth.locked, false);
    assert.equal(calls.count, 5);
    const record = await store.get("cashier@staff.tradeos.internal");
    assert.ok(record);
    assert.equal(record.failedAttempts, 5);
    assert.ok(record.lockedUntil);
    assert.equal(isLoginLocked(record, t0), true);
    assert.equal(
      record.lockedUntil,
      minutesAfter(t0, 15).toISOString(),
    );
  }

  // ─── 2. 6th attempt while locked never checks the password ─────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 0; i < 5; i++) {
      await attemptLogin(
        store,
        "cashier@staff.tradeos.internal",
        "wrong",
        t0,
        calls,
      );
    }
    assert.equal(calls.count, 5);
    // Even the CORRECT password is refused while locked — and the
    // password check is never invoked.
    const sixth = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "correct-password",
      t0,
      calls,
    );
    assert.equal(sixth.ok, false);
    assert.equal(sixth.locked, true);
    assert.equal(calls.count, 5);
    const allowed = await checkLoginAllowed(
      store,
      "cashier@staff.tradeos.internal",
      t0,
    );
    assert.equal(allowed.allowed, false);
    assert.equal(allowed.retryAfterSeconds, 15 * 60);
  }

  // ─── 3. Per-email isolation ────────────────────────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 0; i < 5; i++) {
      await attemptLogin(
        store,
        "cashier@staff.tradeos.internal",
        "wrong",
        t0,
        calls,
      );
    }
    const other = await attemptLogin(
      store,
      "manager@staff.tradeos.internal",
      "correct-password",
      t0,
      calls,
    );
    assert.equal(other.ok, true);
    assert.equal(other.locked, false);
    const allowed = await checkLoginAllowed(
      store,
      "manager@staff.tradeos.internal",
      t0,
    );
    assert.equal(allowed.allowed, true);
  }

  // ─── 4. Lock auto-expires after 15 minutes ─────────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 0; i < 5; i++) {
      await attemptLogin(
        store,
        "cashier@staff.tradeos.internal",
        "wrong",
        t0,
        calls,
      );
    }
    // 14 minutes in: still locked.
    const at14 = await checkLoginAllowed(
      store,
      "cashier@staff.tradeos.internal",
      minutesAfter(t0, 14),
    );
    assert.equal(at14.allowed, false);
    assert.equal(at14.retryAfterSeconds, 60);
    // 15 minutes + 1 second: auto-unlocked, and the correct password works.
    const after = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "correct-password",
      new Date(t0.getTime() + 15 * MINUTE_MS + 1000),
      calls,
    );
    assert.equal(after.ok, true);
    assert.equal(after.locked, false);
  }

  // ─── 5. Successful login clears the attempt count ──────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "wrong",
      t0,
      calls,
    );
    await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "wrong",
      t0,
      calls,
    );
    const before = await store.get("cashier@staff.tradeos.internal");
    assert.equal(before?.failedAttempts, 2);
    const ok = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "correct-password",
      t0,
      calls,
    );
    assert.equal(ok.ok, true);
    assert.equal(
      await store.get("cashier@staff.tradeos.internal"),
      null,
    );
    // The next failure starts again at 1, not 3.
    await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "wrong",
      t0,
      calls,
    );
    const restarted = await store.get("cashier@staff.tradeos.internal");
    assert.equal(restarted?.failedAttempts, 1);
    assert.equal(isLoginLocked(restarted, t0), false);
  }

  // ─── 6. Owner Unlock clears the lock ───────────────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 0; i < 5; i++) {
      await attemptLogin(
        store,
        "cashier@staff.tradeos.internal",
        "wrong",
        t0,
        calls,
      );
    }
    assert.equal(
      isLoginLocked(
        await store.get("cashier@staff.tradeos.internal"),
        t0,
      ),
      true,
    );
    // Owner manual unlock = clear the row.
    await clearFailedLogins(store, "cashier@staff.tradeos.internal");
    assert.equal(
      await store.get("cashier@staff.tradeos.internal"),
      null,
    );
    const after = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "correct-password",
      t0,
      calls,
    );
    assert.equal(after.ok, true);
  }

  // ─── 7. Non-existent email locks too ───────────────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    const calls = { count: 0 };
    for (let i = 0; i < 5; i++) {
      await attemptLogin(store, "ghost@example.com", "wrong", t0, calls);
    }
    const record = await store.get("ghost@example.com");
    assert.ok(record);
    assert.equal(record.failedAttempts, 5);
    assert.equal(isLoginLocked(record, t0), true);
    const allowed = await checkLoginAllowed(store, "ghost@example.com", t0);
    assert.equal(allowed.allowed, false);
    // And a real account is unaffected.
    const real = await attemptLogin(
      store,
      "cashier@staff.tradeos.internal",
      "correct-password",
      t0,
      calls,
    );
    assert.equal(real.ok, true);
  }

  // ─── 8. Failures while locked do NOT extend the lock ───────────────
  {
    const store = new InMemoryLoginAttemptStore();
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(
        store,
        "cashier@staff.tradeos.internal",
        null,
        t0,
      );
    }
    const first = await store.get("cashier@staff.tradeos.internal");
    assert.equal(first?.lockedUntil, minutesAfter(t0, 15).toISOString());
    // Three more failures during the lock.
    for (let i = 0; i < 3; i++) {
      await recordFailedLogin(
        store,
        "cashier@staff.tradeos.internal",
        null,
        minutesAfter(t0, 5),
      );
    }
    const after = await store.get("cashier@staff.tradeos.internal");
    // Count rose, but the lock still expires at the original time.
    assert.equal(after?.failedAttempts, 8);
    assert.equal(after?.lockedUntil, first?.lockedUntil);
    assert.equal(remainingLockSeconds(after, minutesAfter(t0, 14)), 60);
  }

  // ─── 9. Expired lock restarts the count at 1 ───────────────────────
  {
    const store = new InMemoryLoginAttemptStore();
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(
        store,
        "cashier@staff.tradeos.internal",
        null,
        t0,
      );
    }
    const result = await recordFailedLogin(
      store,
      "cashier@staff.tradeos.internal",
      null,
      minutesAfter(t0, 16),
    );
    assert.equal(result.locked, false);
    assert.equal(result.attempts, 1);
    const record = await store.get("cashier@staff.tradeos.internal");
    assert.equal(record?.lockedUntil, null);
  }

  // ─── 10. Fail-open: a broken store never blocks sign-in ────────────
  {
    const broken: Parameters<typeof checkLoginAllowed>[0] = {
      get: async () => {
        throw new Error("relation \"login_attempts\" does not exist");
      },
      recordFailure: async () => {
        throw new Error("relation \"login_attempts\" does not exist");
      },
      clear: async () => {
        throw new Error("relation \"login_attempts\" does not exist");
      },
      listLocked: async () => {
        throw new Error("relation \"login_attempts\" does not exist");
      },
    };
    const allowed = await checkLoginAllowed(broken, "anyone@example.com", t0);
    assert.equal(allowed.allowed, true);
    const recorded = await recordFailedLogin(
      broken,
      "anyone@example.com",
      null,
      t0,
    );
    assert.equal(recorded.locked, false);
    // Clearing must not throw either.
    await clearFailedLogins(broken, "anyone@example.com");
  }

  // ─── 13. listLocked: NULL-org locks visible, other orgs hidden ────
  {
    const store = new InMemoryLoginAttemptStore();
    const orgA = "11111111-1111-1111-1111-111111111111";
    const orgB = "22222222-2222-2222-2222-222222222222";

    // Lock a NULL-org key (unknown Profile ID, e.g. MU99): 5 failures,
    // recorded with no organisation to resolve.
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(store, "mu99", null, t0);
    }
    // Lock a key belonging to org A (real staff, e.g. MU04).
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(
        store,
        "muse@staff.tradeos.internal",
        orgA,
        t0,
      );
    }
    // Lock a key belonging to a DIFFERENT org B.
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(
        store,
        "other@staff.tradeos.internal",
        orgB,
        t0,
      );
    }

    // (a) NULL-org lock appears for org A; (c) org-A lock appears for
    // org A; (b) org-B lock does NOT appear for org A. Sorted by email.
    const forA = await store.listLocked(orgA, t0);
    assert.deepEqual(
      forA.map((row) => row.email),
      ["mu99", "muse@staff.tradeos.internal"],
    );
    // The NULL-org lock also appears for org B (it belongs to no org),
    // alongside org B's own lock.
    const forB = await store.listLocked(orgB, t0);
    assert.deepEqual(
      forB.map((row) => row.email),
      ["mu99", "other@staff.tradeos.internal"],
    );

    // (d) Expired locks do not appear: 16 minutes later, past the
    // 15-minute lock, the list is empty for both orgs.
    assert.deepEqual(await store.listLocked(orgA, minutesAfter(t0, 16)), []);
    assert.deepEqual(await store.listLocked(orgB, minutesAfter(t0, 16)), []);
  }

  console.log("test-brute-force-lockout: all assertions passed");
}

main().catch((error) => {
  console.error("test-brute-force-lockout: FAILED", error);
  process.exit(1);
});
