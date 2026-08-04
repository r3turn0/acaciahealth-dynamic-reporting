"use client";

/**
 * QueryHistoryPanel
 *
 * Displays the query history (Phase 8) and learned term mappings (Phase 10)
 * from the SchemaAwareRetryAgent system. Two tabs:
 *
 *   1. Query History  — every attempt with status, retry count, failure class,
 *                       execution time, and the final successful SQL.
 *   2. Learned Mappings — user term → physical object with confidence, usage
 *                         counts, and manual management.
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  History,
  Brain,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  Trash2,
  Plus,
  TrendingUp,
  Database,
  Zap,
  RotateCcw,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors queryHistoryStore)
// ─────────────────────────────────────────────────────────────────────────────

type QueryStatus = "success" | "failure" | "retry" | "aborted";

interface QueryHistoryEntry {
  id: string;
  created_at: string;
  user_request: string;
  query_text: string;
  status: QueryStatus;
  retry_version: number;
  failure_reason: string | null;
  remediation_strategy: string | null;
  error_message: string | null;
  execution_ms: number;
  schema_hash: string;
  final_success_query: string | null;
}

interface LearnedMapping {
  id: string;
  user_term: string;
  actual_object: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  last_used: string;
}

interface HistoryStats {
  total_attempts: number;
  success_count: number;
  failure_count: number;
  retry_count: number;
  avg_execution_ms: number;
  success_rate: number;
  failure_breakdown: Record<string, number>;
  top_learned_mappings: Array<{ user_term: string; actual_object: string; confidence: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: QueryStatus }) {
  const map: Record<QueryStatus, { icon: React.ElementType; label: string; cls: string }> = {
    success: { icon: CheckCircle2, label: "Success",  cls: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
    failure: { icon: XCircle,      label: "Failed",   cls: "bg-destructive/15 text-destructive border-destructive/30" },
    retry:   { icon: RotateCcw,    label: "Retry",    cls: "bg-chart-5/15 text-chart-5 border-chart-5/30" },
    aborted: { icon: AlertTriangle,label: "Aborted",  cls: "bg-muted text-muted-foreground border-border" },
  };
  const { icon: Icon, label, cls } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", cls)}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? "bg-chart-3" : pct >= 50 ? "bg-chart-5" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Query History Row
// ─────────────────────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: QueryHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <ChevronIcon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={entry.status} />
            {entry.retry_version > 0 && (
              <span className="text-[10px] text-muted-foreground border border-border rounded-full px-2 py-0.5">
                Retry v{entry.retry_version}
              </span>
            )}
            {entry.failure_reason && (
              <span className="text-[10px] font-mono text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1.5 py-0.5">
                {entry.failure_reason}
              </span>
            )}
          </div>
          <p className="text-[13px] text-foreground font-medium leading-snug truncate">
            {entry.user_request || entry.query_text.slice(0, 120)}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px] text-muted-foreground">
          {entry.execution_ms > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatMs(entry.execution_ms)}
            </span>
          )}
          <span>{formatTime(entry.created_at)}</span>
        </div>
      </button>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-3">
          {/* SQL */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Executed SQL
            </p>
            <pre className="text-[11px] font-mono bg-background border border-border rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap text-foreground/90 leading-relaxed max-h-48 overflow-y-auto">
              {entry.query_text}
            </pre>
          </div>

          {/* Error */}
          {entry.error_message && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-destructive mb-1.5">
                Error
              </p>
              <p className="text-[11px] font-mono text-destructive/80 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                {entry.error_message}
              </p>
            </div>
          )}

          {/* Remediation */}
          {entry.remediation_strategy && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-chart-5 mb-1.5">
                Remediation
              </p>
              <p className="text-[12px] text-muted-foreground">{entry.remediation_strategy}</p>
            </div>
          )}

          {/* Final success SQL */}
          {entry.final_success_query && entry.final_success_query !== entry.query_text && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-chart-3 mb-1.5">
                Final Corrected SQL
              </p>
              <pre className="text-[11px] font-mono bg-background border border-chart-3/30 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap text-foreground/90 leading-relaxed max-h-48 overflow-y-auto">
                {entry.final_success_query}
              </pre>
            </div>
          )}

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="font-mono">Hash: {entry.schema_hash.slice(0, 12)}...</span>
            <span>ID: {entry.id.slice(0, 8)}...</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Learned Mapping Row
// ─────────────────────────────────────────────────────────────────────────────

