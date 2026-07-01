"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  Users,
  Network,
  Key,
  AlertTriangle,
  ChevronRight,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RefreshCw,
  Loader2,
  Eye,
  FlameKindling,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/components/auth/LoginPage";

type AdminTab = "rbac" | "policies" | "allowlist" | "pam" | "breakglass";

interface Role {
  id: string;
  name: string;
  description: string;
  level: string;
  permissions: string[];
  datasets: string[];
  mfa_required: string;
  sod_conflicts: string[];
  users: number;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  last_login: string;
  mfa: string;
  status: "active" | "suspended";
}

interface CaPolicy {
  id: string;
  name: string;
  enabled: boolean;
  conditions: string;
  grant: string;
  last_modified: string;
}

const LEVEL_CONFIG: Record<string, { color: string; bg: string }> = {
  privileged: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30" },
  standard: { color: "text-primary", bg: "bg-primary/10 border-primary/30" },
  basic: { color: "text-muted-foreground", bg: "bg-muted border-border" },
};

const IP_ALLOWLIST = [
  { id: "ip_001", cidr: "10.0.0.0/8", label: "Corporate Network", enabled: true },
  { id: "ip_002", cidr: "172.16.0.0/12", label: "VPN Pool", enabled: true },
  { id: "ip_003", cidr: "192.168.1.0/24", label: "LA Office", enabled: true },
  { id: "ip_004", cidr: "203.0.113.0/24", label: "Seattle Office", enabled: false },
];

const PAM_REQUESTS = [
  { id: "pam_001", user: "mchen@acaciahealth.org", resource: "/admin/roles", reason: "Emergency role update — prod incident", requested: "2025-06-29T08:14:00Z", expires: "2025-06-29T12:14:00Z", status: "approved", approver: "jokafor@acaciahealth.org" },
  { id: "pam_002", user: "adonovan@acaciahealth.org", resource: "dataset:revenue_raw", reason: "Quarterly audit data pull", requested: "2025-06-28T14:30:00Z", expires: "2025-06-28T18:30:00Z", status: "pending", approver: null },
  { id: "pam_003", user: "mwebb@acaciahealth.org", resource: "/admin/users", reason: "Role reassignment request", requested: "2025-06-27T10:00:00Z", expires: "2025-06-27T14:00:00Z", status: "denied", approver: "mchen@acaciahealth.org" },
];

const BREAK_GLASS_LOG = [
  { id: "bg_001", user: "mchen@acaciahealth.org", reason: "Production incident — data pipeline failure", approver: "jokafor@acaciahealth.org", invoked: "2025-06-29T09:00:00Z", expired: "2025-06-29T13:00:00Z", actions: 7 },
  { id: "bg_002", user: "mchen@acaciahealth.org", reason: "Emergency compliance report — regulator request", approver: "external_approver@acaciahealth.org", invoked: "2025-03-15T02:00:00Z", expired: "2025-03-15T06:00:00Z", actions: 3 },
];

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ id, label, icon: Icon, active, onClick }: { id: string; label: string; icon: React.ElementType; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
        active ? "bg-primary/15 text-primary border border-primary/25" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );
}

// ── RBAC panel ────────────────────────────────────────────────────────────────

