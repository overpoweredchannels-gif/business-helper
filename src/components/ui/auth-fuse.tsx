"use client";

import * as React from "react";
import { useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Mail, Lock, User, Eye, EyeOff, Loader2, Shield,
  BarChart3, Users, CheckCircle2, AlertCircle,
  ArrowLeft
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { supabase } from "@/lib/supabase/client";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { LanguageSwitcher } from "@/components/regional/LanguageSwitcher";

type LoginMethod = "email" | "staff";

type NativeWebViewBridge = {
  postMessage: (message: string) => void;
};

const postToTradeOSMobile = (payload: Record<string, unknown>): boolean => {
  if (typeof window === "undefined") return false;
  const bridge = (window as typeof window & { ReactNativeWebView?: NativeWebViewBridge }).ReactNativeWebView;
  if (!bridge) return false;
  bridge.postMessage(JSON.stringify(payload));
  return true;
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AuthView = "signin" | "signup" | "forgot" | "verify" | "reset-sent";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "link";
  size?: "md" | "lg";
}

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 w-full",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm hover:shadow-md",
        variant === "outline" && "border border-input bg-background text-foreground hover:bg-muted",
        variant === "ghost" && "text-foreground hover:bg-muted",
        variant === "link" && "text-primary underline-offset-4 hover:underline w-auto",
        size === "md" && "h-11 px-5 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        className
      )}
      {...props}
    />
  );
}

