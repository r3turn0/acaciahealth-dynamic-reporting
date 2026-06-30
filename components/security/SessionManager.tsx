"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Monitor,
  Smartphone,
  MapPin,
  Shield,
  AlertTriangle,
  Clock,
  Wifi,
  WifiOff,
  XCircle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/components/auth/LoginPage";

interface Session {
  id: string;
  user: string;
  device: string;
  os: string;
  location: string;
  ip: string;
  vpn: boolean;
  mfa: string;
  aal: string;
  started: string;
  last_active: string;
  expires: string;
  risk: "low" | "medium" | "high";
  current: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeLeft(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m remaining`;
  return `${Math.floor(min / 60)}h ${min % 60}m remaining`;
}

function isExpired(iso: string) {
  return new Date(iso).getTime() < Date.now();
}

const RISK_CONFIG = {
  low: { label: "Low Risk", color: "text-chart-3", bg: "bg-chart-3/10 border-chart-3/30" },
  medium: { label: "Medium Risk", color: "text-chart-5", bg: "bg-chart-5/10 border-chart-5/30" },
  high: { label: "High Risk", color: "text-destructive", bg: "bg-destructive/10 border-destructive/30" },
};

// ── Inactivity timeout warning ─────────────────────────────────────────────────

function InactivityWarning({ onDismiss, onExtend }: { onDismiss: () => void; onExtend: () => void }) {
  const [countdown, setCountdown] = useState(120);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(t); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-card border border-chart-5/50 rounded-xl shadow-2xl p-4 animate-in slide-in-from-bottom-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-chart-5/15 flex items-center justify-center shrink-0">
          <Clock className="w-5 h-5 text-chart-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Session Expiring Soon</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Your session will expire due to inactivity in{" "}
            <span className="text-chart-5 font-semibold">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</span>
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onExtend}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          Extend Session
        </button>
        <button
          onClick={onDismiss}
          className="py-2 px-3 rounded-lg bg-muted border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onRevoke,
  onReauth,
  revoking,
}: {
  session: Session;
  onRevoke: (id: string) => void;
  onReauth: (id: string) => void;
  revoking: string | null;
}) {
  const risk = RISK_CONFIG[session.risk];
  const expired = isExpired(session.expires);
  const isDesktop = session.os.toLowerCase().includes("mac") || session.os.toLowerCase().includes("windows");

  return (
    <div
      className={cn(
        "bg-card border rounded-xl p-4 transition-all",
        session.current ? "border-primary/40 shadow-[0_0_0_1px_oklch(0.65_0.14_195/0.15)]" : "border-border",
        expired && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Device icon */}
        <div className="w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
          {isDesktop ? <Monitor className="w-5 h-5 text-muted-foreground" /> : <Smartphone className="w-5 h-5 text-muted-foreground" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{session.device}</p>
            {session.current && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25 shrink-0">
                Current
              </span>
            )}
            {expired && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border shrink-0">
                Expired
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{session.os}</p>
        </div>

        {/* Risk badge */}
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0", risk.bg, risk.color)}>
          {risk.label}
        </span>
      </div>

      {/* Details grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[
          { icon: MapPin, label: `${session.location} (${session.ip})` },
          { icon: session.vpn ? Wifi : WifiOff, label: session.vpn ? "VPN Connected" : "No VPN", warn: !session.vpn },
          { icon: Shield, label: `${session.mfa} · ${session.aal}` },
          { icon: Clock, label: `Active ${timeAgo(session.last_active)}` },
        ].map(({ icon: Icon, label, warn }) => (
          <div key={label} className="flex items-center gap-1.5">
            <Icon className={cn("w-3.5 h-3.5 shrink-0", warn ? "text-chart-5" : "text-muted-foreground")} />
            <span className={cn("text-[11px] truncate", warn ? "text-chart-5" : "text-muted-foreground")}>{label}</span>
          </div>
        ))}
      </div>

      {/* Expiry */}
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
        <span className={cn("text-[11px]", expired ? "text-muted-foreground" : "text-muted-foreground")}>
          {expired ? "Session expired" : timeLeft(session.expires)}
        </span>

        <div className="flex items-center gap-2">
          {!expired && !session.current && (
            <button
              onClick={() => onReauth(session.id)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
            >
              <RefreshCw className="w-3 h-3" />
              Re-auth
            </button>
          )}
          {!session.current && (
            <button
              onClick={() => onRevoke(session.id)}
              disabled={revoking === session.id}
              className="flex items-center gap-1 text-[11px] text-destructive hover:text-destructive/80 transition-colors px-2 py-1 rounded border border-destructive/30 hover:border-destructive/60 disabled:opacity-50"
            >
              {revoking === session.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              Revoke
            </button>
          )}
          {session.current && (
            <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded border border-border">
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          )}
        </div>
      </div>

      {/* High risk warning */}
      {session.risk === "high" && !expired && (
        <div className="mt-2 flex items-center gap-2 bg-destructive/8 border border-destructive/20 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-[11px] text-destructive">
            Suspicious activity detected — location outside normal pattern. Consider revoking.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main SessionManager ───────────────────────────────────────────────────────

export function SessionManager({ currentUser }: { currentUser?: AuthUser }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [showWarning, setShowWarning] = useState(true);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : "";
      const res = await fetch(`/api/auth/sessions${params}`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: id }),
      });
      setRevoked((prev) => new Set([...prev, id]));
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setRevoking(null);
    }
  }

  function handleReauth(id: string) {
    alert(`Step-up authentication initiated for session ${id}. User will be prompted to re-authenticate via MFA.`);
  }

  const active = sessions.filter((s) => !isExpired(s.expires));
  const expired = sessions.filter((s) => isExpired(s.expires));
  const highRisk = active.filter((s) => s.risk === "high");

  return (
    <div className="flex flex-col gap-6">
      {/* Inactivity warning toast */}
      {showWarning && (
        <InactivityWarning
          onDismiss={() => setShowWarning(false)}
          onExtend={() => setShowWarning(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Session Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor and control all active sessions. Revoke or force re-authentication at any time.
          </p>
        </div>
        <button
          onClick={loadSessions}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-primary/40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Sessions", value: active.length, icon: CheckCircle2, color: "text-chart-3" },
          { label: "High Risk", value: highRisk.length, icon: AlertTriangle, color: "text-destructive" },
          { label: "No VPN", value: active.filter((s) => !s.vpn).length, icon: WifiOff, color: "text-chart-5" },
          { label: "Expired", value: expired.length, icon: XCircle, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
            <div className={cn("w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0", color)}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* High risk alert */}
      {highRisk.length > 0 && (
        <div className="flex items-start gap-3 bg-destructive/8 border border-destructive/30 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              {highRisk.length} High-Risk Session{highRisk.length > 1 ? "s" : ""} Detected
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Suspicious login patterns detected (impossible travel, unknown device). Review and revoke immediately.
            </p>
          </div>
        </div>
      )}

      {/* Active sessions */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Active Sessions ({active.length})
          </p>
          {active.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onRevoke={handleRevoke}
              onReauth={handleReauth}
              revoking={revoking}
            />
          ))}

          {expired.length > 0 && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">
                Expired Sessions ({expired.length})
              </p>
              {expired.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onRevoke={handleRevoke}
                  onReauth={handleReauth}
                  revoking={revoking}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Policy note */}
      <div className="bg-muted/40 border border-border rounded-xl p-4 text-xs text-muted-foreground leading-relaxed">
        <span className="text-foreground font-medium">Session Policy: </span>
        Sessions expire after 60 minutes of inactivity (NIST 800-63B §7.1). Continuous Access Evaluation (CAE)
        revokes tokens in real time if device compliance or location conditions change. All revocations are
        logged to the immutable audit trail and forwarded to Azure Sentinel.
      </div>
    </div>
  );
}
