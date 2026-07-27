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

// ── Utility ───────────────────────────────────────────────────────────────────

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
];

// ── Main component ────────────────────────────────────────────────────────────

export function ObservabilityDashboard() {
  // Live subscription to the store
  const allEvents = useSyncExternalStore(subscribeToObs, getObsSnapshot, () => []);

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
        <div className="grid grid-cols-2 gap-2">
          <HealthChip label="Dataset Registry"    healthy={health.datasetRegistryHealthy}  icon={Database}  />
          <HealthChip label="Search Index"        healthy={health.searchIndexHealthy}       icon={Activity}  />
          <HealthChip label="Relationship Graph"  healthy={health.relationshipGraphHealthy} icon={Share2}    />
          <HealthChip label="Reporting Engine"    healthy={health.reportingEngineHealthy}   icon={FileText}  />
        </div>
      </section>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-4 gap-3">
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

// ── Log row ───────────────────────────────────────────────────────────────────

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