function Field({ label, icon, error, className, id, ...props }: {
  label: string;
  icon?: ReactNode;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = React.useId();
  const inputId = id || generatedId;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={cn(
            "flex h-11 w-full rounded-lg border bg-card px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            icon && "pl-10",
            error && "border-destructive focus-visible:ring-destructive",
            !error && "border-input",
            className
          )}
          {...props}
        />
      </div>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordField({ label, error, ...props }: {
  label: string;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useRegional();
  const [show, setShow] = useState(false);
  const generatedId = React.useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={generatedId} className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          <Lock className="size-4" />
        </div>
        <input
          id={generatedId}
          type={show ? "text" : "password"}
          className={cn(
            "flex h-11 w-full rounded-lg border bg-card px-3.5 py-2.5 pl-10 pr-10 text-sm text-foreground transition-all placeholder:text-muted-foreground/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus-visible:ring-destructive",
            !error && "border-input",
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          tabIndex={-1}
          aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}

function Checkbox({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = React.useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer group">
      <div className={cn(
        "size-4 rounded border-2 flex items-center justify-center transition-colors shrink-0",
        checked ? "bg-primary border-primary" : "border-muted-foreground/40 group-hover:border-muted-foreground/60"
      )}>
        {checked && <CheckCircle2 className="size-3 text-primary-foreground" />}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="text-sm text-body">{label}</span>
    </label>
  );
}

function Alert({ variant = "error", children }: { variant?: "error" | "success" | "warning"; children: ReactNode }) {
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-lg p-3 text-sm",
      variant === "error" && "bg-destructive-bg text-destructive",
      variant === "success" && "bg-success/10 text-success",
      variant === "warning" && "bg-warning/10 text-warning",
    )}>
      <AlertCircle className="size-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function TrustBadges() {
  const { t } = useRegional();
  return (
    <div className="flex items-center justify-center gap-2 mt-6 text-xs text-light-text">
      <span>256-bit encryption</span>
      <span className="text-muted-light">·</span>
      <span>{t('auth.socBadge')}</span>
      <span className="text-muted-light">·</span>
      <span>99.9% uptime</span>
    </div>
  );
}

function LeftPanel() {
  const { t } = useRegional();
  return (
    <div className="hidden lg:flex w-[45%] min-h-screen bg-panel p-10 xl:p-14 flex-col justify-between">
      <div>
        <div className="flex items-center gap-2.5 mb-10">
          <div className="size-9 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-brand font-bold text-lg">T</span>
          </div>
          <span className="font-brand font-bold text-xl text-white/90">TradeOS</span>
        </div>

        <h2 className="font-heading font-bold text-3xl xl:text-4xl text-white leading-tight mb-4">
          Business Operating System
        </h2>
        <p className="text-white/60 text-base leading-relaxed max-w-md">
          Streamline your wholesale and retail operations with real-time analytics, 
          smart inventory management, and enterprise-grade security.
        </p>

        <div className="grid gap-4 mt-10">
          {[
            { icon: BarChart3, title: t('auth.featureAnalytics'), desc: t('auth.featureAnalyticsDesc') },
            { icon: Users, title: t('auth.featureInventory'), desc: t('auth.featureInventoryDesc') },
            { icon: Shield, title: t('auth.featureSecurity'), desc: t('auth.featureSecurityDesc') },
          ].map((item, i) => (
            <div
              key={item.title}
              className="flex items-start gap-3.5 p-4 rounded-xl bg-white/5 border border-white/10 animate-fadeIn"
              style={{ animationDelay: `${200 + i * 100}ms` }}
            >
              <div className="size-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                <item.icon className="size-4.5 text-primary-on-dark" />
              </div>
              <div>
                <p className="font-medium text-sm text-white/90">{item.title}</p>
                <p className="text-xs text-white/50 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-6 pt-8 border-t border-white/10">
        {[
          { value: "10K+", label: t('auth.statBusinesses') },
          { value: "99.9%", label: t('auth.statUptime') },
          { value: "24/7", label: t('auth.statSupport') },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="font-heading font-bold text-lg text-white">{stat.value}</p>
            <p className="text-xs text-white/50">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignInForm({ onNavigate }: { onNavigate: (view: AuthView, data?: { email?: string }) => void }) {
  const { t } = useRegional();
  const router = useRouter();
  const [method, setMethod] = useState<LoginMethod>("email");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (method === "staff") {
        if (!loginId.trim() || !password) throw new Error(t('auth.enterProfileIdPassword'));
        const res = await fetch("/api/identity/staff/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId: loginId.trim(), password }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || t('auth.signInFailed'));
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
        });
        if (setSessionError) throw setSessionError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }

      const { data: userData } = await supabase.auth.getUser();
      let role: string | null = null;
      if (userData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userData.user.id)
          .maybeSingle();
        role = profile?.role ?? null;
        await authorizedFetch("/api/identity/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            register: true,
            deviceName: typeof navigator === "undefined" ? "Web browser" : navigator.userAgent.slice(0, 120),
            rememberDevice: rememberMe,
          }),
        });
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        postToTradeOSMobile({
          type: "tradeos-auth-session",
          accessToken: sessionData.session.access_token,
          refreshToken: sessionData.session.refresh_token,
          role,
          accountMode: method === "staff" ? "employee" : "owner",
        });
      }

      const staffRoles = ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor", "warehouse_staff"];
      if (role && staffRoles.includes(role)) {
        router.push("/salesman");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signInFailed'));
    } finally {
      setLoading(false);
    }
  }, [method, email, loginId, password, rememberMe, router, t]);

  return (
    <form onSubmit={handleSubmit} autoComplete="on" className="animate-slideUp">
      <div className="text-center mb-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.signin.title')}</h1>
        <p className="text-body text-sm mt-1.5">{t('auth.welcomeBack')}</p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1 mb-4">
        {([
          { key: "email", label: t('auth.email') },
          { key: "staff", label: t('auth.profileId') },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setMethod(tab.key); setError(null); }}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              method === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {method === "email" ? (
          <Field
            label={t('auth.email')}
            type="email"
            placeholder="m@example.com"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            icon={<Mail className="size-4" />}
            error={error && (error.includes("email") || error.includes(t('auth.email'))) ? error : null}
          />
        ) : (
          <Field
            label={t('auth.profileId')}
            type="text"
            placeholder="e.g. ALI01"
            required
            autoComplete="username"
            value={loginId}
            onChange={e => setLoginId(e.target.value)}
            icon={<User className="size-4" />}
            error={error && (error.includes("Profile ID") || error.includes(t('auth.profileId'))) ? error : null}
          />
        )}
        <PasswordField
          label={t('auth.signin.password')}
          required
          autoComplete="current-password"
          placeholder={t('auth.enterPassword')}
          value={password}
          onChange={e => setPassword(e.target.value)}
          error={error && !error.includes("email") && !error.includes(t('auth.email')) && !error.includes("Profile ID") && !error.includes(t('auth.profileId')) ? error : null}
        />

        <div className="flex items-center justify-between">
          <Checkbox label={t('auth.keepSignedIn')} checked={rememberMe} onChange={setRememberMe} />
          <button type="button" onClick={() => onNavigate("forgot", { email })} className="text-sm text-primary hover:text-primary-hover transition-colors">
            {t('auth.forgotPassword')}
          </button>
        </div>

        {method === "staff" && (
          <Alert variant="warning">
            Staff sign in with the Profile ID and password your manager gave you.
          </Alert>
        )}

        {error && <Alert>{error}</Alert>}

        <Button type="submit" disabled={loading} size="lg">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? t('auth.signingIn') : t('auth.signInToTradeOs')}
        </Button>
      </div>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-3 text-xs text-light-text">{t('auth.orContinueWith')}</span>
        </div>
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-body mt-6">
        {t('auth.signin.noAccount')}{" "}
        <button type="button" onClick={() => onNavigate("signup")} className="text-primary hover:text-primary-hover font-medium transition-colors">
          {t('auth.signUp')}
        </button>
      </p>
    </form>
  );
}

function SignUpForm({ onNavigate }: { onNavigate: (view: AuthView, data?: { email?: string }) => void }) {
  const { t } = useRegional();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('auth.passwordsMismatch'));
      return;
    }

    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            organization_name: `${fullName.trim().split(" ")[0]}'s Business`,
          },
        },
      });
      if (signUpError) throw signUpError;
      onNavigate("verify", { email });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signUpFailed'));
    } finally {
      setLoading(false);
    }
  }, [fullName, email, password, confirmPassword, router, onNavigate, t]);

  return (
    <form onSubmit={handleSubmit} autoComplete="on" className="animate-slideUp">
      <div className="text-center mb-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.signup.title')}</h1>
        <p className="text-body text-sm mt-1.5">{t('auth.getStartedFree')}</p>
      </div>

      <div className="grid gap-4">
        <Field
          label={t('auth.fullName')}
          type="text"
          placeholder="John Doe"
          required
          autoComplete="name"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          icon={<User className="size-4" />}
        />
        <Field
          label={t('auth.email')}
          type="email"
          placeholder="m@example.com"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          icon={<Mail className="size-4" />}
        />
        <PasswordField
          label={t('auth.signin.password')}
          required
          autoComplete="new-password"
          placeholder={t('auth.createPassword')}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <PasswordField
          label={t('auth.confirmPassword')}
          required
          autoComplete="new-password"
          placeholder={t('auth.confirmPasswordPlaceholder')}
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
        />

        {error && <Alert>{error}</Alert>}

        <Button type="submit" disabled={loading} size="lg">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? t('auth.creatingAccount') : t('auth.signup.submit')}
        </Button>
      </div>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-3 text-xs text-light-text">{t('auth.orContinueWith')}</span>
        </div>
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-body mt-6">
        {t('auth.signup.hasAccount')}{" "}
        <button type="button" onClick={() => onNavigate("signin")} className="text-primary hover:text-primary-hover font-medium transition-colors">
          {t('auth.signup.signinLink')}
        </button>
      </p>
    </form>
  );
}

