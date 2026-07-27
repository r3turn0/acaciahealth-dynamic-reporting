"use client";

/**
 * MetadataValidationPanel
 *
 * Renders the full MetadataHealthReport from /api/metadata/validate.
 *
 * Sections:
 *   1. Overall health banner (HEALTHY / DEGRADED / UNHEALTHY)
 *   2. Summary scorecard — 8 counters
 *   3. Sync delta bar — Discover vs Dataset Builder table count
 *   4. Per-check result rows — all 8 pipeline checks with expand/collapse
 *   5. Detail lists — missing, orphan, duplicate, stale table IDs
 */

import { useState, useCallback, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  GitMerge,
  Info,
  RefreshCw,
  Search,
  Server,
  Table2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetadataHealthReport, ValidationCheck, ValidationStatus } from "@/lib/services/metadataRegistry";

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusColor(s: ValidationStatus) {
  switch (s) {
    case "PASS": return "text-chart-3";
    case "FAIL": return "text-destructive";
    case "WARN": return "text-chart-5";
    default:     return "text-muted-foreground";
  }
}

function statusBg(s: ValidationStatus) {
  switch (s) {
    case "PASS": return "bg-chart-3/10 border-chart-3/25";
    case "FAIL": return "bg-destructive/10 border-destructive/25";
    case "WARN": return "bg-chart-5/10 border-chart-5/25";
    default:     return "bg-muted/20 border-border";
  }
}

function StatusIcon({ status, className }: { status: ValidationStatus; className?: string }) {
  const cls = cn("w-4 h-4 shrink-0", statusColor(status), className);
  switch (status) {
    case "PASS": return <CheckCircle2 className={cls} />;
    case "FAIL": return <XCircle      className={cls} />;
    case "WARN": return <AlertCircle  className={cls} />;
    default:     return <Info         className={cls} />;
  }
}

// ── Per-check row ─────────────────────────────────────────────────────────────

