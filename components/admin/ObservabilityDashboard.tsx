"use client";

/**
 * ObservabilityDashboard
 *
 * Live diagnostic panel surfacing all platform telemetry captured by
 * lib/services/observabilityStore.ts. Refreshes every 3 seconds.
 *
 * Sections:
 *   1. Health Summary — four status chips (dataset registry, search index,
 *      relationship graph, reporting engine)
 *   2. Zero-Result Queries — actionable list of searches that returned nothing
 *   3. Event Log — filterable, paginated live log of every instrumented event
 *   4. Export Statistics — total exports, average row count, format breakdown
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import useSWR from "swr";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileText,
  Search,
  Server,
  Share2,
  Trash2,
  XCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getLogs,
  getZeroResultQueries,
  getHealthSummary,
  clearObsLog,
  subscribeToObs,
  getObsSnapshot,
  type ObsEvent,
  type ObsEventType,
  type ObsLevel,
  type SearchLog,
  type ExportLog,
} from "@/lib/services/observabilityStore";
import { MetadataValidationPanel } from "@/components/admin/MetadataValidationPanel";
import { getRequestSnapshots, getRequestSummary, getRequestVersion, subscribeRequests } from "@/lib/orchestration/requestRegistry";

// ── Utility ───────────────────────────────────────────────────────────────────

interface PromptHealthPayload {
  summary: { valid: number; degraded: number; broken: number };
  scope: string;
  authoritative: boolean;
}

interface PerformancePayload {
  performance: {
    sampleCount: number;
    apiP95Ms: number | null;
    sqlP95Ms: number | null;
    cacheHitRatio: number | null;
    timeoutCount: number;
    deadlockCount: number;
    blockingRate: number | null;
  };
  cache: { size: number; maxEntries: number; estimatedBytes: number };
  kpiEvidence: {
    sampleCount: number;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    averageCoverage: number | null;
    averageReportSuccessRate: number | null;
    averageConfidence: number | null;
    fallbackRate: number | null;
    comparisonRate: number | null;
    sourceMix: { live: number; cached: number; failed: number };
    failureCategories: Record<string, number>;
    coverageGaps: Array<{ kpiKey: string; attempts: number; averageCoverage: number; fallbackRate: number }>;
  };
  infrastructure: Record<string, { status: string; value?: number | null; enabled?: boolean | null }>;
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Telemetry unavailable");
  return response.json() as Promise<T>;
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)   return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Level badge ───────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: ObsLevel }) {
  const styles: Record<ObsLevel, string> = {
    info:  "bg-chart-3/15  text-chart-3  border-chart-3/30",
    warn:  "bg-chart-5/15  text-chart-5  border-chart-5/30",
    error: "bg-destructive/15 text-destructive border-destructive/30",
    debug: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border", styles[level])}>
      {level}
    </span>
  );
}

// ── Event type icon ───────────────────────────────────────────────────────────

function EventTypeIcon({ type }: { type: ObsEventType }) {
  const map: Record<ObsEventType, React.ElementType> = {
    api_request:        Server,
    metadata_sync:      RefreshCw,
    dataset_publish:    Database,
    search:             Search,
    query_execution:    FileText,
    export:             Download,
    relationship_graph: Share2,
    search_index:       Activity,
    prompt_health:      CheckCircle2,
    report_audit:       FileText,
    dataset_validation: Database,
    write_blocked:      XCircle,
  };
  const Icon = map[type] ?? Activity;
  return <Icon className="w-3 h-3 text-muted-foreground shrink-0" />;
}

// ── Health chip ───────────────────────────────────────────────────────────────

function HealthChip({
  label,
  healthy,
  icon: Icon,
}: {
  label:   string;
  healthy: boolean;
  icon:    React.ElementType;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium",
      healthy
        ? "bg-chart-3/10 border-chart-3/30 text-chart-3"
        : "bg-destructive/10 border-destructive/30 text-destructive"
    )}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 text-foreground font-normal text-[11px]">{label}</span>
      {healthy
        ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-chart-3" />
        : <XCircle      className="w-3.5 h-3.5 shrink-0 text-destructive" />}
    </div>
  );
}

// ── EVENT TYPE OPTIONS ─────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: ObsEventType | "all"; label: string }[] = [
  { value: "all",               label: "All" },
  { value: "search",            label: "Search" },
  { value: "query_execution",   label: "Query" },
  { value: "export",            label: "Export" },
  { value: "api_request",       label: "API" },
  { value: "metadata_sync",     label: "Metadata" },
  { value: "dataset_publish",   label: "Publish" },
  { value: "relationship_graph",label: "Graph" },
  { value: "search_index",      label: "Index" },
  { value: "prompt_health",     label: "Prompts" },
  { value: "report_audit",      label: "Report audit" },
  { value: "dataset_validation",label: "Validation" },
  { value: "write_blocked",     label: "Write barrier" },
];

// ── Main component ────────────────────────────────────────────────────────────

export function ObservabilityDashboard() {
  const { data: performanceData, error: performanceError } = useSWR<PerformancePayload>(
    "/api/admin/performance",
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: false }
  );
  const { data: promptHealth } = useSWR<PromptHealthPayload>(
    "/api/prompt-health",
    fetcher,
    { dedupingInterval: 15 * 60_000, revalidateOnFocus: false }
  );

  // Live subscription to the store
  const allEvents = useSyncExternalStore(subscribeToObs, getObsSnapshot, () => []);
  useSyncExternalStore(subscribeRequests, getRequestVersion, () => 0);
  const requestSummary = getRequestSummary();
  const activeRequests = getRequestSnapshots().filter((request) => request.status === "pending").slice(0, 6);

  const [typeFilter, setTypeFilter]     = useState<ObsEventType | "all">("all");
  const [levelFilter, setLevelFilter]   = useState<ObsLevel | "all">("all");
  const [page, setPage]                 = useState(0);
  const [, forceUpdate]                 = useState(0); // for relativeTime refresh

  // Refresh relative timestamps every 10 s
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const health       = getHealthSummary();
  const zeroResults  = getZeroResultQueries(10);

  // Filtered event log
  const filtered = allEvents
    .slice()
    .reverse()
    .filter((e) => typeFilter === "all"  || e.type  === typeFilter)
    .filter((e) => levelFilter === "all" || e.level === levelFilter);

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEvents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Export stats
  const exportEvents = allEvents
    .filter((e) => e.type === "export")
    .map((e) => e.meta as ExportLog | undefined)
    .filter((m): m is ExportLog => !!m);
  const csvCount  = exportEvents.filter((e) => e.format === "csv").length;
  const jsonCount = exportEvents.filter((e) => e.format === "json").length;
  const xlsxCount = exportEvents.filter((e) => e.format === "xlsx").length;
  const avgRows   = exportEvents.length
    ? Math.round(exportEvents.reduce((s, e) => s + e.rowCount, 0) / exportEvents.length)
    : 0;

  // Search stats
  const searchEvents = allEvents
    .filter((e) => e.type === "search")
    .map((e) => e.meta as SearchLog | undefined)
    .filter((m): m is SearchLog => !!m);
  const avgConf = searchEvents.length
    ? (searchEvents.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) / searchEvents.length)
    : 0;

  return (
    <div className="flex flex-col gap-5">

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Request orchestration</h3><p className="mt-1 text-[11px] text-muted-foreground">Live browser lifecycle, deduplication, and cancellation visibility.</p></div><span className={cn("rounded-full border px-2 py-1 text-[10px] font-medium", requestSummary.active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground")}>{requestSummary.active} active</span></div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">{[["Completed", requestSummary.completed], ["Cancelled", requestSummary.cancelled], ["Stale", requestSummary.stale], ["Calls saved", requestSummary.savedCalls], ["P50", requestSummary.p50Ms === null ? "—" : `${requestSummary.p50Ms} ms`], ["P95", requestSummary.p95Ms === null ? "—" : `${requestSummary.p95Ms} ms`], ["P99", requestSummary.p99Ms === null ? "—" : `${requestSummary.p99Ms} ms`], ["Cancel rate", `${(requestSummary.cancellationRate * 100).toFixed(1)}%`]].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold text-foreground">{value}</p></div>)}</div>
        {activeRequests.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{activeRequests.map((request) => <span key={request.id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] text-foreground"><Loader2 className="size-3 animate-spin text-primary" />{request.scope} · {request.operation}</span>)}</div>}
      </section>

      {/* ── Health Summary ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">System Health</h3>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{health.recentErrors} error{health.recentErrors !== 1 ? "s" : ""} in last 5 min</span>
            <span className="text-border">·</span>
            <span>{health.totalEvents.toLocaleString()} total events</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <HealthChip label="Dataset Registry"    healthy={health.datasetRegistryHealthy}  icon={Database}  />
          <HealthChip label="Search Index"        healthy={health.searchIndexHealthy}       icon={Activity}  />
          <HealthChip label="Relationship Graph"  healthy={health.relationshipGraphHealthy} icon={Share2}    />
          <HealthChip label="Reporting Engine"    healthy={health.reportingEngineHealthy}   icon={FileText}  />
          <HealthChip label="Strict Read-Only Boundary" healthy icon={CheckCircle2} />
          <HealthChip label={`Prompt Registry${promptHealth ? ` (${promptHealth.summary.valid} valid)` : ""}`} healthy={!!promptHealth && promptHealth.summary.broken === 0} icon={Search} />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Health, audit, and publication telemetry is session/process-cache scoped and non-authoritative.</p>
      </section>

      {/* ── Performance objectives ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Performance Objectives</h3>
            <p className="text-[11px] text-muted-foreground mt-1">Rolling 15-minute application telemetry. No PHI is recorded.</p>
          </div>
          <span className="text-[10px] text-muted-foreground">{performanceData?.performance.sampleCount ?? 0} samples</span>
        </div>
        {performanceError ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Performance telemetry is temporarily unavailable.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "API P95",
                value: performanceData?.performance.apiP95Ms == null ? "No data" : `${performanceData.performance.apiP95Ms} ms`,
                state: performanceData?.performance.apiP95Ms == null ? null : performanceData.performance.apiP95Ms < 500,
                target: "Target < 500 ms",
              },
              {
                label: "Cache hit ratio",
                value: performanceData?.performance.cacheHitRatio == null ? "No data" : `${Math.round(performanceData.performance.cacheHitRatio * 100)}%`,
                state: performanceData?.performance.cacheHitRatio == null ? null : performanceData.performance.cacheHitRatio > 0.8,
                target: "Target > 80%",
              },
              {
                label: "Deadlocks",
                value: performanceData?.performance.sampleCount ? String(performanceData.performance.deadlockCount) : "No data",
                state: performanceData?.performance.sampleCount ? performanceData.performance.deadlockCount === 0 : null,
                target: "Target 0",
              },
              {
                label: "Blocking rate",
                value: performanceData?.performance.blockingRate == null ? "No data" : `${(performanceData.performance.blockingRate * 100).toFixed(1)}%`,
                state: performanceData?.performance.blockingRate == null ? null : performanceData.performance.blockingRate < 0.01,
                target: "Target < 1%",
              },
            ].map((metric) => (
              <div key={metric.label} className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{metric.label}</span>
                  <span className={cn("h-2 w-2 rounded-full", metric.state == null ? "bg-muted-foreground" : metric.state ? "bg-chart-3" : "bg-destructive")} />
                </div>
                <strong className="text-base font-semibold text-foreground tabular-nums">{metric.value}</strong>
                <span className="text-[10px] text-muted-foreground">{metric.target}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mt-3 lg:grid-cols-5">
          {["azureSqlCpu", "queryStore", "reportingIsolation", "indexMaintenance", "criticalTableScans"].map((key) => (
            <div key={key} className="rounded-lg border border-border px-3 py-2">
              <span className="block text-[10px] text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}</span>
              <span className="text-[11px] font-medium text-foreground">Not connected</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── KPI evidence observability ────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">KPI Evidence</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Aggregate, PHI-safe evidence quality over the rolling telemetry window.</p>
          </div>
          <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground">{performanceData?.kpiEvidence.sampleCount ?? 0} analyses</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["P95 latency", performanceData?.kpiEvidence.latencyP95Ms == null ? "No data" : `${performanceData.kpiEvidence.latencyP95Ms} ms`],
            ["Coverage", performanceData?.kpiEvidence.averageCoverage == null ? "No data" : `${Math.round(performanceData.kpiEvidence.averageCoverage * 100)}%`],
            ["Report success", performanceData?.kpiEvidence.averageReportSuccessRate == null ? "No data" : `${Math.round(performanceData.kpiEvidence.averageReportSuccessRate * 100)}%`],
            ["Confidence", performanceData?.kpiEvidence.averageConfidence == null ? "No data" : `${Math.round(performanceData.kpiEvidence.averageConfidence)}%`],
            ["Fallback rate", performanceData?.kpiEvidence.fallbackRate == null ? "No data" : `${Math.round(performanceData.kpiEvidence.fallbackRate * 100)}%`],
          ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</p></div>)}
        </div>
        {performanceData?.kpiEvidence.coverageGaps.length ? <div className="mt-3 flex flex-col gap-2 rounded-lg border border-chart-5/25 bg-chart-5/5 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-chart-5">Coverage gaps</p>{performanceData.kpiEvidence.coverageGaps.map((gap) => <div key={gap.kpiKey} className="flex items-center justify-between gap-3 text-[11px]"><span className="font-mono text-foreground">{gap.kpiKey}</span><span className="text-muted-foreground">{Math.round(gap.averageCoverage * 100)}% coverage · {Math.round(gap.fallbackRate * 100)}% fallback · {gap.attempts} runs</span></div>)}</div> : null}
      </section>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Searches", value: searchEvents.length.toLocaleString() },
          { label: "Zero Results",   value: zeroResults.length.toLocaleString(), warn: zeroResults.length > 0 },
          { label: "Avg Confidence", value: `${Math.round(avgConf * 100)}%` },
          { label: "Total Exports",  value: exportEvents.length.toLocaleString() },
        ].map(({ label, value, warn }) => (
          <div key={label} className="flex flex-col gap-0.5 bg-muted/30 border border-border rounded-lg px-3 py-2.5">
            <span className={cn("text-lg font-semibold tabular-nums", warn ? "text-chart-5" : "text-foreground")}>
              {value}
            </span>
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </section>

      {/* ── Zero-Result Queries ─────────────────────────────────────────────── */}
      {zeroResults.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-3.5 h-3.5 text-chart-5" />
            <h3 className="text-xs font-semibold text-chart-5">Zero-Result Searches</h3>
            <span className="text-[10px] text-muted-foreground">(add synonyms or missing datasets to resolve)</span>
          </div>
          <div className="flex flex-col gap-1 bg-chart-5/5 border border-chart-5/20 rounded-lg p-3">
            {zeroResults.map((q, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-foreground font-mono">&ldquo;{q.query}&rdquo;</span>
                <span className="text-muted-foreground">{q.durationMs}ms</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Metadata Validation ─────────────────────────────────────────────── */}
      <section className="border border-border rounded-xl p-4">
        <MetadataValidationPanel />
      </section>

      {/* ── Export Stats ────────────────────────────────────────────────────── */}
      {exportEvents.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">Export Activity</h3>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-4 py-2.5">
            <span><span className="text-foreground font-medium">{csvCount}</span> CSV</span>
            <span><span className="text-foreground font-medium">{jsonCount}</span> JSON</span>
            <span><span className="text-foreground font-medium">{xlsxCount}</span> XLSX</span>
            <span>Avg <span className="text-foreground font-medium">{avgRows.toLocaleString()}</span> rows/export</span>
          </div>
        </section>
      )}

      {/* ── Event Log ───────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Event Log</h3>
          <button
            onClick={() => { clearObsLog(); setPage(0); }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Type filter */}
          <div className="flex items-center gap-1 flex-wrap">
            {TYPE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setTypeFilter(value as ObsEventType | "all"); setPage(0); }}
                className={cn(
                  "px-2 py-1 text-[11px] rounded border transition-colors",
                  typeFilter === value
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Level filter */}
          <div className="flex items-center gap-1 ml-auto">
            {(["all", "info", "warn", "error"] as const).map((l) => (
              <button
                key={l}
                onClick={() => { setLevelFilter(l); setPage(0); }}
                className={cn(
                  "px-2 py-1 text-[11px] rounded border transition-colors capitalize",
                  levelFilter === l
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Log table */}
        {pageEvents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground text-xs">
            <Activity className="w-6 h-6 opacity-30" />
            <span>No events recorded yet. Use the platform to start logging.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0 divide-y divide-border/50 border border-border rounded-lg overflow-hidden">
            {pageEvents.map((event) => (
              <LogRow key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
            <span>{filtered.length.toLocaleString()} events</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-border hover:bg-accent/40 disabled:opacity-40 transition-colors"
              >
                Prev
              </button>
              <span className="px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded border border-border hover:bg-accent/40 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Log row ───────────────────────────────────────────────────────────────���───

function LogRow({ event }: { event: ObsEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        <EventTypeIcon type={event.type} />
        <LevelBadge level={event.level} />
        <span className="flex-1 text-[11px] text-foreground truncate">{event.message}</span>
        {event.durationMs != null && (
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{event.durationMs}ms</span>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0 ml-2" title={formatTs(event.ts)}>
          {relativeTime(event.ts)}
        </span>
      </button>
      {open && event.meta && (
        <pre className="px-4 py-2 bg-muted/40 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap border-t border-border/60">
          {JSON.stringify(event.meta, null, 2)}
        </pre>
      )}
    </div>
  );
}
