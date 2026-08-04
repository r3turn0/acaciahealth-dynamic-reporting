"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GripVertical,
  Cpu,
  RefreshCw,
  CheckCircle2,
  Circle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Brain,
  Database,
  LineChart,
  BookOpen,
  Network,
  Loader2,
  Activity,
  Layers,
  FlaskConical,
  ToggleLeft,
  ToggleRight,
  GitBranch,
  Zap,
  Shield,
  Star,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ABVariant {
  label:  string;
  weight: number;
  config: Record<string, unknown>;
}

interface AgentMetrics {
  totalRuns:     number;
  successRuns:   number;
  errorRuns:     number;
  avgDurationMs: number;
  lastRunAt?:    string;
  lastErrorMsg?: string;
}

interface AgentEntry {
  name:            string;
  description:     string;
  domain:          string;
  version:         string;
  status:          "ready" | "running" | "error" | "idle" | "disabled" | "deprecated";
  enabled:         boolean;
  isActiveVersion: boolean;
  dependencies:    string[];
  tags:            string[];
  runtime:         string;
  featureFlag?:    string;
  abVariants:      ABVariant[];
  metrics:         AgentMetrics;
  registeredAt?:   string;
  updatedAt?:      string;
  registeredBy?:   string;
}

interface RegistryResponse {
  agents:       AgentEntry[];
  count:        number;
  enabledCount: number;
  totalCount:   number;
  generatedAt:  string;
  version:      string;
}

// ── Domain icon / colour map ──────────────────────────────────────────────────

const DOMAIN_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  "Semantic Intelligence Layer": { icon: Brain,     color: "text-primary",          bg: "bg-primary/10",     border: "border-primary/25"  },
  "Metadata Engine":             { icon: Database,  color: "text-chart-3",          bg: "bg-chart-3/10",     border: "border-chart-3/25"  },
  "KPI Intelligence":            { icon: LineChart, color: "text-chart-5",          bg: "bg-chart-5/10",     border: "border-chart-5/25"  },
  "KPI Definitions":             { icon: BookOpen,  color: "text-chart-2",          bg: "bg-chart-2/10",     border: "border-chart-2/25"  },
  "Relationship Engine":         { icon: Network,   color: "text-muted-foreground", bg: "bg-muted/60",       border: "border-border"      },
  "Query Generation":            { icon: Zap,       color: "text-chart-5",          bg: "bg-chart-5/10",     border: "border-chart-5/25"  },
  "Business Intelligence":       { icon: LineChart, color: "text-chart-1",          bg: "bg-chart-1/10",     border: "border-chart-1/25"  },
  "Data Quality":                { icon: CheckCircle2, color: "text-chart-3",       bg: "bg-chart-3/10",     border: "border-chart-3/25"  },
  "Report Validation":           { icon: CheckCircle2, color: "text-chart-3",       bg: "bg-chart-3/10",     border: "border-chart-3/25"  },
  "Security Audit":              { icon: Shield,    color: "text-destructive",      bg: "bg-destructive/10", border: "border-destructive/25" },
  "Recommendation Engine":       { icon: Star,      color: "text-chart-5",          bg: "bg-chart-5/10",     border: "border-chart-5/25"  },
};
const DEFAULT_DOMAIN = { icon: Cpu, color: "text-muted-foreground", bg: "bg-muted/60", border: "border-border" };
const getDomainConfig = (domain: string) => DOMAIN_CONFIG[domain] ?? DEFAULT_DOMAIN;

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, enabled }: { status: AgentEntry["status"]; enabled?: boolean }) {
  if (!enabled || status === "disabled") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 bg-muted/40 border border-border rounded-full px-2 py-0.5">
      <Circle className="w-2.5 h-2.5" />disabled
    </span>
  );
  if (status === "running") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-chart-5 bg-chart-5/10 border border-chart-5/25 rounded-full px-2 py-0.5">
      <Loader2 className="w-2.5 h-2.5 animate-spin" />running
    </span>
  );
  if (status === "error") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 border border-destructive/25 rounded-full px-2 py-0.5">
      <AlertCircle className="w-2.5 h-2.5" />error
    </span>
  );
  if (status === "deprecated") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-chart-5 bg-chart-5/10 border border-chart-5/25 rounded-full px-2 py-0.5">
      <AlertCircle className="w-2.5 h-2.5" />deprecated
    </span>
  );
  if (status === "ready") return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-chart-3 bg-chart-3/10 border border-chart-3/25 rounded-full px-2 py-0.5">
      <CheckCircle2 className="w-2.5 h-2.5" />ready
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">
      <Circle className="w-2.5 h-2.5" />idle
    </span>
  );
}

