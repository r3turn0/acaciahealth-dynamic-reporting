"use client";

import { useState, useRef, useEffect } from "react";
import {
  Shield,
  Fingerprint,
  Key,
  Smartphone,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Heart,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AuthMethod = "sso" | "passwordless" | "totp" | "push" | "fido2";
type AuthStep = "method" | "credentials" | "mfa" | "complete" | "blocked";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  mfa_method: string;
  aal: string;
  device_compliant: boolean;
  last_login: string;
}

interface LoginPageProps {
  onAuthenticated?: (user: AuthUser) => void;
  onConditionalAccessBlocked?: (reason: string) => void;
}

const RISK_CONTEXT = {
  device: "MacBook Pro 14\" \u2014 Chrome 125",
  location: "Los Angeles, CA",
  network: "Corporate VPN (10.0.1.0/24)",
  compliance: "Compliant (Intune)",
  trust_level: "high",
};

export function LoginPage({ onAuthenticated, onConditionalAccessBlocked }: LoginPageProps) {
  const [step, setStep] = useState<AuthStep>("method");
  const [method, setMethod] = useState<AuthMethod | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  async function callValidate(payload: Record<string, string>) {
    const res = await fetch("/api/auth/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === "DEVICE_NON_COMPLIANT" || data.error === "NETWORK_NOT_ALLOWED") {
        onConditionalAccessBlocked?.(data.error);
        setStep("blocked");
      } else {
        setError(data.message ?? "Authentication failed.");
      }
      return null;
    }
    return data.user as AuthUser;
  }

  async function handleMethodSelect(m: AuthMethod) {
    setMethod(m);
    setError(null);

    if (m === "sso" || m === "passwordless") {
      setLoading(true);
      try {
        const u = await callValidate({ method: m, token: "mock_entra_token" });
        if (u) {
          setUser(u);
          setRedirecting(true);
          setStep("complete");
          setTimeout(() => onAuthenticated?.(u), 1200);
        }
      } catch {
        setError("Connection failed. Please try again.");
      } finally {
        setLoading(false);
      }
    } else {
      // email + password → go to credentials step
      setStep("credentials");
    }
  }

  async function handleCredentialsSubmit() {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Validate credentials first (returns partial session without MFA)
      const res = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "credentials", email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "DEVICE_NON_COMPLIANT" || data.error === "NETWORK_NOT_ALLOWED") {
          onConditionalAccessBlocked?.(data.error);
          setStep("blocked");
        } else {
          setError(data.message ?? "Invalid credentials.");
        }
        return;
      }
      // Credentials OK — proceed to MFA
      setStep("mfa");
    } catch {
      setError("Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit() {
    if (!totpCode.trim() && method !== "push" && method !== "fido2") return;
    setLoading(true);
    setError(null);
    try {
      const u = await callValidate({
        method: method ?? "totp",
        mfa_code: totpCode || "mock_approved",
        email: email.trim(),
      });
      if (u) {
        setUser(u);
        setRedirecting(true);
        setStep("complete");
        setTimeout(() => onAuthenticated?.(u), 1200);
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background grid */}
      <div className="fixed inset-0 bg-[linear-gradient(oklch(1_0_0/3%)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/3%)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 mb-4">
            <Heart className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground text-center">AcaciaHealth Reporting</h1>
          <p className="text-xs text-muted-foreground mt-1 text-center">HIPAA-Compliant Dynamic Reporting Engine</p>
        </div>

        {/* Risk context strip */}
        <div className="flex items-center gap-2 bg-card/60 border border-border rounded-lg px-3 py-2 mb-4 text-[11px] text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-chart-3 shrink-0" />
          <span className="truncate">{RISK_CONTEXT.device}</span>
          <span className="text-border">|</span>
          <span className="text-chart-3 font-medium shrink-0">{RISK_CONTEXT.compliance}</span>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
          {step === "method" && (
            <MethodSelector
              loading={loading}
              error={error}
              onSelect={handleMethodSelect}
            />
          )}
          {step === "credentials" && method && (
            <CredentialsForm
              method={method}
              email={email}
              password={password}
              showPassword={showPassword}
              loading={loading}
              error={error}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
              onSubmit={handleCredentialsSubmit}
              onBack={() => { setStep("method"); setError(null); setMethod(null); }}
            />
          )}
          {step === "mfa" && method && (
            <MfaChallenge
              method={method}
              loading={loading}
              error={error}
              totpCode={totpCode}
              onTotpChange={setTotpCode}
              onSubmit={handleMfaSubmit}
              onBack={() => { setStep("credentials"); setError(null); setTotpCode(""); }}
            />
          )}
          {step === "complete" && user && <AuthSuccess user={user} redirecting={redirecting} />}
          {step === "blocked" && (
            <ConditionalAccessBlocked
              reason="DEVICE_NON_COMPLIANT"
              onRetry={() => { setStep("method"); setError(null); }}
            />
          )}
        </div>

        {/* Demo hint */}
        <div className="mt-4 bg-card/60 border border-border rounded-lg px-4 py-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Demo credentials</p>
          <p>admin@acaciahealth.org / admin123 &mdash; <span className="text-primary">Admin</span></p>
          <p>analyst@acaciahealth.org / analyst123 &mdash; <span className="text-muted-foreground">Analyst</span></p>
          <p className="mt-1 opacity-70">Or use Azure AD SSO / Passwordless above for instant access.</p>
        </div>

        {/* Security badges */}
        <div className="flex items-center justify-center gap-4 mt-4">
          {[
            { icon: Lock, label: "TLS 1.3" },
            { icon: Shield, label: "HIPAA" },
            { icon: Key, label: "FIPS 140-3" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Icon className="w-3 h-3 text-primary/60" />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Method selector ────────────────────────────────────────────────────────────

function MethodSelector({
  loading,
  error,
  onSelect,
}: {
  loading: boolean;
  error: string | null;
  onSelect: (m: AuthMethod) => void;
}) {
  const methods = [
    {
      id: "sso" as AuthMethod,
      icon: Shield,
      label: "Sign in with Azure AD",
      desc: "Single Sign-On via Entra ID (OIDC)",
      badge: "Recommended",
      color: "text-primary",
    },
    {
      id: "passwordless" as AuthMethod,
      icon: Fingerprint,
      label: "Passwordless / Passkey",
      desc: "FIDO2 / WebAuthn biometric or hardware key",
      badge: "AAL3",
      color: "text-chart-3",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Secure Sign In</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Zero Trust &mdash; MFA required on every session.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {methods.map(({ id, icon: Icon, label, desc, badge, color }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            disabled={loading}
            className="flex items-center gap-3 p-3.5 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
          >
            <div className={cn("w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0", color)}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">{badge}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{desc}</p>
            </div>
            {loading ? (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            )}
          </button>
        ))}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-[11px]">
          <span className="px-2 bg-card text-muted-foreground">or continue with email + MFA</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {[
          { id: "totp" as AuthMethod, icon: Smartphone, label: "Authenticator App (TOTP)", badge: "AAL2" },
          { id: "push" as AuthMethod, icon: Smartphone, label: "Push Notification", badge: "AAL2" },
          { id: "fido2" as AuthMethod, icon: Key, label: "Hardware Key (FIDO2)", badge: "AAL3" },
        ].map(({ id, icon: Icon, label, badge }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            disabled={loading}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
          >
            <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
              <Icon className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm text-foreground flex-1">{label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border shrink-0">{badge}</span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Credentials form ───────────────────────────────────────────────────────────

function CredentialsForm({
  method,
  email,
  password,
  showPassword,
  loading,
  error,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit,
  onBack,
}: {
  method: AuthMethod;
  email: string;
  password: string;
  showPassword: boolean;
  loading: boolean;
  error: string | null;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onTogglePassword: () => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { emailRef.current?.focus(); }, []);

  const mfaLabel: Record<AuthMethod, string> = {
    totp: "Authenticator App (TOTP)",
    push: "Push Notification",
    fido2: "Hardware Key (FIDO2)",
    sso: "Azure AD SSO",
    passwordless: "Passkey",
  };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
        Back
      </button>

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Enter Credentials</h2>
          <p className="text-[11px] text-muted-foreground">
            MFA: <span className="text-foreground font-medium">{mfaLabel[method]}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">Email</label>
          <input
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit(); }}
            placeholder="user@acaciahealth.org"
            className="bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit(); }}
              placeholder="Password"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-10"
            />
            <button
              type="button"
              onClick={onTogglePassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !email.trim() || !password.trim()}
        className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Continue to MFA
      </button>
    </div>
  );
}

// ── MFA challenge ─────────────────────────────────────────────────────────────

function MfaChallenge({
  method,
  loading,
  error,
  totpCode,
  onTotpChange,
  onSubmit,
  onBack,
}: {
  method: AuthMethod;
  loading: boolean;
  error: string | null;
  totpCode: string;
  onTotpChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const config = ({
    totp: {
      icon: Smartphone,
      title: "Enter Authenticator Code",
      desc: "Open your authenticator app and enter the 6-digit code.",
      inputLabel: "6-digit code",
      placeholder: "000 000",
      cta: "Verify",
    },
    push: {
      icon: Smartphone,
      title: "Approve Push Notification",
      desc: "A sign-in request has been sent to your registered mobile device. Tap Approve when prompted.",
      inputLabel: null,
      placeholder: null,
      cta: "I Approved",
    },
    fido2: {
      icon: Key,
      title: "Insert Hardware Key",
      desc: "Insert your FIDO2 hardware key and touch it when it blinks.",
      inputLabel: null,
      placeholder: null,
      cta: "Activate Key",
    },
  } as Record<string, { icon: typeof Smartphone; title: string; desc: string; inputLabel: string | null; placeholder: string | null; cta: string }>)[method] ?? {
    icon: Shield,
    title: "Multi-Factor Authentication",
    desc: "Complete the MFA challenge.",
    inputLabel: "Code",
    placeholder: "Enter code",
    cta: "Verify",
  };

  const Icon = config.icon;

  return (
    <div className="flex flex-col gap-5">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
        Back
      </button>

      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Icon className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">{config.desc}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {config.inputLabel && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground font-medium">{config.inputLabel}</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder={config.placeholder ?? ""}
            value={totpCode}
            onChange={(e) => onTotpChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit(); }}
            className="bg-muted border border-border rounded-lg px-4 py-3 text-xl font-mono text-center tracking-[0.5em] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            maxLength={7}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground text-center">
            In demo mode, any 6-digit code is accepted.
          </p>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={loading || (!!config.inputLabel && totpCode.length < 6)}
        className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {config.cta}
      </button>

      <p className="text-[11px] text-muted-foreground text-center">
        Authentication Assurance Level:{" "}
        <span className="text-primary font-medium">{method === "fido2" ? "AAL3" : "AAL2"}</span>
        {" \u00b7 "}Session expires in <span className="text-primary font-medium">60 min</span>
      </p>
    </div>
  );
}

// ── Auth success ───────────────────────────────────────────────────────────────

function AuthSuccess({ user, redirecting }: { user: AuthUser; redirecting: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-14 h-14 rounded-full bg-chart-3/15 border border-chart-3/40 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-chart-3" />
      </div>
      <div className="text-center">
        <h2 className="text-sm font-semibold text-foreground">Authentication Successful</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Signed in as <span className="text-foreground font-medium">{user.email}</span>
        </p>
      </div>
      <div className="w-full bg-muted rounded-lg p-3 flex flex-col gap-1.5 text-[11px]">
        {[
          ["Role", user.role],
          ["AAL", user.aal],
          ["MFA Method", user.mfa_method],
          ["Device", "Compliant (Intune)"],
          ["Session", "60 min, CAE enabled"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-foreground font-medium">{v}</span>
          </div>
        ))}
      </div>
      {redirecting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Redirecting to dashboard...
        </div>
      )}
    </div>
  );
}

// ── Conditional access blocked ─────────────────────────────────────────────────

function ConditionalAccessBlocked({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const config = ({
    DEVICE_NON_COMPLIANT: {
      title: "Device Not Compliant",
      desc: "Your device does not meet the Intune compliance policy required to access this system.",
      actions: [
        { label: "Register Device", variant: "primary" },
        { label: "Retry", variant: "secondary", onClick: onRetry },
      ],
    },
    NETWORK_NOT_ALLOWED: {
      title: "Network Access Blocked",
      desc: "You are outside the corporate network. Connect to the VPN to continue.",
      actions: [
        { label: "Connect to VPN", variant: "primary" },
        { label: "Retry", variant: "secondary", onClick: onRetry },
      ],
    },
  } as Record<string, { title: string; desc: string; actions: { label: string; variant: string; onClick?: () => void }[] }>)[reason] ?? {
    title: "Access Blocked",
    desc: "Your access attempt did not meet the required security conditions.",
    actions: [{ label: "Retry", variant: "secondary", onClick: onRetry }],
  };

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-destructive" />
      </div>
      <div className="text-center">
        <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">{config.desc}</p>
      </div>
      <div className="w-full bg-destructive/8 border border-destructive/20 rounded-lg p-3 text-[11px] text-muted-foreground">
        This event has been logged to the immutable audit trail and forwarded to Azure Sentinel.
      </div>
      <div className="flex gap-2 w-full">
        {config.actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick ?? onRetry}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors",
              a.variant === "primary"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted border border-border text-foreground hover:bg-accent"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
