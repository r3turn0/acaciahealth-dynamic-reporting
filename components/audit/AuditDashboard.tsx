"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Lock,
  AlertTriangle,
  Shield,
  Activity,
  Database,
  RefreshCw,
  Loader2,
  Filter,
  Download,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Category = "auth" | "access" | "admin" | "policy" | "anomaly";
type Severity = "info" | "warn" | "critical";
type Result = "success" | "failure" | "blocked";

interface AuditEntry {
  id: string;
  timestamp: string;
  category: Category;
  event: string;
  user: string;
  role: string;
  resource: string;
  ip: string;
  location: string;
  device: string;
  result: Result;
  severity: Severity;
  details: string;
  immutable: boolean;
}

// ── Config maps ───────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<Category, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  auth: { label: "Auth", color: "text-primary", bg: "bg-primary/10 border-primary/25", icon: Lock },
  access: { label: "Access", color: "text-chart-2", bg: "bg-chart-2/10 border-chart-2/25", icon: Database },
  admin: { label: "Admin", color: "text-chart-5", bg: "bg-chart-5/10 border-chart-5/25", icon: Shield },
  policy: { label: "Policy", color: "text-chart-4", bg: "bg-chart-4/10 border-chart-4/25", icon: Activity },
  anomaly: { label: "Anomaly", color: "text-destructive", bg: "bg-destructive/10 border-destructive/25", icon: AlertTriangle },
};

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string; bg: string }> = {
  info: { label: "Info", color: "text-chart-3", bg: "bg-chart-3/10 border-chart-3/25" },
  warn: { label: "Warn", color: "text-chart-5", bg: "bg-chart-5/10 border-chart-5/25" },
  critical: { label: "Critical", color: "text-destructive", bg: "bg-destructive/10 border-destructive/25" },
};