function ForgotPasswordForm({ onNavigate, initialEmail }: { onNavigate: (view: AuthView, data?: { email?: string }) => void; initialEmail?: string }) {
  const { t } = useRegional();
  const [email, setEmail] = useState(initialEmail || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) { setError(t('auth.enterEmail')); return; }
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (resetError) throw resetError;
      onNavigate("reset-sent", { email });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.resetLinkFailed'));
    } finally {
      setLoading(false);
    }
  }, [email, onNavigate, t]);

  return (
    <form onSubmit={handleSubmit} className="animate-slideUp">
      <div className="text-center mb-6">
        <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
          <Lock className="size-6 text-primary" />
        </div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.forgotPassword')}</h1>
        <p className="text-body text-sm mt-1.5">{t('auth.forgotSubtitle')}</p>
      </div>

      <div className="grid gap-4">
        <Field
          label={t('auth.email')}
          type="email"
          placeholder="m@example.com"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          icon={<Mail className="size-4" />}
          error={error}
        />

        <Button type="submit" disabled={loading} size="lg">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? t('auth.sending') : t('auth.sendResetLink')}
        </Button>
      </div>

      <button type="button" onClick={() => onNavigate("signin")} className="flex items-center justify-center gap-1.5 text-sm text-body hover:text-foreground transition-colors mt-6 mx-auto">
        <ArrowLeft className="size-4" />
        {t('auth.backToSignIn')}
      </button>
    </form>
  );
}