function RbacPanel({ roles, users }: { roles: Role[]; users: User[] }) {
  const [activeRole, setActiveRole] = useState<Role | null>(roles[0] ?? null);
  const [tab, setTab] = useState<"roles" | "users">("roles");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {(["roles", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
              tab === t ? "bg-card border border-border text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "roles" ? `Roles (${roles.length})` : `Users (${users.length})`}
          </button>
        ))}
      </div>

      {tab === "roles" && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-2">
            {roles.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRole(r)}
                className={cn(
                  "text-left p-3 rounded-xl border transition-all",
                  activeRole?.id === r.id ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:border-primary/25"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{r.name}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", LEVEL_CONFIG[r.level]?.bg ?? "", LEVEL_CONFIG[r.level]?.color ?? "")}>
                    {r.level}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.users} user{r.users !== 1 ? "s" : ""} · {r.mfa_required}</p>
              </button>
            ))}
            <button className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              New Role
            </button>
          </div>

          {activeRole && (
            <div className="lg:col-span-3 bg-card border border-border rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{activeRole.name}</h3>
                <div className="flex items-center gap-2">
                  <button className="p-1.5 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 rounded border border-border hover:border-destructive/40 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{activeRole.description}</p>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Permissions</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeRole.permissions.map((p) => (
                    <span key={p} className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/8 text-primary border border-primary/20">{p}</span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Dataset Access</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeRole.datasets.map((d) => (
                    <span key={d} className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted text-foreground border border-border">{d}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="bg-muted rounded-lg p-2.5">
                  <p className="text-muted-foreground">MFA Required</p>
                  <p className="text-primary font-semibold mt-0.5">{activeRole.mfa_required}</p>
                </div>
                <div className="bg-muted rounded-lg p-2.5">
                  <p className="text-muted-foreground">SoD Conflicts</p>
                  <p className="text-chart-5 font-semibold mt-0.5">
                    {activeRole.sod_conflicts.length > 0 ? activeRole.sod_conflicts.join(", ") : "None"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["User", "Role", "Department", "MFA", "Last Login", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-3">
                    <p className="text-sm text-foreground font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{u.role}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{u.department}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground font-mono">{u.mfa}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(u.last_login).toLocaleString()}</td>
                  <td className="px-3 py-3">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", u.status === "active" ? "bg-chart-3/15 text-chart-3" : "bg-destructive/15 text-destructive")}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CA Policies panel ─────────────────────────────────────────────────────────

function PoliciesPanel({ policies }: { policies: CaPolicy[] }) {
  const [items, setItems] = useState(policies);

  function toggle(id: string) {
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
          Conditional Access Policies enforce Zero Trust principles. Changes are logged immutably and take effect within 60 seconds.
        </p>
        <button className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          New Policy
        </button>
      </div>

      {items.map((p) => (
        <div key={p.id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
          <div className="mt-0.5">
            <button
              onClick={() => toggle(p.id)}
              className={cn(
                "w-10 h-6 rounded-full border-2 transition-colors relative shrink-0",
                p.enabled ? "bg-primary border-primary" : "bg-muted border-border"
              )}
            >
              <div className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                p.enabled ? "left-4" : "left-0.5"
              )} />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-foreground">{p.name}</p>
              {!p.enabled && <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">Disabled</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Condition</p>
                <p className="text-xs text-foreground mt-0.5">{p.conditions}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Grant / Block</p>
                <p className="text-xs text-foreground mt-0.5">{p.grant}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="p-1.5 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── IP Allowlist panel ────────────────────────────────────────────────────────

function AllowlistPanel() {
  const [entries, setEntries] = useState(IP_ALLOWLIST);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
          Only traffic from these CIDR ranges can reach the API gateway. All other IPs are silently dropped at the perimeter.
        </p>
        <button className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          Add CIDR
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["CIDR Range", "Label", "Status", ""].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-3 font-mono text-sm text-primary">{e.cidr}</td>
                <td className="px-3 py-3 text-sm text-foreground">{e.label}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    {e.enabled ? (
                      <><CheckCircle2 className="w-3.5 h-3.5 text-chart-3" /><span className="text-xs text-chart-3">Allowed</span></>
                    ) : (
                      <><XCircle className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Disabled</span></>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEntries((prev) => prev.map((x) => x.id === e.id ? { ...x, enabled: !x.enabled } : x))}
                      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {e.enabled ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button className="p-1 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PAM panel ─────────────────────────────────────────────────────────────────

function PamPanel() {
  const [requests, setRequests] = useState(PAM_REQUESTS);

  function decide(id: string, decision: "approved" | "denied") {
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: decision } : r));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
        Privileged Access Management enforces just-in-time access elevation with dual-approval and automatic expiry.
        All PAM events are forwarded to Azure Sentinel.
      </p>

      {requests.map((r) => {
        const statusConfig = {
          approved: { color: "text-chart-3", bg: "bg-chart-3/10 border-chart-3/30", icon: CheckCircle2 },
          denied: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", icon: XCircle },
          pending: { color: "text-chart-5", bg: "bg-chart-5/10 border-chart-5/30", icon: AlertTriangle },
        }[r.status] ?? { color: "text-muted-foreground", bg: "bg-muted border-border", icon: AlertTriangle };

        const Icon = statusConfig.icon;

        return (
          <div key={r.id} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{r.user}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Resource: <span className="font-mono text-primary">{r.resource}</span>
                </p>
              </div>
              <span className={cn("flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border", statusConfig.bg, statusConfig.color)}>
                <Icon className="w-3.5 h-3.5" />
                {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
              </span>
            </div>

            <div className="bg-muted rounded-lg p-2.5 text-xs text-muted-foreground leading-relaxed">
              <span className="text-foreground font-medium">Reason: </span>{r.reason}
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Requested: {new Date(r.requested).toLocaleString()}</span>
              <span>Expires: {new Date(r.expires).toLocaleTimeString()}</span>
            </div>

            {r.status === "pending" && (
              <div className="flex gap-2">
                <button
                  onClick={() => decide(r.id, "approved")}
                  className="flex-1 py-2 rounded-lg bg-chart-3/15 text-chart-3 border border-chart-3/30 text-xs font-medium hover:bg-chart-3/25 transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(r.id, "denied")}
                  className="flex-1 py-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/30 text-xs font-medium hover:bg-destructive/20 transition-colors"
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Break-glass panel ─────────────────────────────────────────────────────────

function BreakGlassPanel() {
  const [invoking, setInvoking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");

  async function invoke() {
    if (!reason.trim()) return;
    setInvoking(true);
    await new Promise((r) => setTimeout(r, 1500));
    setInvoking(false);
    setConfirmed(true);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Warning */}
      <div className="flex items-start gap-3 bg-destructive/8 border border-destructive/30 rounded-xl p-4">
        <FlameKindling className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-destructive">Break-Glass Emergency Access</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            This bypasses all Conditional Access policies and grants temporary unrestricted access.
            Every action taken during a break-glass session is immutably logged and immediately reported
            to the compliance team. Dual-approval required. Auto-expires in 4 hours.
          </p>
        </div>
      </div>

      {/* Invoke form */}
      {!confirmed ? (
        <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">Invoke Break-Glass Access</h3>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Reason (required for audit log)</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the emergency justification..."
              className="bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive resize-none"
            />
          </div>
          <button
            onClick={invoke}
            disabled={invoking || !reason.trim()}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-white text-sm font-medium hover:bg-destructive/80 transition-colors disabled:opacity-50"
          >
            {invoking ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlameKindling className="w-4 h-4" />}
            {invoking ? "Requesting dual approval..." : "Request Break-Glass Access"}
          </button>
        </div>
      ) : (
        <div className="bg-card border border-chart-5/40 rounded-xl p-4 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-chart-5/15 flex items-center justify-center">
            <Eye className="w-6 h-6 text-chart-5" />
          </div>
          <p className="text-sm font-semibold text-foreground text-center">Break-Glass Session Active</p>
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Emergency access granted. All actions are being recorded. Session expires in{" "}
            <span className="text-chart-5 font-semibold">4 hours</span>.
          </p>
        </div>
      )}

      {/* History */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Break-Glass History</p>
        <div className="flex flex-col gap-3">
          {BREAK_GLASS_LOG.map((b) => (
            <div key={b.id} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{b.user}</p>
                <span className="text-[10px] bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded font-mono">
                  {b.actions} actions
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.reason}</p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Approver: <span className="text-foreground">{b.approver}</span></span>
                <span>{new Date(b.invoked).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main SecurityConsole ──────────────────────────────────────────────────────

export function SecurityConsole({ currentUser }: { currentUser?: AuthUser }) {
  const [tab, setTab] = useState<AdminTab>("rbac");
  const [data, setData] = useState<{ roles: Role[]; users: User[]; ca_policies: CaPolicy[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rbac/roles")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ roles: [], users: [], ca_policies: [] }))
      .finally(() => setLoading(false));
  }, []);

  const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "rbac", label: "RBAC / ABAC", icon: Users },
    { id: "policies", label: "Access Policies", icon: Shield },
    { id: "allowlist", label: "IP Allowlist", icon: Network },
    { id: "pam", label: "PAM", icon: Key },
    { id: "breakglass", label: "Break-Glass", icon: FlameKindling },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-foreground">Security Console</h2>
            <span className="text-[10px] px-2 py-0.5 rounded border border-destructive/40 text-destructive bg-destructive/8 font-medium">
              Privileged — AAL3
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage roles, policies, access controls, and privileged operations. All changes are immutably audited.
            {currentUser && (
              <span className="ml-1 text-foreground font-medium">
                Signed in as {currentUser.name} ({currentUser.email})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Database className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-muted-foreground">SIEM: Azure Sentinel</span>
        </div>
      </div>

      {/* SoD warning */}
      <div className="flex items-center gap-3 bg-chart-5/8 border border-chart-5/30 rounded-xl p-3">
        <AlertTriangle className="w-4 h-4 text-chart-5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">Segregation of Duties enforced: </span>
          Analyst and Auditor roles have a SoD conflict — the same user cannot hold both simultaneously.
          Admin role changes require dual approval.
        </p>
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map(({ id, label, icon }) => (
          <TabBtn key={id} id={id} label={label} icon={icon} active={tab === id} onClick={() => setTab(id)} />
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <div className="bg-card border border-border rounded-xl p-5">
          {tab === "rbac" && <RbacPanel roles={data.roles} users={data.users} />}
          {tab === "policies" && <PoliciesPanel policies={data.ca_policies} />}
          {tab === "allowlist" && <AllowlistPanel />}
          {tab === "pam" && <PamPanel />}
          {tab === "breakglass" && <BreakGlassPanel />}
        </div>
      ) : null}
    </div>
  );
}