const RESULT_CONFIG: Record<Result, { icon: React.ElementType; color: string }> = {
  success: { icon: CheckCircle2, color: "text-chart-3" },
  failure: { icon: XCircle, color: "text-destructive" },
  blocked: { icon: MinusCircle, color: "text-chart-5" },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ entries }: { entries: AuditEntry[] }) {
  const stats = [
    { label: "Total Events", value: entries.length, icon: Activity, color: "text-primary" },
    { label: "Anomalies", value: entries.filter((e) => e.category === "anomaly").length, icon: AlertTriangle, color: "text-destructive" },
    { label: "Critical", value: entries.filter((e) => e.severity === "critical").length, icon: Shield, color: "text-destructive" },
    { label: "Auth Events", value: entries.filter((e) => e.category === "auth").length, icon: Lock, color: "text-chart-2" },
    { label: "Blocked", value: entries.filter((e) => e.result === "blocked").length, icon: XCircle, color: "text-chart-5" },
    { label: "Policy Changes", value: entries.filter((e) => e.category === "policy" || e.category === "admin").length, icon: CheckCircle2, color: "text-chart-3" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
            <Icon className={cn("w-3.5 h-3.5", color)} />
          </div>
          <p className={cn("text-2xl font-bold", color)}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface Filters {
  user: string;
  category: Category | "";
  severity: Severity | "";
  result: Result | "";
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const categories: (Category | "")[] = ["", "auth", "access", "admin", "policy", "anomaly"];
  const severities: (Severity | "")[] = ["", "info", "warn", "critical"];
  const results: (Result | "")[] = ["", "success", "failure", "blocked"];

  function select<K extends keyof Filters>(k: K, v: Filters[K]) {
    onChange({ ...filters, [k]: v });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-3 py-1.5">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter by user..."
          value={filters.user}
          onChange={(e) => select("user", e.target.value)}
          className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-36"
        />
      </div>

      {([
        ["category", categories, "Category"],
        ["severity", severities, "Severity"],
        ["result", results, "Result"],
      ] as const).map(([key, opts, placeholder]) => (
        <select
          key={key}
          value={filters[key]}
          onChange={(e) => select(key, e.target.value as Filters[typeof key])}
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-xs text-foreground outline-none cursor-pointer appearance-none"
        >
          <option value="">{placeholder}: All</option>
          {opts.filter(Boolean).map((o) => (
            <option key={o} value={o}>{o ? (o.charAt(0).toUpperCase() + o.slice(1)) : ""}</option>
          ))}
        </select>
      ))}

      {Object.values(filters).some(Boolean) && (
        <button
          onClick={() => onChange({ user: "", category: "", severity: "", result: "" })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded border border-border hover:border-primary/40"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cat = CATEGORY_CONFIG[entry.category];
  const sev = SEVERITY_CONFIG[entry.severity];
  const res = RESULT_CONFIG[entry.result];
  const CatIcon = cat.icon;
  const ResIcon = res.icon;

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
      >
        {/* Time */}
        <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{fmtTime(entry.timestamp)}</td>

        {/* Category */}
        <td className="px-3 py-3">
          <span className={cn("flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border w-fit", cat.bg, cat.color)}>
            <CatIcon className="w-3 h-3" />
            {cat.label}
          </span>
        </td>

        {/* Event */}
        <td className="px-3 py-3 font-mono text-xs text-foreground whitespace-nowrap">{entry.event}</td>

        {/* User */}
        <td className="px-3 py-3">
          <p className="text-xs text-foreground truncate max-w-[140px]">{entry.user}</p>
          <p className="text-[10px] text-muted-foreground">{entry.role}</p>
        </td>

        {/* Severity */}
        <td className="px-3 py-3">
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", sev.bg, sev.color)}>
            {sev.label}
          </span>
        </td>

        {/* Result */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            <ResIcon className={cn("w-3.5 h-3.5", res.color)} />
            <span className={cn("text-[10px] capitalize font-medium", res.color)}>{entry.result}</span>
          </div>
        </td>

        {/* Immutable */}
        <td className="px-3 py-3">
          <span className="text-[10px] text-chart-3">
            {entry.immutable ? <Lock className="w-3 h-3" /> : null}
          </span>
        </td>

        {/* Expand */}
        <td className="px-3 py-3 text-muted-foreground">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="text-[11px] text-muted-foreground space-y-1">
                <div><span className="text-foreground font-medium">Resource: </span>{entry.resource}</div>
                <div><span className="text-foreground font-medium">IP: </span>{entry.ip}</div>
                <div><span className="text-foreground font-medium">Location: </span>{entry.location}</div>
                <div><span className="text-foreground font-medium">Device: </span>{entry.device}</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                <span className="text-foreground font-medium block mb-1">Details</span>
                {entry.details}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main AuditDashboard ───────────────────────────────────────────────────────

export function AuditDashboard() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ user: "", category: "", severity: "", result: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.user) params.set("user", filters.user);
      if (filters.category) params.set("category", filters.category);
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.result) params.set("result", filters.result);
      const res = await fetch(`/api/audit/logs?${params}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const critical = entries.filter((e) => e.severity === "critical");

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Audit & Monitoring Dashboard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Immutable event log — all authentication, access, and administrative actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-primary/40"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <button className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Compliance notice */}
      <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-3">
        <Lock className="w-4 h-4 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">Immutable Audit Trail — </span>
          All events are write-once, cryptographically signed, and forwarded in real time to
          <span className="text-primary font-medium"> Azure Sentinel</span> (SIEM).
          Log retention: <span className="text-primary font-medium">6 years</span> (HIPAA §164.312).
        </p>
      </div>

      {/* Critical alerts */}
      {critical.length > 0 && (
        <div className="flex flex-col gap-2">
          {critical.map((e) => (
            <div key={e.id} className="flex items-start gap-3 bg-destructive/8 border border-destructive/30 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-destructive">{e.event}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtTime(e.timestamp)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{e.details}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      <StatsBar entries={entries} />

      {/* Filters */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Timestamp", "Category", "Event", "User / Role", "Severity", "Result", "Immutable", ""].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-xs text-muted-foreground">
                      No events match the current filters.
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => <EntryRow key={e.id} entry={e} />)
                )}
              </tbody>
            </table>
          </div>
        )}

        {entries.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Showing {entries.length} event{entries.length !== 1 ? "s" : ""}</span>
            <span>Retention: 6 years · HIPAA §164.312 · SIEM: Azure Sentinel</span>
          </div>
        )}
      </div>
    </div>
  );
}