function CheckRow({ c }: { c: ValidationCheck }) {
  const [open, setOpen] = useState(c.status !== "PASS");

  return (
    <div className={cn("border rounded-lg overflow-hidden transition-colors", statusBg(c.status))}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <StatusIcon status={c.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-tight">{c.name}</p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-1">{c.description}</p>
        </div>
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0",
          statusBg(c.status), statusColor(c.status)
        )}>
          {c.status}
        </span>
        {open
          ? <ChevronDown  className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-border/30 flex flex-col gap-2 pt-2.5">
          {c.detail && (
            <p className="text-xs text-foreground/80 leading-relaxed">{c.detail}</p>
          )}
          {c.fixHint && c.status !== "PASS" && (
            <div className="flex items-start gap-2 bg-background/60 border border-border rounded-md px-3 py-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{c.fixHint}</p>
            </div>
          )}
          {c.affectedItems && c.affectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {c.affectedItems.slice(0, 20).map((item) => (
                <code
                  key={item}
                  className="text-[10px] font-mono px-1.5 py-0.5 bg-background/70 border border-border rounded text-foreground/80"
                >
                  {item}
                </code>
              ))}
              {c.affectedItems.length > 20 && (
                <span className="text-[10px] text-muted-foreground self-center">
                  +{c.affectedItems.length - 20} more
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Scorecard counter ─────────────────────────────────────────────────────────

function Counter({
  label,
  value,
  variant = "neutral",
}: {
  label:    string;
  value:    number;
  variant?: "good" | "bad" | "warn" | "neutral";
}) {
  const textColor =
    variant === "good"    ? "text-chart-3"     :
    variant === "bad"     ? "text-destructive"  :
    variant === "warn"    ? "text-chart-5"      :
    "text-foreground";
  const bg =
    variant === "good"    ? "bg-chart-3/8 border-chart-3/20"   :
    variant === "bad"     ? "bg-destructive/8 border-destructive/20" :
    variant === "warn"    ? "bg-chart-5/8 border-chart-5/20"   :
    "bg-muted/20 border-border";

  return (
    <div className={cn("border rounded-lg px-3 py-2.5 text-center flex flex-col gap-0.5", bg)}>
      <p className={cn("text-lg font-bold tabular-nums leading-none", textColor)}>{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

// ── Detail list ───────────────────────────────────────────────────────────────

function DetailList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-chart-3 shrink-0" />
        <p className="text-xs text-muted-foreground">{empty}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-foreground">{title} ({items.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 30).map((id) => (
          <code
            key={id}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-muted/30 border border-border rounded text-foreground/80"
          >
            {id}
          </code>
        ))}
        {items.length > 30 && (
          <span className="text-[10px] text-muted-foreground self-center">+{items.length - 30} more</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MetadataValidationPanel() {
  const [report, setReport]       = useState<MetadataHealthReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRan, setLastRan]     = useState<string | null>(null);

  const fetchReport = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/metadata/validate",
        forceRefresh
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
          : undefined
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as MetadataHealthReport;
      setReport(data);
      setLastRan(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchReport(); }, [fetchReport]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Running validation pipeline…</span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !report) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <AlertCircle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-destructive">{error ?? "No report data"}</p>
        <button
          onClick={() => fetchReport(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/30 transition-colors text-muted-foreground"
        >
          <RefreshCw className="w-3 h-3" />Retry
        </button>
      </div>
    );
  }

  const overallColor =
    report.overallStatus === "HEALTHY"   ? "text-chart-3 bg-chart-3/10 border-chart-3/25" :
    report.overallStatus === "DEGRADED"  ? "text-chart-5 bg-chart-5/10 border-chart-5/25" :
    "text-destructive bg-destructive/10 border-destructive/25";

  const failCount = report.checks.filter((c) => c.status === "FAIL").length;
  const warnCount = report.checks.filter((c) => c.status === "WARN").length;
  const passCount = report.checks.filter((c) => c.status === "PASS").length;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Metadata Validation
          </h3>
          <p className="text-[11px] text-muted-foreground">
            8-check pipeline across Discover, Dataset Builder, Search, and Reporting surfaces
            {lastRan && <> · Last ran {lastRan}</>}
            {report.durationMs > 0 && <> · {report.durationMs}ms</>}
          </p>
        </div>
        <button
          onClick={() => fetchReport(true)}
          disabled={refreshing}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors",
            refreshing && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Run Validation"}
        </button>
      </div>

      {/* ── Overall banner ── */}
      <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border", overallColor)}>
        {report.overallStatus === "HEALTHY"
          ? <CheckCircle2 className="w-5 h-5 shrink-0" />
          : report.overallStatus === "DEGRADED"
          ? <AlertCircle  className="w-5 h-5 shrink-0" />
          : <XCircle      className="w-5 h-5 shrink-0" />
        }
        <div className="flex-1">
          <p className="text-sm font-semibold leading-tight">
            {report.overallStatus === "HEALTHY"
              ? "Metadata is healthy — all 8 checks passed"
              : report.overallStatus === "DEGRADED"
              ? `Metadata degraded — ${warnCount} warning${warnCount !== 1 ? "s" : ""}, ${passCount} passed`
              : `Metadata unhealthy — ${failCount} failure${failCount !== 1 ? "s" : ""}, ${warnCount} warning${warnCount !== 1 ? "s" : ""}`
            }
          </p>
          <p className="text-[11px] opacity-75 mt-0.5">
            Run at {new Date(report.runAt).toLocaleString()} · {report.durationMs}ms
          </p>
        </div>
      </div>

      {/* ── Scorecard ── */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        <Counter label="Discovered"    value={report.tablesDiscovered}   variant="neutral" />
        <Counter label="Registered"    value={report.tablesRegistered}   variant={report.tablesRegistered === report.tablesDiscovered ? "good" : "warn"} />
        <Counter label="Searchable"    value={report.tablesSearchable}   variant="good" />
        <Counter label="Reportable"    value={report.tablesReportable}   variant="neutral" />
        <Counter label="Missing"       value={report.missingTables}      variant={report.missingTables       === 0 ? "good" : "bad"} />
        <Counter label="Orphaned"      value={report.orphanTables}       variant={report.orphanTables        === 0 ? "good" : "warn"} />
        <Counter label="Stale"         value={report.staleSchemaTables}  variant={report.staleSchemaTables   === 0 ? "good" : "warn"} />
        <Counter label="Duplicates"    value={report.duplicateTables}    variant={report.duplicateTables     === 0 ? "good" : "bad"} />
      </div>

      {/* ── Sync delta bar ── */}
      <div className="border border-border rounded-xl px-4 py-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <GitMerge className="w-3.5 h-3.5 text-primary shrink-0" />
          <p className="text-xs font-medium text-foreground">Catalog Sync: Discover vs Dataset Builder</p>
          {report.syncDelta === 0
            ? <span className="ml-auto text-[10px] text-chart-3 bg-chart-3/10 border border-chart-3/20 rounded px-1.5 py-0.5 font-medium">IN SYNC</span>
            : <span className="ml-auto text-[10px] text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1.5 py-0.5 font-medium">DELTA {report.syncDelta > 0 ? "+" : ""}{report.syncDelta}</span>
          }
        </div>

        {/* Bar */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-0.5 text-right w-28 shrink-0">
            <p className="text-xs font-mono font-medium text-foreground">{report.discoverCount}</p>
            <p className="text-[9px] text-muted-foreground">Discover</p>
          </div>
          <div className="flex-1 relative h-4 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary/60 rounded-full transition-all"
              style={{ width: `${Math.min(100, (report.discoverCount / Math.max(report.discoverCount, report.datasetBuilderCount)) * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-chart-2/50 rounded-full transition-all"
              style={{ width: `${Math.min(100, (report.datasetBuilderCount / Math.max(report.discoverCount, report.datasetBuilderCount)) * 100)}%` }}
            />
          </div>
          <div className="flex flex-col gap-0.5 w-28 shrink-0">
            <p className="text-xs font-mono font-medium text-foreground">{report.datasetBuilderCount}</p>
            <p className="text-[9px] text-muted-foreground">Dataset Builder</p>
          </div>
        </div>

        {report.syncDelta !== 0 && (
          <div className="flex items-start gap-2 bg-chart-5/5 border border-chart-5/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-chart-5 mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {report.syncDelta > 0
                ? `${report.syncDelta} table(s) visible in Discover are not registered in Dataset Builder. This is the root cause of "Build Dataset does not display all tables available in Discover Data Explorer."`
                : `${Math.abs(report.syncDelta)} table(s) in Dataset Builder are not visible in Discover Data Explorer.`
              }
            </p>
          </div>
        )}
      </div>

      {/* ── Per-check results ── */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-foreground flex items-center gap-2 mb-1">
          <Server className="w-3.5 h-3.5 text-primary" />
          Validation Pipeline ({report.checks.length} checks)
          <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
            <span className="text-chart-3">{passCount} passed</span>
            {warnCount > 0 && <span className="text-chart-5">{warnCount} warnings</span>}
            {failCount > 0 && <span className="text-destructive">{failCount} failures</span>}
          </span>
        </p>
        <div className="flex flex-col gap-1.5">
          {report.checks.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </div>
      </div>

      {/* ── Detail lists ── */}
      <div className="border border-border rounded-xl px-4 py-4 flex flex-col gap-4">
        <p className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Table2 className="w-3.5 h-3.5 text-primary" />
          Table Detail Lists
        </p>

        <DetailList
          title="Missing from Dataset Builder"
          items={report.missingFromBuilder}
          empty="All Discover tables are registered in Dataset Builder"
        />
        <div className="h-px bg-border/50" />
        <DetailList
          title="Missing from Discover Data Explorer"
          items={report.missingFromDiscover}
          empty="All Dataset Builder tables are visible in Discover Data Explorer"
        />
        <div className="h-px bg-border/50" />
        <DetailList
          title="Orphan Tables"
          items={report.orphanTableIds}
          empty="No orphan tables — all tables are reachable from at least two surfaces"
        />
        <div className="h-px bg-border/50" />
        <DetailList
          title="Duplicate Registrations"
          items={report.duplicateTableIds}
          empty="No duplicate table registrations"
        />
        <div className="h-px bg-border/50" />
        <DetailList
          title="Stale Metadata"
          items={report.staleTableIds}
          empty="No stale schema definitions detected"
        />
      </div>

      {/* ── Footer guidance ── */}
      <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
        <Search className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Validation runs against the static metadata catalog. For live database checks, ensure the
          read-only database connection is configured — the pipeline will automatically merge
          introspected tables from <code className="font-mono bg-muted/40 px-0.5 rounded">/api/schema/tables</code> into the health report.
          Refresh on demand using the &ldquo;Run Validation&rdquo; button or trigger a POST to
          <code className="font-mono bg-muted/40 px-0.5 rounded ml-1">/api/metadata/validate</code>.
        </p>
      </div>
    </div>
  );
}