function VerifyEmail({ email, onNavigate }: { email?: string; onNavigate: (view: AuthView, data?: { email?: string }) => void }) {
  const { t } = useRegional();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = useCallback(async () => {
    if (!email) return;
    setResending(true);
    try {
      await supabase.auth.resend({ type: "signup", email });
      setResent(true);
    } catch {
      // silently fail
    } finally {
      setResending(false);
    }
  }, [email]);

  return (
    <div className="animate-slideUp">
      <div className="text-center mb-6">
        <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
          <Mail className="size-6 text-primary" />
        </div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.verifyEmail')}</h1>
        {email && (
          <p className="text-body text-sm mt-1.5">
            We&apos;ve sent a verification link to <span className="font-medium text-foreground">{email}</span>
          </p>
        )}
      </div>

      <Alert variant="warning">
        {t('auth.didntReceive')}
      </Alert>

      <div className="mt-6 grid gap-3">
        <Button variant="outline" onClick={handleResend} disabled={resending || resent}>
          {resending ? <Loader2 className="size-4 animate-spin" /> : null}
          {resent ? t('auth.verificationSent') : t('auth.resendVerification')}
        </Button>
      </div>

      <button type="button" onClick={() => onNavigate("signin")} className="flex items-center justify-center gap-1.5 text-sm text-body hover:text-foreground transition-colors mt-6 mx-auto">
        <ArrowLeft className="size-4" />
        {t('auth.backToSignIn')}
      </button>
    </div>
  );
}

function ResetSent({ email, onNavigate }: { email?: string; onNavigate: (view: AuthView) => void }) {
  const { t } = useRegional();
  return (
    <div className="animate-slideUp">
      <div className="text-center mb-6">
        <div className="mx-auto mb-4 size-14 rounded-full bg-primary-light flex items-center justify-center">
          <CheckCircle2 className="size-6 text-primary" />
        </div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('auth.checkInbox')}</h1>
        {email && (
          <p className="text-body text-sm mt-1.5">
            We&apos;ve sent a password reset link to <span className="font-medium text-foreground">{email}</span>.
            {t('auth.checkInboxInstructions')}
          </p>
        )}
      </div>

      <Button onClick={() => onNavigate("signin")} size="lg">
        {t('auth.backToSignIn')}
      </Button>
    </div>
  );
}

function GoogleButton() {
  const { t } = useRegional();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (postToTradeOSMobile({ type: "tradeos-google-sign-in" })) {
        setLoading(false);
        return;
      }
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.googleFailed'));
      setLoading(false);
    }
  }, [t]);

  return (
    <div className="grid gap-2">
      <Button variant="outline" type="button" onClick={handleClick} disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <svg className="size-4" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        {loading ? t('auth.connecting') : t('auth.signin.google')}
      </Button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

interface AuthUIProps {
  defaultMode?: "signin" | "signup";
}

export function AuthUI({ defaultMode = "signin" }: AuthUIProps) {
  const [view, setView] = useState<AuthView>(defaultMode);
  const [email, setEmail] = useState<string>("");

  const handleNavigate = useCallback((newView: AuthView, data?: { email?: string }) => {
    if (data?.email) setEmail(data.email);
    setView(newView);
  }, []);

  return (
    <div className="min-h-screen flex">
      <style>{`
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear { display: none; }
      `}</style>

      <LeftPanel />

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8 relative">
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden text-center mb-8 animate-fadeIn">
            <div className="inline-flex items-center gap-2">
              <div className="size-9 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-brand font-bold text-lg">T</span>
              </div>
              <span className="font-brand font-bold text-xl text-foreground">TradeOS</span>
            </div>
          </div>

          <div
            key={view}
            className="bg-card rounded-[18px] border border-border p-6 sm:p-8 shadow-[0_2px_12px_rgba(45,41,38,0.08)]"
          >
            {view === "signin" && <SignInForm onNavigate={handleNavigate} />}
            {view === "signup" && <SignUpForm onNavigate={handleNavigate} />}
            {view === "forgot" && <ForgotPasswordForm onNavigate={handleNavigate} initialEmail={email} />}
            {view === "verify" && <VerifyEmail email={email} onNavigate={handleNavigate} />}
            {view === "reset-sent" && <ResetSent email={email} onNavigate={handleNavigate} />}
          </div>

          <TrustBadges />
        </div>
      </div>
    </div>
  );
}
