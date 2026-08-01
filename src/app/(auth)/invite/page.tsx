"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, User, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export default function InvitePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Please enter your invitation code.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/identity/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), password, displayName }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Invitation could not be accepted.");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.profile.email,
        password,
      });
      if (signInError) throw signInError;
      setSuccess(data.message || "Welcome to TradeOS!");
      setTimeout(() => router.push("/"), 1500);
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
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="size-9 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">T</span>
            </div>
            <span className="font-bold text-xl text-foreground">TradeOS</span>
          </div>
          <h1 className="font-bold text-2xl text-foreground">You&apos;re invited!</h1>
          <p className="text-sm text-body mt-1.5">
            Your store owner invited you to join TradeOS. Enter your invitation code to activate your account.
          </p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="size-12 text-success" />
            <p className="text-sm text-success text-center">{success}</p>
            <p className="text-xs text-body">Taking you to your workspace...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Invitation code</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className={inputClass}
                  placeholder="ABC12345"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Your name</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <User className="size-4" />
                </div>
                <input
                  className={inputClass}
                  placeholder="e.g. Ali Ahmed"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Mail className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="At least 8 characters with letters and numbers"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground">Confirm password</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Mail className="size-4" />
                </div>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="Repeat your password"
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
              {loading ? "Activating..." : "Activate my account"}
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
