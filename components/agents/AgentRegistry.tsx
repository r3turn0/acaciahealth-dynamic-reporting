"use client";

import { useState, useEffect, useCallback } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentEntry {
  name:        string;
  description: string;
  domain:      string;
  version:     string;
  status:      "ready" | "running" | "error" | "idle";
}

interface RegistryResponse {
  agents:      AgentEntry[];
  count:       number;
  generatedAt: string;
}

// ── Domain → icon + colour mapping ───────────────────────────────────────────

const DOMAIN_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  "Semantic Intelligence Layer": { icon: Brain,      color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/25"  },
  "Metadata Engine":             { icon: Database,   color: "text-chart-3",    bg: "bg-chart-3/10",    border: "border-chart-3/25"  },
  "KPI Intelligence":            { icon: LineChart,  color: "text-chart-5",    bg: "bg-chart-5/10",    border: "border-chart-5/25"  },
  "KPI Definitions":             { icon: BookOpen,   color: "text-chart-2",    bg: "bg-chart-2/10",    border: "border-chart-2/25"  },
  "Relationship Engine":         { icon: Network,    color: "text-teal",       bg: "bg-teal/10",       border: "border-teal/25"     },
};

const DEFAULT_DOMAIN = { icon: Cpu, color: "text-muted-foreground", bg: "bg-muted/60", border: "border-border" };

function getDomainConfig(domain: string) {
  return DOMAIN_CONFIG[domain] ?? DEFAULT_DOMAIN;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentEntry["status"] }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-chart-3 bg-chart-3/10 border border-chart-3/25 rounded-full px-2 py-0.5">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 border border-destructive/25 rounded-full px-2 py-0.5">
        <AlertCircle className="w-2.5 h-2.5" />
        error
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-chart-3 bg-chart-3/10 border border-chart-3/25 rounded-full px-2 py-0.5">
        <CheckCircle2 className="w-2.5 h-2.5" />
        ready
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">
      <Circle className="w-2.5 h-2.5" />
      idle
    </span>
  );
}

// ── Pipeline trace display ────────────────────────────────────────────────────

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
              <div
                className={cn(
                  "w-6 h-6 rounded-full border flex items-center justify-center shrink-0",
                  registered
                    ? "bg-chart-3/15 border-chart-3/40 text-chart-3"
                    : "bg-muted/40 border-border text-muted-foreground"
                )}
              >
                <span className="text-[10px] font-bold">{i + 1}</span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className={cn("w-px h-4", registered ? "bg-chart-3/30" : "bg-border")} />
              )}
            </div>
            <div className="flex flex-col pb-2">
              <span className={cn("text-xs font-medium", registered ? "text-foreground" : "text-muted-foreground")}>
                {stage.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">{stage.agent}</span>
            </div>
            {registered && (
              <CheckCircle2 className="w-3.5 h-3.5 text-chart-3 ml-auto shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Draggable agent card ──────────────────────────────────────────────────────

interface AgentCardProps {
  agent:     AgentEntry;
  index:     number;
  expanded:  boolean;
  onToggle:  () => void;
}

function AgentCard({ agent, index, expanded, onToggle }: AgentCardProps) {
  const { icon: Icon, color, bg, border } = getDomainConfig(agent.domain);

  return (
    <Draggable draggableId={agent.name} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border rounded-xl transition-shadow",
            snapshot.isDragging
              ? "shadow-lg shadow-black/20 border-primary/40 rotate-1 scale-[1.01]"
              : "border-border hover:border-border/80"
          )}
        >
          {/* Card header row */}
          <div className="flex items-center gap-3 px-4 py-3">
            {/* Drag handle */}
            <div
              {...provided.dragHandleProps}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
              aria-label="Drag to reorder"
            >
              <GripVertical className="w-4 h-4" />
            </div>

            {/* Order number */}
            <span className="text-[11px] font-bold text-muted-foreground/50 w-4 shrink-0 text-center select-none">
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

            {/* Status + version + expand */}
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

          {/* Expanded description */}
          {expanded && (
            <div className="px-4 pb-4 pt-0 flex flex-col gap-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground leading-relaxed pt-3">{agent.description}</p>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono mt-1">
                <span className="bg-muted/60 border border-border rounded px-2 py-0.5">{agent.name}</span>
                <span>v{agent.version}</span>
                <span className={cn("px-2 py-0.5 rounded border", bg, border, color)}>{agent.domain}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentRegistry() {
  const [agents, setAgents]         = useState<AgentEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [showPipeline, setShowPipeline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/agents/registry");
      const json = await res.json() as RegistryResponse;
      setAgents(json.agents ?? []);
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

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.index === destination.index) return;

    setAgents((prev) => {
      const next = [...prev];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
  }

  // Summary stats
  const readyCount   = agents.filter((a) => a.status === "ready").length;
  const domainGroups = [...new Set(agents.map((a) => a.domain))].length;

  return (
    <div className="flex flex-col gap-5">

      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Layers className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Agent Registry</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${agents.length} agents across ${domainGroups} domains`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              refreshed {lastRefresh}
            </span>
          )}
          <button
            onClick={() => setShowPipeline((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              showPipeline
                ? "bg-primary/15 border-primary/30 text-primary"
                : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Activity className="w-3.5 h-3.5" />
            Pipeline
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
            { label: "Total Agents",    value: agents.length,  icon: Cpu,          color: "text-primary" },
            { label: "Ready",           value: readyCount,     icon: CheckCircle2, color: "text-chart-3" },
            { label: "Domains",         value: domainGroups,   icon: Layers,       color: "text-teal"    },
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

      {/* Pipeline trace (collapsible) */}
      {showPipeline && !loading && (
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-foreground mb-4">9-Stage Agent Pipeline</p>
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

      {/* Drag-and-drop agent list */}
      {!loading && agents.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground -mb-2">
            Drag agents to reorder the pipeline execution sequence.
          </p>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="agent-registry">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl transition-colors duration-150",
                    snapshot.isDraggingOver && "bg-primary/3"
                  )}
                >
                  {agents.map((agent, i) => (
                    <AgentCard
                      key={agent.name}
                      agent={agent}
                      index={i}
                      expanded={expanded.has(agent.name)}
                      onToggle={() => toggleExpand(agent.name)}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
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