// ── Pipeline trace ────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: "metadata",     label: "Metadata Normalisation", agent: "MetadataNormalizationAgent" },
  { key: "schema",       label: "Schema Intelligence",    agent: "SchemaIntelligenceAgent" },
  { key: "embed",        label: "Vector Embedding",       agent: "VectorEmbeddingAgent" },
  { key: "relationship", label: "Relationship Builder",   agent: "RelationshipBuilderAgent" },
  { key: "kpi",          label: "KPI Engine",             agent: "KPIEngineAgent" },
];

function PipelineTrace({ agents }: { agents: AgentEntry[] }) {
  const registeredNames = new Set(agents.map((a) => a.name));
  return (
    <div className="flex flex-col gap-1.5">
      {PIPELINE_STAGES.map((stage, i) => {
        const registered = registeredNames.has(stage.agent);
        return (
          <div key={stage.key} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-6 h-6 rounded-full border flex items-center justify-center shrink-0",
                registered
                  ? "bg-chart-3/15 border-chart-3/40 text-chart-3"
                  : "bg-muted/40 border-border text-muted-foreground",
              )}>
                <span className="text-[10px] font-bold">{i + 1}</span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className={cn("w-px h-4", registered ? "bg-chart-3/30" : "bg-border")} />
              )}
            </div>
            <div className="flex flex-col pb-2 flex-1">
              <span className={cn("text-xs font-medium", registered ? "text-foreground" : "text-muted-foreground")}>
                {stage.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">{stage.agent}</span>
            </div>
            {registered && <CheckCircle2 className="w-3.5 h-3.5 text-chart-3 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Drag state tracked via refs (no re-renders during drag) ─────────────────���─

interface AgentCardProps {
  agent:        AgentEntry;
  index:        number;
  expanded:     boolean;
  onToggle:     () => void;
  onDragStart:  (index: number) => void;
  onDragEnter:  (index: number) => void;
  onDragEnd:    () => void;
  isDragging:   boolean;
  isOver:       boolean;
}

function AgentCard({
  agent, index, expanded, onToggle,
  onDragStart, onDragEnter, onDragEnd,
  isDragging, isOver,
}: AgentCardProps) {
  const { icon: Icon, color, bg, border } = getDomainConfig(agent.domain);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={cn(
        "bg-card border rounded-xl transition-all duration-150 select-none",
        isDragging  && "opacity-40 scale-[0.98]",
        isOver      && !isDragging && "border-primary/50 shadow-md shadow-primary/10 -translate-y-0.5",
        !isDragging && !isOver && "border-border hover:border-border/80",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Grip handle — triggers drag */}
        <div
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Order number */}
        <span className="text-[11px] font-bold text-muted-foreground/50 w-4 shrink-0 text-center">
          {index + 1}
        </span>

        {/* Domain icon */}
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border", bg, border)}>
          <Icon className={cn("w-4 h-4", color)} />
        </div>

        {/* Name + domain */}
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground leading-tight truncate">{agent.name}</span>
          <span className={cn("text-[11px] font-medium", color)}>{agent.domain}</span>
        </div>

        {/* Status + version + expand toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={agent.status} />
          <span className="text-[10px] text-muted-foreground/60 font-mono hidden sm:block">v{agent.version}</span>
          <button
            onClick={onToggle}
            className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50 flex flex-col gap-3">
          {/* Description */}
          <p className="text-xs text-muted-foreground leading-relaxed pt-3">{agent.description}</p>

          {/* Identity chips */}
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            <span className="bg-muted/60 border border-border rounded px-2 py-0.5 font-mono">{agent.name}</span>
            <span className="bg-muted/60 border border-border rounded px-2 py-0.5 font-mono">v{agent.version}</span>
            {agent.isActiveVersion && (
              <span className="bg-chart-3/10 border border-chart-3/25 text-chart-3 rounded px-2 py-0.5 flex items-center gap-1">
                <GitBranch className="w-2.5 h-2.5" />active
              </span>
            )}
            <span className={cn("px-2 py-0.5 rounded border", bg, border, color)}>{agent.runtime}</span>
          </div>

          {/* Dependencies */}
          {agent.dependencies.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dependencies</p>
              <div className="flex flex-wrap gap-1.5">
                {agent.dependencies.map((dep) => (
                  <span key={dep} className="text-[10px] bg-chart-2/10 border border-chart-2/25 text-chart-2 rounded px-2 py-0.5 font-mono">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {agent.tags.map((tag) => (
                <span key={tag} className="text-[10px] bg-muted/50 border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Feature flag */}
          {agent.featureFlag && (
            <div className="flex items-center gap-2">
              <ToggleRight className="w-3.5 h-3.5 text-chart-5 shrink-0" />
              <span className="text-[10px] text-muted-foreground">Feature flag:</span>
              <span className="text-[10px] font-mono text-chart-5 bg-chart-5/10 border border-chart-5/25 rounded px-2 py-0.5">{agent.featureFlag}</span>
            </div>
          )}

          {/* A/B variants */}
          {agent.abVariants.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <FlaskConical className="w-3 h-3 text-chart-5 shrink-0" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">A/B Variants</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {agent.abVariants.map((v) => (
                  <div key={v.label} className="flex items-center gap-1 text-[10px] bg-chart-5/8 border border-chart-5/20 rounded px-2 py-1">
                    <span className="font-medium text-foreground">{v.label}</span>
                    <span className="text-muted-foreground">weight: {v.weight}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metrics */}
          {agent.metrics.totalRuns > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Runs",    value: agent.metrics.totalRuns,     color: "text-foreground"    },
                { label: "Success", value: agent.metrics.successRuns,   color: "text-chart-3"       },
                { label: "Errors",  value: agent.metrics.errorRuns,     color: agent.metrics.errorRuns > 0 ? "text-destructive" : "text-muted-foreground" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-muted/40 border border-border/60 rounded-lg px-2.5 py-2 text-center">
                  <p className={cn("text-sm font-bold", color)}>{value}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Last error */}
          {agent.metrics.lastErrorMsg && (
            <div className="flex items-start gap-1.5 bg-destructive/8 border border-destructive/20 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
              <p className="text-[10px] text-destructive leading-relaxed">{agent.metrics.lastErrorMsg}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentRegistry({ onNavigateToPipeline }: { onNavigateToPipeline?: () => void } = {}) {
  const [agents, setAgents]             = useState<AgentEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh]   = useState<string>("");
  const [showPipeline, setShowPipeline] = useState(false);
  const [enabledCount, setEnabledCount] = useState(0);

  // Drag state — kept in refs so drag-over doesn't trigger full re-renders
  const dragIndex  = useRef<number | null>(null);
  const overIndex  = useRef<number | null>(null);
  const [dragState, setDragState] = useState<{ drag: number | null; over: number | null }>({ drag: null, over: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/agents/registry");
      const json = await res.json() as RegistryResponse;
      setAgents(json.agents ?? []);
      setEnabledCount(json.enabledCount ?? (json.agents ?? []).filter((a) => a.enabled).length);
      setLastRefresh(new Date(json.generatedAt).toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
    overIndex.current = index;
    setDragState({ drag: index, over: index });
  }

  function handleDragEnter(index: number) {
    if (dragIndex.current === null || index === overIndex.current) return;
    overIndex.current = index;
    setDragState((prev) => ({ ...prev, over: index }));
  }

  function handleDragEnd() {
    const from = dragIndex.current;
    const to   = overIndex.current;

    dragIndex.current = null;
    overIndex.current = null;
    setDragState({ drag: null, over: null });

    if (from === null || to === null || from === to) return;

    setAgents((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const domainGroups = [...new Set(agents.map((a) => a.domain))].length;

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Layers className="w-[18px] h-[18px] text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Agent Registry</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading..." : `${agents.length} agents across ${domainGroups} domains`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              refreshed {lastRefresh}
            </span>
          )}
          {onNavigateToPipeline && (
            <button
              onClick={onNavigateToPipeline}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Pipeline Builder
            </button>
          )}
          <button
            onClick={() => setShowPipeline((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              showPipeline
                ? "bg-primary/15 border-primary/30 text-primary"
                : "bg-muted/40 border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Activity className="w-3.5 h-3.5" />
            Trace
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/40 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat row */}
      {!loading && agents.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Agents", value: agents.length, icon: Cpu,          color: "text-primary"  },
            { label: "Enabled",      value: enabledCount,  icon: CheckCircle2, color: "text-chart-3"  },
            { label: "Domains",      value: domainGroups,  icon: Layers,       color: "text-chart-2"  },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl px-4 py-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
              <span className={cn("text-xl font-bold", color)}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline trace */}
      {showPipeline && !loading && (
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-foreground mb-4">Agent Pipeline Stages</p>
          <PipelineTrace agents={agents} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/8 border border-destructive/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Drag list */}
      {!loading && agents.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground -mb-2">
            Drag agents by the grip handle to reorder the pipeline execution sequence.
          </p>
          <div className="flex flex-col gap-2">
            {agents.map((agent, i) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                index={i}
                expanded={expanded.has(agent.name)}
                onToggle={() => toggleExpand(agent.name)}
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragEnd={handleDragEnd}
                isDragging={dragState.drag === i}
                isOver={dragState.over === i && dragState.drag !== i}
              />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && agents.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-10 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/60 border border-border flex items-center justify-center">
            <Cpu className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No agents registered</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Agents register themselves on first import. Try refreshing or restarting the server.
          </p>
          <button
            onClick={load}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
