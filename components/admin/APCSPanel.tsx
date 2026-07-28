"use client";

/**
 * components/admin/APCSPanel.tsx
 *
 * Advanced Prompt Compaction System — Admin Dashboard
 *
 * Displays live metrics for all 10 APCS layers:
 *   - Aggregate token savings (reduction %, sessions, tokens saved)
 *   - Per-session compaction log with layer breakdown
 *   - Dictionary registry (Layer 2)
 *   - Macro registry (Layer 3)
 *   - SQL template registry (Layer 5)
 *   - RAG document store stats (Layer 7)
 *   - Schema hash cache (Layer 8)
 *   - Failure memory / QSIG references (Layer 9)
 *   - Learned facts (Layer 6)
 *   - Live compaction sandbox (test a prompt in-page)
 */

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Zap,
  Database,
  BookOpen,
  Code2,
  GitFork,
  Brain,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror the API response shape)
// ─────────────────────────────────────────────────────────────────────────────

interface AggregateMetrics {
  total_sessions: number;
  avg_reduction_pct: number;
  total_tokens_saved: number;
  cache_hit_rate: number;
  total_rag_stored: number;
}

interface SessionMetric {
  session_id: string;
  timestamp: string;
  original_tokens: number;
  compacted_tokens: number;
  reduction_pct: number;
  layers_applied: string[];
  schema_cache_hit: boolean;
  rag_refs_used: string[];
  failure_refs_used: string[];
  learned_facts_injected: number;
  expansion_accurate: boolean;
}

interface DictEntry { key: string; category: string; tokens: number; version: number; }
interface MacroEntry { key: string; shorthand: string; stepCount: number; }
interface SqlTemplateEntry { key: string; examplePreview: string; }
interface RagStats { count: number; totalTokens: number; tags: string[]; }

interface FailureMemory {
  qsig: string;
  failure_reason: string;
  fix_strategy: string;
  successful_retry: string | null;
  attempt_count: number;
  updated_at: string;
}

interface LearnedFact {
  id: string;
  fact_type: string;
  user_term: string;
  resolved_to: string;
  confidence: number;
  hit_count: number;
}

interface APCSData {
  aggregate: AggregateMetrics;
  recentSessions: SessionMetric[];
  failureMemory: FailureMemory[];
  learnedFacts: LearnedFact[];
  ragStats: RagStats;
  dictionary: DictEntry[];
  macros: MacroEntry[];
  sqlTemplates: SqlTemplateEntry[];
}

