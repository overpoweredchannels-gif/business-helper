"use client";

import { useEffect, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { useRouter } from "next/navigation";
import { Lock, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  clearRecoverySession,
  isRecoverySession,
  readRecoverySession,
} from "@/lib/supabase/email-link-auth";

// Slice 1b: the password form is shown ONLY for a valid recovery session
// (an OTP-verified token, or the callback's same-tab marker). Any other
// state — no session, an ordinary signed-in session, a stale link — shows
// the expired screen with a path to request a new link. The old page
// showed the form to any signed-in user and signed out everywhere
// (default global scope) after the change.
//
// Password policy matches signup: required, and the two fields must match.
// Supabase enforces its own server-side minimum, and its message is shown
// when it rejects a password. The old 8-characters-plus-a-number rule was
// stricter than signup and is removed.
//
// Other sessions: Supabase deletes every other session of the user when
// the password is updated (LogoutAllExceptMe in the password update), so
// other browsers and devices are signed out by the update itself. The
// explicit signOut({ scope: "others" }) below is belt and braces for older
// GoTrue behaviour; it keeps the current session and never blocks the
// success screen when it fails.
type GateState = "checking" | "ready" | "expired";

function ResetForm() {
  const { t } = useRegional();
  const router = useRouter();
  const [gate, setGate] = useState<GateState>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The callback replaces to /reset right after verifying, so the
    // session is normally present already. Poll briefly before declaring
    // the link expired, in case the client is still persisting it.
    const started = Date.now();
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const session = data.session;
      if (session) {
        const recovery =
          isRecoverySession(session.access_token) ||
          readRecoverySession() === session.user.id;
        setGate(recovery ? "ready" : "expired");
        return;
      }
      if (Date.now() - started > 4000) {
        setGate("expired");
        return;
      }
      window.setTimeout(check, 300);
    };
    check();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => router.push("/"), 1500);
    return () => window.clearTimeout(timer);
  }, [success, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (gate !== "ready") {
      setError(t("auth.reset.linkExpired"));
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(t("offline.internetRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordsMismatch"));
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message || t("auth.reset.resetFailed"));
        return;
      }
      // Best effort only: the password update itself already revoked the
      // other sessions server-side. A failure here must not block the
      // success screen, and the current session is kept either way.
      try {
        await supabase.auth.signOut({ scope: "others" });
      } catch {
        // Ignored on purpose: see the note above.
      }
      clearRecoverySession();
      setSuccess(t("auth.reset.updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.reset.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (gate === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-panel p-4">
        <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8 shadow-lg text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-body">Checking your reset link...</p>
        </div>
      </div>
    );
  }

  if (gate === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-panel p-4">
        <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8 shadow-lg">
          <div className="text-center mb-6">
            <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
              <AlertCircle className="size-6 text-primary" />
            </div>
            <h1 className="font-bold text-2xl text-foreground">{t("auth.reset.title")}</h1>
            <p className="text-sm text-body mt-1.5">{t("auth.reset.linkExpired")}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium shadow-sm transition-all hover:shadow-md"
          >
            {t("auth.forgotPassword")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="flex items-center justify-center gap-1.5 text-sm text-body hover:text-foreground transition-colors mt-6 mx-auto"
          >
            <ArrowLeft className="size-4" />
            {t("auth.backToSignIn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-panel p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8 shadow-lg">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
            <Lock className="size-6 text-primary" />
          </div>
          <h1 className="font-bold text-2xl text-foreground">{t("auth.reset.title")}</h1>
          <p className="text-sm text-body mt-1.5">{t("auth.reset.subtitle")}</p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="size-12 text-success" />
            <p className="text-sm text-success text-center">{success}</p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium shadow-sm transition-all hover:shadow-md"
            >
              {t("nav.dashboard")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">{t("team.resetPlaceholder")}</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder={t("auth.createPassword")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">{t("auth.reset.confirmPassword")}</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder={t("auth.reset.confirmPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive-bg p-3 text-sm text-destructive">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium shadow-sm transition-all hover:shadow-md disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {loading ? t("team.resetting") : t("auth.reset.resetPassword")}
            </button>

            <button
              type="button"
              onClick={() => router.push("/login")}
              className="flex items-center justify-center gap-1.5 text-sm text-body hover:text-foreground transition-colors mx-auto"
            >
              <ArrowLeft className="size-4" />
              {t("auth.backToSignIn")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <ResetForm />;
}
