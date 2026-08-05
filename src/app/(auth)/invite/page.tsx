"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Lock, User, Hash, Briefcase, Building2, Phone, Loader2,
  CheckCircle2, AlertCircle, ArrowLeft, Eye, EyeOff,
} from "lucide-react";
import { validateStaffPassword } from "@/lib/identity/staff-invitation";

interface InviteInfo {
  employeeId: string;
  fullName: string;
  loginId: string;
  designation: string | null;
  organizationName: string;
  phone: string | null;
  status: string;
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-panel p-4">
      <div className="text-sm text-body">Loading invitation...</div>
    </div>}>
      <InviteContent />
    </Suspense>
  );
}

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code") ?? "";

  const [code, setCode] = useState(codeFromUrl.toUpperCase());
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadInvite = useCallback(async (inviteCode: string) => {
    if (!inviteCode.trim()) {
      setInfo(null);
      setLoadError(null);
      return;
    }
    setLoadingInfo(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/identity/staff/invite-info?code=${encodeURIComponent(inviteCode)}`);
      const data = await res.json();
      if (data.ok && data.info) {
        setInfo(data.info);
      } else {
        setInfo(null);
        setLoadError(data.error || "Invitation not found.");
      }
    } catch {
      setInfo(null);
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    if (codeFromUrl) loadInvite(codeFromUrl.toUpperCase());
  }, [codeFromUrl, loadInvite]);

  const lockedField = (label: string, value: string, Icon: typeof User) => (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          <Icon className="size-4" />
        </div>
        <input
          className="flex h-11 w-full cursor-not-allowed rounded-lg border border-input bg-muted/40 px-3.5 py-2.5 pl-10 text-sm text-foreground/70 opacity-80"
          value={value}
          readOnly
          tabIndex={-1}
          aria-readonly
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Locked
        </span>
      </div>
    </div>
  );

  const passwordInputClass =
    "flex h-11 w-full rounded-lg border bg-card px-3.5 py-2.5 pl-10 pr-10 text-sm text-foreground transition-all placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Please enter your invitation code.");
      return;
    }
    const passwordError = validateStaffPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/identity/staff/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Invitation could not be accepted.");
        return;
      }
      setSuccess(
        `Account activated for ${info?.fullName ?? ""}. You can now sign in with your Profile ID and password.`,
      );
      setTimeout(() => router.push("/login"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const showPasswordField = Boolean(info) || loadError;

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
          <h1 className="font-bold text-2xl text-foreground">Activate your staff account</h1>
          <p className="text-sm text-body mt-1.5">
            Set your password to start using TradeOS. You do not need an email address.
          </p>
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
              <label className="text-sm font-medium text-foreground">Invitation code</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="size-4" />
                </div>
                <input
                  className="flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Enter the code from your invite"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            {code.trim() && !info && !loadError && (
              <button
                type="button"
                disabled={loadingInfo}
                onClick={() => loadInvite(code)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {loadingInfo ? <Loader2 className="size-4 animate-spin" /> : null}
                {loadingInfo ? "Checking..." : "Check invitation"}
              </button>
            )}

            {loadError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive-bg p-3 text-sm text-destructive">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{loadError}</span>
              </div>
            )}

            {info && (
              <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Your details (provided by {info.organizationName || "your manager"})
                </p>
                {lockedField("Employee name", info.fullName, User)}
                {lockedField("Profile ID", info.loginId, Hash)}
                <div className="grid grid-cols-2 gap-3">
                  {lockedField("Organization", info.organizationName, Building2)}
                  {lockedField(
                    "Designation",
                    info.designation ? info.designation.replace(/_/g, " ") : "Staff",
                    Briefcase,
                  )}
                </div>
                {info.phone ? lockedField("Mobile number", info.phone, Phone) : null}
              </div>
            )}

            {showPasswordField && (
              <>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium text-foreground">Create password</label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                      <Lock className="size-4" />
                    </div>
                    <input
                      className={passwordInputClass}
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters, letters and numbers"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <label className="text-sm font-medium text-foreground">Confirm password</label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                      <Lock className="size-4" />
                    </div>
                    <input
                      className={passwordInputClass}
                      type={showConfirm ? "text" : "password"}
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((s) => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive-bg p-3 text-sm text-destructive">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || loadingInfo}
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