function MappingRow({
  mapping,
  onDelete,
}: {
  mapping: LearnedMapping;
  onDelete: (term: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-lg hover:bg-muted/20 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">
            {mapping.user_term}
          </span>
          <span className="text-[11px] text-muted-foreground">→</span>
          <span className="text-[11px] font-mono bg-chart-3/10 text-chart-3 border border-chart-3/20 rounded px-1.5 py-0.5">
            {mapping.actual_object}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>{mapping.success_count} success · {mapping.failure_count} failure</span>
          <span>Last used {formatTime(mapping.last_used)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <ConfidenceBar value={mapping.confidence} />
        <button
          onClick={() => onDelete(mapping.user_term)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={`Delete mapping for ${mapping.user_term}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Mapping Form
// ─────────────────────────────────────────────────────────────────────────────

function AddMappingForm({ onAdded }: { onAdded: () => void }) {
  const [term, setTerm] = useState("");
  const [object, setObject] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim() || !object.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/learned-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_term: term.trim(), actual_object: object.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTerm("");
      setObject("");
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 p-4 bg-muted/20 border border-border rounded-xl">
      <div className="flex-1 min-w-0">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          User Term
        </label>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="e.g. admissions"
          className="mt-1 w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
      <div className="flex-1 min-w-0">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Actual Object
        </label>
        <input
          value={object}
          onChange={(e) => setObject(e.target.value)}
          placeholder="e.g. CLIENT_EPISODES_ALL"
          className="mt-1 w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
      <button
        type="submit"
        disabled={saving || !term.trim() || !object.trim()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        {saving ? "Saving..." : "Add"}
      </button>
      {error && <p className="text-[11px] text-destructive ml-2">{error}</p>}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

type PanelTab = "history" | "mappings";

export function QueryHistoryPanel() {
  const [activeTab, setActiveTab] = useState<PanelTab>("history");

  // History state
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Mappings state
  const [mappings, setMappings] = useState<LearnedMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  // Load history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/query-history?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { entries: QueryHistoryEntry[]; stats: HistoryStats };
      setEntries(data.entries);
      setStats(data.stats);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setLoadingHistory(false);
    }
  }, [statusFilter, search]);

  // Load mappings
  const loadMappings = useCallback(async () => {
    setLoadingMappings(true);
    setMappingsError(null);
    try {
      const res = await fetch("/api/learned-mappings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { mappings: LearnedMapping[] };
      setMappings(data.mappings);
    } catch (err) {
      setMappingsError((err as Error).message);
    } finally {
      setLoadingMappings(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { if (activeTab === "mappings") loadMappings(); }, [activeTab, loadMappings]);

  async function handleDeleteMapping(term: string) {
    try {
      await fetch(`/api/learned-mappings?term=${encodeURIComponent(term)}`, { method: "DELETE" });
      setMappings((prev) => prev.filter((m) => m.user_term !== term));
    } catch {
      // silent
    }
  }

  const TABS: Array<{ id: PanelTab; label: string; icon: React.ElementType }> = [
    { id: "history",  label: "Query History",    icon: History },
    { id: "mappings", label: "Learned Mappings",  icon: Brain   },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Retry Intelligence</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Phase 8-10 — Query history, failure analysis, and learned term mappings
          </p>
        </div>
        <button
          onClick={activeTab === "history" ? loadHistory : loadMappings}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 flex-1 justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === id
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── History Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Total Attempts"
                value={stats.total_attempts}
                icon={Database}
                color="bg-primary/10 text-primary"
              />
              <StatCard
                label="Success Rate"
                value={`${Math.round(stats.success_rate * 100)}%`}
                icon={TrendingUp}
                color="bg-chart-3/10 text-chart-3"
              />
              <StatCard
                label="Failures"
                value={stats.failure_count}
                icon={XCircle}
                color="bg-destructive/10 text-destructive"
              />
              <StatCard
                label="Avg Execution"
                value={formatMs(stats.avg_execution_ms)}
                icon={Zap}
                color="bg-chart-5/10 text-chart-5"
              />
            </div>
          )}

          {/* Failure breakdown */}
          {stats && Object.keys(stats.failure_breakdown).length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Failure Breakdown
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.failure_breakdown).map(([cls, count]) => (
                  <span
                    key={cls}
                    className="text-[10px] font-mono px-2 py-1 bg-destructive/10 text-destructive border border-destructive/20 rounded"
                  >
                    {cls}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) loadHistory();
                }}
                placeholder="Search user requests..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-center gap-1 border border-border rounded-lg px-2">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm bg-transparent text-foreground focus:outline-none py-2 pr-1"
              >
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="failure">Failed</option>
                <option value="retry">Retry</option>
                <option value="aborted">Aborted</option>
              </select>
            </div>
          </div>

          {/* Entries */}
          {loadingHistory ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading query history...
            </div>
          ) : historyError ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {historyError}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <History className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No query history yet.</p>
              <p className="text-xs text-muted-foreground/60">
                History is recorded automatically when queries are executed.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Mappings Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "mappings" && (
        <div className="space-y-4">
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Learned mappings are automatically built from successful and failed query executions.
            They teach the retry agent which user terms map to which physical database objects.
            High-confidence mappings are injected into the AI prompt for future queries.
          </p>

          <AddMappingForm onAdded={loadMappings} />

          {loadingMappings ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading learned mappings...
            </div>
          ) : mappingsError ? (
            <div className="flex items-center justify-center py-12 text-destructive text-sm">
              {mappingsError}
            </div>
          ) : mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Brain className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No learned mappings yet.</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs">
                Mappings are learned automatically from query executions, or you can add one manually above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {mappings.map((m) => (
                <MappingRow key={m.id} mapping={m} onDelete={handleDeleteMapping} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
