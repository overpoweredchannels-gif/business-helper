"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

function ResetForm() {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionReady(Boolean(data.session));
      if (!data.session) setError("This password reset link is missing or has expired. Please request a new one.");
    });
    return () => { active = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!sessionReady) {
      setError("This password reset link is missing or has expired. Please request a new one.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Password must be at least 8 characters and contain a letter and a number.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message || "Password reset failed.");
        return;
      }
      await supabase.auth.signOut();
      setSuccess("Password updated. You can now sign in with your new password.");
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "flex h-11 w-full rounded-lg border bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="min-h-screen flex items-center justify-center bg-panel p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8 shadow-lg">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
            <Lock className="size-6 text-primary" />
          </div>
          <h1 className="font-bold text-2xl text-foreground">Reset your password</h1>
          <p className="text-sm text-body mt-1.5">Choose a new password for your TradeOS account.</p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="size-12 text-success" />
            <p className="text-sm text-success text-center">{success}</p>
            <p className="text-xs text-body">Taking you to sign in...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">New password</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="At least 8 characters with letters and numbers"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Confirm new password</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? "Resetting..." : "Reset password"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/login")}
              className="flex items-center justify-center gap-1.5 text-sm text-body hover:text-foreground transition-colors mx-auto"
            >
              <ArrowLeft className="size-4" />
              Back to sign in
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