interface TestResult {
  originalTokens: number;
  compactedTokens: number;
  reductionPct: number;
  layersApplied: string[];
  schemaHash: string | null;
  schemaCacheHit: boolean;
  ragRefs: string[];
  qsig: string | null;
  intentString: string;
  compressed: boolean;
  originalPrompt: string;
  compactedPrompt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

type InnerTab = "overview" | "sessions" | "dictionary" | "macros" | "rag" | "failure" | "learned" | "sandbox";

const INNER_TABS: { id: InnerTab; label: string; icon: React.ElementType }[] = [
  { id: "overview",   label: "Overview",        icon: Zap },
  { id: "sessions",   label: "Sessions",         icon: Layers },
  { id: "dictionary", label: "Dictionary",       icon: BookOpen },
  { id: "macros",     label: "Macros",           icon: GitFork },
  { id: "rag",        label: "RAG Store",        icon: Database },
  { id: "failure",    label: "Failure Memory",   icon: AlertTriangle },
  { id: "learned",    label: "Learned Facts",    icon: Brain },
  { id: "sandbox",    label: "Sandbox",          icon: FlaskConical },
];

const LAYER_COLORS: Record<string, string> = {
  "L1:normalization":         "bg-chart-1/15 text-chart-1 border border-chart-1/25",
  "L2:dictionary":            "bg-chart-2/15 text-chart-2 border border-chart-2/25",
  "L3:macros":                "bg-chart-3/15 text-chart-3 border border-chart-3/25",
  "L4:ast":                   "bg-chart-4/15 text-chart-4 border border-chart-4/25",
  "L5:sql_templates":         "bg-chart-5/15 text-chart-5 border border-chart-5/25",
  "L6:history_summarization": "bg-primary/15 text-primary border border-primary/25",
  "L6:fact_injection":        "bg-primary/15 text-primary border border-primary/25",
  "L7:rag_schema":            "bg-destructive/15 text-destructive border border-destructive/25",
  "L7:rag_kpi":               "bg-destructive/15 text-destructive border border-destructive/25",
  "L7:rag_semantic":          "bg-destructive/15 text-destructive border border-destructive/25",
  "L8:schema_hashing":        "bg-muted-foreground/15 text-muted-foreground border border-muted-foreground/25",
  "L9:qsig_reference":        "bg-chart-5/15 text-chart-5 border border-chart-5/25",
  "L9:failure_recorded":      "bg-chart-5/15 text-chart-5 border border-chart-5/25",
  "L10:compact_intent":       "bg-chart-2/10 text-chart-2 border border-chart-2/20",
};

function LayerBadge({ layer }: { layer: string }) {
  const cls = LAYER_COLORS[layer] ?? "bg-accent text-accent-foreground border border-border";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium", cls)}>
      {layer}
    </span>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col gap-1 rounded-lg border p-4",
      accent ? "bg-primary/5 border-primary/20" : "bg-card border-border"
    )}>
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", accent ? "text-primary" : "text-foreground")}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count !== undefined && (
        <span className="bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function APCSPanel() {
  const [tab, setTab]         = useState<InnerTab>("overview");
  const [data, setData]       = useState<APCSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Sandbox state
  const [sandboxPrompt, setSandboxPrompt] = useState("");
  const [sandboxResult, setSandboxResult] = useState<TestResult | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError]   = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = async () => {
    try {
      const res  = await fetch("/api/admin/apcs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as APCSData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    refreshIntervalRef.current = setInterval(loadData, 15000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  const runSandbox = async () => {
    if (!sandboxPrompt.trim()) return;
    setSandboxLoading(true);
    setSandboxError(null);
    setSandboxResult(null);
    try {
      const res = await fetch("/api/admin/apcs", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompt: sandboxPrompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as TestResult;
      setSandboxResult(json);
    } catch (e) {
      setSandboxError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setSandboxLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="w-8 h-8 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Failed to load APCS metrics: {error}</p>
        <button
          onClick={() => { setLoading(true); loadData(); }}
          className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const agg = data!.aggregate;

  return (
    <div className="flex flex-col gap-0">

      {/* Inner tab strip */}
      <div className="flex items-stretch gap-0 border-b border-border overflow-x-auto -mx-5 px-5 mb-5">
        {INNER_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3 h-3 shrink-0" />
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center pr-1">
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Avg Reduction"
              value={`${agg.avg_reduction_pct}%`}
              sub="token savings per prompt"
              accent
            />
            <StatCard
              label="Total Sessions"
              value={agg.total_sessions.toLocaleString()}
              sub="compaction runs"
            />
            <StatCard
              label="Tokens Saved"
              value={agg.total_tokens_saved.toLocaleString()}
              sub="cumulative"
            />
            <StatCard
              label="Schema Cache Hit"
              value={`${agg.cache_hit_rate}%`}
              sub="Layer 8 schema reuse"
            />
          </div>

          {/* Layer diagram */}
          <div className="bg-card border border-border rounded-lg p-5">
            <SectionHeader title="Active Layers" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { layer: "L1",  title: "Prompt Normalization",   desc: "Deduplicates whitespace, instructions, SQL keywords" },
                { layer: "L2",  title: "Dictionary Substitution",desc: `${data!.dictionary.length} registered blocks — avg ${Math.round(data!.dictionary.reduce((s, d) => s + d.tokens, 0) / Math.max(data!.dictionary.length, 1))} tokens each` },
                { layer: "L3",  title: "Semantic Macros",        desc: `${data!.macros.length} macros — @shorthand replaces multi-step expansions` },
                { layer: "L4",  title: "Prompt AST",             desc: "Structured intent object replaces verbose narrative instructions" },
                { layer: "L5",  title: "SQL Templates",          desc: `${data!.sqlTemplates.length} templates — parameterize repeated SELECT/JOIN/AGG patterns` },
                { layer: "L6",  title: "History Summarization",  desc: `${data!.learnedFacts.length} learned facts — retry chains → compact fact records` },
                { layer: "L7",  title: "RAG Reference Model",    desc: `${data!.ragStats.count} docs · ${data!.ragStats.totalTokens.toLocaleString()} tokens stored externally` },
                { layer: "L8",  title: "Schema Hashing",         desc: `${agg.cache_hit_rate}% cache hit rate — schema transmit-once, reference by hash` },
                { layer: "L9",  title: "Failure Memory",         desc: `${data!.failureMemory.length} QSIG refs — full SQL retry chains → compact QSIG_NNNN` },
                { layer: "L10", title: "Compact Execution Format", desc: "Intent JSON replaces large textual task instructions" },
              ].map(({ layer, title, desc }) => (
                <div key={layer} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className="text-[10px] font-bold font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded mt-0.5 shrink-0">
                    {layer}
                  </span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-semibold text-foreground">{title}</span>
                    <span className="text-[11px] text-muted-foreground leading-relaxed">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Sessions ─────────────────────────────────────────────────────── */}
      {tab === "sessions" && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Recent Compaction Sessions" count={data!.recentSessions.length} />
          {data!.recentSessions.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No sessions recorded yet. Run a query to generate a session.
            </p>
          )}
          {data!.recentSessions.map((s) => {
            const isExpanded = expandedSession === s.session_id;
            return (
              <div key={s.session_id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSession(isExpanded ? null : s.session_id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  }
                  <div className="flex flex-1 items-center gap-3 min-w-0 flex-wrap">
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {s.session_id.slice(0, 20)}
                    </span>
                    <span className={cn(
                      "text-xs font-semibold tabular-nums shrink-0",
                      s.reduction_pct >= 30 ? "text-chart-2" : s.reduction_pct > 0 ? "text-chart-3" : "text-muted-foreground"
                    )}>
                      -{s.reduction_pct}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {s.original_tokens}t → {s.compacted_tokens}t
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {s.layers_applied.slice(0, 4).map((l) => <LayerBadge key={l} layer={l} />)}
                      {s.layers_applied.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{s.layers_applied.length - 4}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.schema_cache_hit && (
                      <span className="text-[10px] bg-chart-2/10 text-chart-2 border border-chart-2/20 px-1.5 py-0.5 rounded font-medium">
                        L8 hit
                      </span>
                    )}
                    {s.expansion_accurate && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-chart-2" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-muted/20">
                    <div className="flex flex-col gap-2 pt-3">
                      <div className="flex flex-wrap gap-1.5">
                        {s.layers_applied.map((l) => <LayerBadge key={l} layer={l} />)}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {new Date(s.timestamp).toLocaleString()}
                      </div>
                      {s.rag_refs_used.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          RAG refs: {s.rag_refs_used.join(", ")}
                        </p>
                      )}
                      {s.failure_refs_used.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          QSIG refs: {s.failure_refs_used.join(", ")}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Learned facts injected: {s.learned_facts_injected}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dictionary ───────────────────────────────────────────────────── */}
      {tab === "dictionary" && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Layer 2 — Registered Dictionary Blocks" count={data!.dictionary.length} />
          <p className="text-[11px] text-muted-foreground mb-1">
            Each block replaces its full text with a compact <code className="font-mono">[REF:KEY]</code> placeholder in every prompt.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40">
                  {["Key", "Category", "Tokens", "Version"].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground px-3 py-2 border-b border-border">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.dictionary.map((d) => (
                  <tr key={d.key} className="border-b border-border/50 hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-[11px] text-foreground">{d.key}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-medium">
                        {d.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{d.tokens}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">v{d.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Macros ───────────────────────────────────────────────────────── */}
      {tab === "macros" && (
        <div className="flex flex-col gap-5">
          <div>
            <SectionHeader title="Layer 3 — Semantic Macros" count={data!.macros.length} />
            <p className="text-[11px] text-muted-foreground mb-3">
              Macros replace multi-step instruction blocks with a short <code className="font-mono">@SHORTHAND</code> tag.
            </p>
            <div className="flex flex-col gap-2">
              {data!.macros.map((m) => (
                <div key={m.key} className="flex items-center gap-3 border border-border rounded-lg px-4 py-3">
                  <Code2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs text-foreground font-semibold">{m.shorthand}</span>
                  <span className="text-[11px] text-muted-foreground">
                    expands to {m.stepCount} steps
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader title="Layer 5 — SQL Templates" count={data!.sqlTemplates.length} />
            <p className="text-[11px] text-muted-foreground mb-3">
              Parameterize repeated SELECT/JOIN/AGG boilerplate so identical patterns are stored once and referenced by key.
            </p>
            <div className="flex flex-col gap-2">
              {data!.sqlTemplates.map((t) => (
                <div key={t.key} className="border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs font-semibold text-foreground">{t.key}</span>
                  </div>
                  <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed bg-muted/40 rounded p-2">
                    {t.examplePreview}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── RAG Store ────────────────────────────────────────────────────── */}
      {tab === "rag" && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Layer 7 — RAG Document Store" />
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Stored Documents" value={data!.ragStats.count} />
            <StatCard label="Total Tokens Stored" value={data!.ragStats.totalTokens.toLocaleString()} sub="externalized from prompts" />
            <StatCard
              label="Document Tags"
              value={data!.ragStats.tags.length}
              sub={data!.ragStats.tags.join(", ") || "none"}
            />
          </div>
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Large prompt blocks (schema JSON, KPI definitions, semantic layer) are stored here once and referenced
              as <code className="font-mono text-foreground">[RAG_DOC_001]</code> in the compacted prompt.
              They are expanded only at inference time when the model needs them.
            </p>
          </div>
          {data!.ragStats.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data!.ragStats.tags.map((tag) => (
                <span key={tag} className="text-[11px] bg-chart-1/10 text-chart-1 border border-chart-1/20 px-2 py-1 rounded-full font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Failure Memory ───────────────────────────────────────────────── */}
      {tab === "failure" && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Layer 9 — Query Failure Memory (QSIG)" count={data!.failureMemory.length} />
          <p className="text-[11px] text-muted-foreground mb-1">
            Failure records replace full SQL retry chains. Future prompts reference a compact
            <code className="font-mono text-foreground"> QSIG_NNNN</code> instead of retransmitting history.
          </p>
          {data!.failureMemory.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No failure memory recorded yet.
            </p>
          )}
          {data!.failureMemory.map((f) => (
            <div key={f.qsig} className="border border-border rounded-lg p-4 flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-xs font-bold text-chart-5">{f.qsig}</span>
                <span className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded font-medium">
                  {f.failure_reason}
                </span>
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {f.attempt_count} attempt{f.attempt_count !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Fix: <span className="text-foreground">{f.fix_strategy}</span>
              </p>
              {f.successful_retry && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-chart-2 shrink-0" />
                  <span className="text-[11px] text-chart-2">Retry succeeded</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Learned Facts ────────────────────────────────────────────────── */}
      {tab === "learned" && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Layer 6 — Learned Facts" count={data!.learnedFacts.length} />
          <p className="text-[11px] text-muted-foreground mb-1">
            Table and column mappings learned from retry history. Injected into future prompts as compact
            fact lines instead of full retry chains.
          </p>
          {data!.learnedFacts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No learned facts yet. Run queries with corrections to populate this store.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40">
                  {["Type", "User Term", "Resolved To", "Confidence", "Hits"].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground px-3 py-2 border-b border-border">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.learnedFacts.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2">
                      <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-medium">
                        {f.fact_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{f.user_term}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chart-2">{f.resolved_to}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-chart-2 rounded-full"
                            style={{ width: `${Math.round(f.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground text-[10px]">{(f.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{f.hit_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sandbox ──────────────────────────────────────────────────────── */}
      {tab === "sandbox" && (
        <div className="flex flex-col gap-4">
          <SectionHeader title="Layer Sandbox — Test Prompt Compaction" />
          <p className="text-[11px] text-muted-foreground">
            Paste any system prompt below to measure the APCS reduction across all 10 layers.
          </p>

          <textarea
            value={sandboxPrompt}
            onChange={(e) => setSandboxPrompt(e.target.value)}
            placeholder="Paste a system prompt here to test compaction..."
            rows={8}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={runSandbox}
              disabled={sandboxLoading || !sandboxPrompt.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sandboxLoading
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Zap className="w-3.5 h-3.5" />
              }
              {sandboxLoading ? "Compacting…" : "Run Compaction"}
            </button>
            {sandboxPrompt && (
              <span className="text-[11px] text-muted-foreground">
                ~{Math.ceil(sandboxPrompt.length / 4)} tokens
              </span>
            )}
          </div>

          {sandboxError && (
            <p className="text-xs text-destructive">{sandboxError}</p>
          )}

          {sandboxResult && (
            <div className="flex flex-col gap-4 border border-border rounded-lg p-4 bg-muted/20">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Reduction"
                  value={`${sandboxResult.reductionPct}%`}
                  accent={sandboxResult.reductionPct >= 20}
                />
                <StatCard label="Original" value={`${sandboxResult.originalTokens}t`} />
                <StatCard label="Compacted" value={`${sandboxResult.compactedTokens}t`} />
                <StatCard
                  label="Compressed"
                  value={sandboxResult.compressed ? "Yes" : "No"}
                  sub={sandboxResult.schemaCacheHit ? "Schema cache hit" : undefined}
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold text-foreground mb-2">Layers Applied</p>
                {sandboxResult.layersApplied.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">None — prompt below minimum size threshold</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {sandboxResult.layersApplied.map((l) => <LayerBadge key={l} layer={l} />)}
                  </div>
                )}
              </div>

              {sandboxResult.intentString && sandboxResult.intentString !== "{}" && (
                <div>
                  <p className="text-[11px] font-semibold text-foreground mb-1.5">Compact Intent (Layer 10)</p>
                  <pre className="text-[10px] font-mono bg-muted/40 rounded p-2 overflow-x-auto text-foreground">
                    {JSON.stringify(JSON.parse(sandboxResult.intentString), null, 2)}
                  </pre>
                </div>
              )}

              {sandboxResult.compactedPrompt && sandboxResult.reductionPct > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-foreground mb-1.5">Compacted Output (first 500 chars)</p>
                  <pre className="text-[10px] font-mono bg-muted/40 rounded p-2 overflow-x-auto text-muted-foreground whitespace-pre-wrap">
                    {sandboxResult.compactedPrompt}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
