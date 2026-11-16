"use client";

import { useState, useEffect, useCallback } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

// Owner-only manual unlock for the brute-force lockout (phase 23).
// Mounted on the Staff / Security Check screen next to Role Management.
// Lists currently-locked staff sign-ins (5 failed attempts → 15-minute
// lock) with an Unlock button each, plus a manual unlock by Profile ID
// or email for identifiers that have no staff row (e.g. a lock recorded
// under an unknown Profile ID).
//
// The Unlock button uses an inline two-step confirm (tap once to arm,
// tap again to confirm) instead of window.confirm(), which silently
// no-ops in this app when the native dialog does not resolve.

interface LockedSignIn {
  email: string;
  loginId: string | null;
  displayName: string | null;
  failedAttempts: number;
  lockedUntil: string;
  lastAttemptAt: string;
}

export default function LoginLockoutPanel() {
  const { t } = useRegional();
  const [locked, setLocked] = useState<LockedSignIn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualIdentifier, setManualIdentifier] = useState("");
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [unlockingKey, setUnlockingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authorizedFetch("/api/identity/staff/unlock");
      const data = await res.json();
      if (data.ok) {
        setLocked(data.locked || []);
        setError(null);
      } else {
        setError(data.error || t("identity.lockout.loadFailed"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("identity.lockout.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const unlock = async (identifier: string, isEmail: boolean) => {
    const key = identifier.trim();
    if (!key) {
      setError(t("identity.lockout.enterIdentifier"));
      return;
    }
    setUnlockingKey(key);
    setError(null);
    setMessage(null);
    try {
      const res = await authorizedFetch("/api/identity/staff/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEmail ? { email: key } : { loginId: key },
        ),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(
          t("identity.lockout.unlocked").replace(
            "{identifier}",
            data.unlocked ?? key,
          ),
        );
        setManualIdentifier("");
        setConfirmingKey(null);
        load();
      } else {
        setError(data.error || t("identity.lockout.unlockFailed"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("identity.lockout.unlockFailed"),
      );
    } finally {
      setUnlockingKey(null);
    }
  };

  const requestUnlock = (row: LockedSignIn) => {
    // Listed rows are keyed by Profile ID when known (the owner reads a
    // Profile ID, not a hidden staff email); fall back to the email.
    const identifier = row.loginId ?? row.email;
    const key = `row:${identifier}`;
    if (confirmingKey === key) {
      void unlock(identifier, !row.loginId);
    } else {
      setConfirmingKey(key);
    }
  };

  const requestManualUnlock = () => {
    const identifier = manualIdentifier.trim();
    if (!identifier) {
      setError(t("identity.lockout.enterIdentifier"));
      return;
    }
    const key = `manual:${identifier.toLowerCase()}`;
    if (confirmingKey === key) {
      void unlock(identifier, identifier.includes("@"));
    } else {
      setConfirmingKey(key);
    }
  };

  return (
    <div className="p-4 sm:p-5">
      <h3 className="text-base font-medium text-foreground">
        {t("identity.lockout.title")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("identity.lockout.subtitle")}
      </p>

      {error && (
        <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-3 rounded border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          {message}
        </div>
      )}

      <div className="mt-4">
        {loading && locked.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : locked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("identity.lockout.noLocked")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {locked.map((row) => {
              const identifier = row.loginId ?? row.email;
              const key = `row:${identifier}`;
              const armed = confirmingKey === key;
              const busy = unlockingKey === identifier;
              return (
                <li
                  key={row.email}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {row.displayName ?? row.loginId ?? row.email}
                      {row.loginId && row.displayName
                        ? ` (${row.loginId})`
                        : ""}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {t("identity.lockout.failedAttempts").replace(
                        "{count}",
                        String(row.failedAttempts),
                      )}
                      {" · "}
                      {t("identity.lockout.lockedUntil").replace(
                        "{time}",
                        new Date(row.lockedUntil).toLocaleString(),
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => requestUnlock(row)}
                    className="min-h-11 rounded bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {busy
                      ? "Unlocking…"
                      : armed
                        ? t("identity.lockout.confirmUnlock")
                        : t("identity.lockout.unlock")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <label
          htmlFor="lockout-manual-identifier"
          className="text-sm text-foreground/80"
        >
          {t("identity.lockout.manualLabel")}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="lockout-manual-identifier"
            type="text"
            value={manualIdentifier}
            onChange={(e) => {
              setManualIdentifier(e.target.value);
              setConfirmingKey(null);
            }}
            placeholder={t("identity.lockout.manualPlaceholder")}
            className="min-h-11 flex-1 rounded border border-input bg-card px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            disabled={
              unlockingKey === manualIdentifier.trim() || !manualIdentifier.trim()
            }
            onClick={requestManualUnlock}
            className="min-h-11 rounded border border-border bg-card px-3 py-2 text-sm text-foreground/80 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {confirmingKey ===
            `manual:${manualIdentifier.trim().toLowerCase()}`
              ? t("identity.lockout.confirmUnlock")
              : t("identity.lockout.unlock")}
          </button>
        </div>
      </div>

    </div>
  );
}
