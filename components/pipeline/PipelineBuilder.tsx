"use client";

/**
 * components/pipeline/PipelineBuilder.tsx
 *
 * Visual Pipeline Constructor — admin UI for:
 *   - Browsing + selecting saved pipeline definitions
 *   - Drag-and-drop agent sequencing
 *   - Configuring A/B variants per step
 *   - Setting skip conditions, retry, timeout
 *   - Saving / deleting pipelines
 *   - Executing pipelines with live step trace
 *
 * No hardcoded agent list — all agents are fetched from /api/agents/registry.
 * No hardcoded workflows — all pipelines from /api/pipeline/definitions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GripVertical,
  Plus,
  Trash2,
  Play,
  Save,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  FlaskConical,
  Settings2,
  ArrowRight,
  Layers,
  Zap,
  SkipForward,
  GitBranch,
  Shield,
  Database,
  Brain,
  LineChart,
  Network,
  BookOpen,
  Search,
  Star,
  Copy,
  X,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types (mirrors API shapes) ────────────────────────────────────────────────

interface AgentEntry {
  name:        string;
  description: string;
  domain:      string;
  version:     string;
  enabled:     boolean;
  tags:        string[];
  dependencies: string[];
}

interface ABVariant {
  label:  string;
  weight: number;
  config: Record<string, unknown>;
}

interface PipelineStep {
  id:             string;
  agentName:      string;
  label?:         string;
  skipIf?:        string;
  parallelGroup?: string;
  configOverride?: Record<string, unknown>;
  retry?:         { maxRetries: number; backoffMs: number };
  timeoutMs?:     number;
  inputMap?:      Record<string, string>;
}

interface PipelineDef {
  id:          string;
  name:        string;
  description: string;
  version:     string;
  steps:       PipelineStep[];
  isDefault:   boolean;
  enabled:     boolean;
  tags:        string[];
  timeoutMs:   number;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

interface StepTrace {
  stepId:     string;
  agentName:  string;
  label:      string;
  status:     "pending" | "running" | "ok" | "skipped" | "error" | "timeout";
  durationMs: number;
  error?:     string;
  retryCount: number;
  variant?:   string;
  output?:    unknown;
}

interface RunResult {
  pipelineId:   string;
  pipelineName: string;
  runId:        string;
  status:       "ok" | "partial" | "failed";
  steps:        StepTrace[];
  finalOutput:  unknown;
  totalMs:      number;
  errors:       string[];
}

// ── Domain icon map ───────────────────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  "Metadata Engine":             Database,
  "Query Generation":            Zap,
  "Semantic Intelligence Layer": Brain,
  "Business Intelligence":       LineChart,
  "Data Quality":                Shield,
  "Report Validation":           CheckCircle2,
  "Security Audit":              Shield,
  "Recommendation Engine":       Star,
  "KPI Intelligence":            LineChart,
  "KPI Definitions":             BookOpen,
  "Relationship Engine":         Network,
};

const DOMAIN_COLORS: Record<string, string> = {
  "Metadata Engine":             "text-chart-2",
  "Query Generation":            "text-chart-5",
  "Semantic Intelligence Layer": "text-primary",
  "Business Intelligence":       "text-chart-1",
  "Data Quality":                "text-chart-3",
  "Report Validation":           "text-chart-3",
  "Security Audit":              "text-destructive",
  "Recommendation Engine":       "text-chart-5",
  "KPI Intelligence":            "text-chart-1",
  "KPI Definitions":             "text-chart-2",
  "Relationship Engine":         "text-muted-foreground",
};

function AgentIcon({ domain, className }: { domain: string; className?: string }) {
  const Icon = DOMAIN_ICONS[domain] ?? Layers;
  const color = DOMAIN_COLORS[domain] ?? "text-muted-foreground";
  return <Icon className={cn("w-4 h-4 shrink-0", color, className)} />;
}

// ── Step status badge ─────────────────────────────────────────────────────────

function StepStatusBadge({ status }: { status: StepTrace["status"] }) {
  const map: Record<StepTrace["status"], { label: string; cls: string; icon: React.ElementType }> = {
    pending:  { label: "pending",  cls: "text-muted-foreground bg-muted/50 border-border",                 icon: Loader2      },
    running:  { label: "running",  cls: "text-chart-5 bg-chart-5/10 border-chart-5/30",                   icon: Loader2      },
    ok:       { label: "ok",       cls: "text-chart-3 bg-chart-3/10 border-chart-3/30",                   icon: CheckCircle2 },
    skipped:  { label: "skipped",  cls: "text-muted-foreground bg-muted/40 border-border",                icon: SkipForward  },
    error:    { label: "error",    cls: "text-destructive bg-destructive/10 border-destructive/30",        icon: XCircle      },
    timeout:  { label: "timeout",  cls: "text-chart-5 bg-chart-5/10 border-chart-5/30",                   icon: AlertCircle  },
  };
  const { label, cls, icon: Icon } = map[status];
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-medium border rounded-full px-2 py-0.5", cls)}>
      <Icon className={cn("w-2.5 h-2.5", status === "running" && "animate-spin")} />
      {label}
    </span>
  );
}

// ── Agent picker ──────────────────────────────────────────────────────────────

function AgentPickerModal({
  agents,
  onSelect,
  onClose,
}: {
  agents:    AgentEntry[];
  onSelect:  (agent: AgentEntry) => void;
  onClose:   () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.domain.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">No agents match.</div>
          )}
          {filtered.map((agent) => (
            <button
              key={agent.name}
              onClick={() => onSelect(agent)}
              className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left border-b border-border/40 last:border-0"
            >
              <div className="mt-0.5">
                <AgentIcon domain={agent.domain} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{agent.description}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5">
                    {agent.domain}
                  </span>
                  {agent.dependencies.length > 0 && (
                    <span className="text-[10px] text-muted-foreground bg-muted/40 border border-border rounded px-1.5 py-0.5">
                      deps: {agent.dependencies.slice(0, 2).join(", ")}{agent.dependencies.length > 2 ? "…" : ""}
                    </span>
                  )}
                  {!agent.enabled && (
                    <span className="text-[10px] text-destructive bg-destructive/10 border border-destructive/20 rounded px-1.5 py-0.5">
                      disabled
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step editor ───────────────────────────────────────────────────────────────

function StepEditor({
  step,
  agent,
  index,
  total,
  onUpdate,
  onRemove,
  isDragging,
  isOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: {
  step:         PipelineStep;
  agent?:       AgentEntry;
  index:        number;
  total:        number;
  onUpdate:     (patch: Partial<PipelineStep>) => void;
  onRemove:     () => void;
  isDragging:   boolean;
  isOver:       boolean;
  onDragStart:  (i: number) => void;
  onDragEnter:  (i: number) => void;
  onDragEnd:    () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAB, setShowAB]     = useState(false);

  const abVariants: ABVariant[] = (step.configOverride?.__abVariants as ABVariant[]) ?? [];

  function updateABVariants(variants: ABVariant[]) {
    onUpdate({ configOverride: { ...step.configOverride, __abVariants: variants } });
  }

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
        isOver && !isDragging && "border-primary/50 shadow-md shadow-primary/10 -translate-y-0.5",
        !isDragging && !isOver && "border-border",
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <div
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Step number */}
        <span className="text-[11px] font-bold text-muted-foreground/50 w-4 text-center shrink-0">{index + 1}</span>

        {/* Agent icon */}
        <div className="w-7 h-7 rounded-lg bg-muted/60 border border-border flex items-center justify-center shrink-0">
          <AgentIcon domain={agent?.domain ?? "Custom"} />
        </div>

        {/* Name + domain */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{step.label ?? step.agentName}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{step.agentName}</p>
        </div>

        {/* Parallel badge */}
        {step.parallelGroup && (
          <span className="text-[10px] border border-chart-2/30 bg-chart-2/10 text-chart-2 rounded px-1.5 py-0.5 hidden sm:flex items-center gap-1">
            <GitBranch className="w-2.5 h-2.5" />
            parallel
          </span>
        )}

        {/* A/B badge */}
        {abVariants.length > 0 && (
          <span className="text-[10px] border border-chart-5/30 bg-chart-5/10 text-chart-5 rounded px-1.5 py-0.5 hidden sm:flex items-center gap-1">
            <FlaskConical className="w-2.5 h-2.5" />
            A/B
          </span>
        )}

        {/* Connector arrow */}
        {index < total - 1 && !step.parallelGroup && (
          <ArrowRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onRemove}
          className="p-1 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
          aria-label="Remove step"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="border-t border-border/50 px-3.5 py-3.5 flex flex-col gap-3">
          {/* Label override */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Step label</label>
            <input
              value={step.label ?? ""}
              onChange={(e) => onUpdate({ label: e.target.value || undefined })}
              placeholder={step.agentName}
              className="bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>

          {/* Parallel group */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-3 h-3" /> Parallel group
            </label>
            <input
              value={step.parallelGroup ?? ""}
              onChange={(e) => onUpdate({ parallelGroup: e.target.value || undefined })}
              placeholder="e.g. discovery — leave blank for sequential"
              className="bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Skip condition */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <SkipForward className="w-3 h-3" /> Skip condition
              <span className="text-muted-foreground/50 font-normal">(JS expression — prev, ctx)</span>
            </label>
            <input
              value={step.skipIf ?? ""}
              onChange={(e) => onUpdate({ skipIf: e.target.value || undefined })}
              placeholder={`e.g. ctx.role === 'viewer'`}
              className="bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 font-mono transition-colors"
            />
          </div>

          {/* Retry + timeout */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Max retries</label>
              <input
                type="number"
                min={0}
                max={5}
                value={step.retry?.maxRetries ?? 1}
                onChange={(e) => onUpdate({ retry: { maxRetries: Number(e.target.value), backoffMs: step.retry?.backoffMs ?? 500 } })}
                className="bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Timeout (ms)</label>
              <input
                type="number"
                min={1000}
                step={1000}
                value={step.timeoutMs ?? 60000}
                onChange={(e) => onUpdate({ timeoutMs: Number(e.target.value) })}
                className="bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* A/B Variants */}
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowAB((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <FlaskConical className="w-3 h-3" />
                A/B Variants ({abVariants.length})
              </span>
              {showAB ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
            </button>

            {showAB && (
              <div className="px-3 py-2.5 flex flex-col gap-2">
                {abVariants.map((variant, vi) => (
                  <div key={vi} className="flex items-center gap-2">
                    <input
                      value={variant.label}
                      onChange={(e) => {
                        const next = [...abVariants];
                        next[vi] = { ...next[vi], label: e.target.value };
                        updateABVariants(next);
                      }}
                      placeholder="label"
                      className="bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50 flex-1"
                    />
                    <input
                      type="number"
                      min={1}
                      value={variant.weight}
                      onChange={(e) => {
                        const next = [...abVariants];
                        next[vi] = { ...next[vi], weight: Number(e.target.value) };
                        updateABVariants(next);
                      }}
                      className="bg-muted/40 border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50 w-16"
                    />
                    <button
                      onClick={() => updateABVariants(abVariants.filter((_, i) => i !== vi))}
                      className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => updateABVariants([...abVariants, { label: `variant-${abVariants.length + 1}`, weight: 50, config: {} }])}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add variant
                </button>
                {abVariants.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Weights: {abVariants.map((v) => `${v.label}=${v.weight}`).join(", ")}
                    {" "}({abVariants.reduce((s, v) => s + v.weight, 0)} total)
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Run trace viewer ──────────────────────────────────────────────────────────

function RunTracePanel({ result, onClose }: { result: RunResult; onClose: () => void }) {
  const statusCls = {
    ok:      "text-chart-3 bg-chart-3/10 border-chart-3/30",
    partial: "text-chart-5 bg-chart-5/10 border-chart-5/30",
    failed:  "text-destructive bg-destructive/10 border-destructive/30",
  }[result.status];

  return (
    <div className="flex flex-col gap-4 p-5 bg-card border border-border rounded-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{result.pipelineName}</h3>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{result.runId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-medium border rounded-full px-2.5 py-0.5", statusCls)}>
            {result.status}
          </span>
          <span className="text-[11px] text-muted-foreground">{result.totalMs}ms</span>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Step trace */}
      <div className="flex flex-col gap-1.5">
        {result.steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="flex flex-col items-center mt-1">
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                step.status === "ok"      && "bg-chart-3/20 text-chart-3 border border-chart-3/30",
                step.status === "error"   && "bg-destructive/20 text-destructive border border-destructive/30",
                step.status === "skipped" && "bg-muted/40 text-muted-foreground border border-border",
                step.status === "timeout" && "bg-chart-5/20 text-chart-5 border border-chart-5/30",
              )}>
                {i + 1}
              </div>
              {i < result.steps.length - 1 && (
                <div className={cn("w-px flex-1 mt-0.5 min-h-[14px]",
                  step.status === "ok" ? "bg-chart-3/30" : "bg-border"
                )} />
              )}
            </div>
            <div className="flex-1 pb-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">{step.label}</span>
                <StepStatusBadge status={step.status} />
                <span className="text-[10px] text-muted-foreground">{step.durationMs}ms</span>
                {step.retryCount > 0 && (
                  <span className="text-[10px] text-chart-5">retried {step.retryCount}x</span>
                )}
                {step.variant && (
                  <span className="text-[10px] text-chart-5 bg-chart-5/10 border border-chart-5/20 rounded px-1.5 py-0.5">
                    {step.variant}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{step.agentName}</p>
              {step.error && (
                <p className="text-[11px] text-destructive mt-0.5">{step.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {result.errors.length > 0 && (
        <div className="bg-destructive/8 border border-destructive/25 rounded-lg px-3 py-2.5">
          {result.errors.map((e, i) => (
            <p key={i} className="text-xs text-destructive">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PipelineBuilder() {
  const [agents, setAgents]               = useState<AgentEntry[]>([]);
  const [pipelines, setPipelines]         = useState<PipelineDef[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);

  // Editor state
  const [editId, setEditId]               = useState("");
  const [editName, setEditName]           = useState("");
  const [editDesc, setEditDesc]           = useState("");
  const [editSteps, setEditSteps]         = useState<PipelineStep[]>([]);
  const [editDefault, setEditDefault]     = useState(false);
  const [editEnabled, setEditEnabled]     = useState(true);
  const [isDirty, setIsDirty]             = useState(false);

  // Drag
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [dragState, setDragState]         = useState<{ drag: number | null; over: number | null }>({ drag: null, over: null });

  // Agent picker
  const [showPicker, setShowPicker]       = useState(false);

  // Run
  const [running, setRunning]             = useState(false);
  const [runResult, setRunResult]         = useState<RunResult | null>(null);

  // UI
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [toast, setToast]                 = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsRes, pipesRes] = await Promise.all([
        fetch("/api/agents/registry"),
        fetch("/api/pipeline/definitions"),
      ]);
      const agentsJson = await agentsRes.json();
      const pipesJson  = await pipesRes.json();
      setAgents(agentsJson.agents ?? []);
      const defs: PipelineDef[] = pipesJson.pipelines ?? [];
      setPipelines(defs);
      // Auto-select default or first
      if (!activePipelineId) {
        const def = defs.find((p) => p.isDefault) ?? defs[0];
        if (def) loadIntoEditor(def);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  function loadIntoEditor(def: PipelineDef) {
    setActivePipelineId(def.id);
    setEditId(def.id);
    setEditName(def.name);
    setEditDesc(def.description);
    setEditSteps(JSON.parse(JSON.stringify(def.steps))); // deep clone
    setEditDefault(def.isDefault);
    setEditEnabled(def.enabled);
    setIsDirty(false);
    setRunResult(null);
  }

  function newPipeline() {
    const id = `pipeline-${Date.now()}`;
    setActivePipelineId(null);
    setEditId(id);
    setEditName("New Pipeline");
    setEditDesc("");
    setEditSteps([]);
    setEditDefault(false);
    setEditEnabled(true);
    setIsDirty(true);
    setRunResult(null);
  }

  // ── Step management ─────────────────────────────────────────────────────────

  function addStep(agent: AgentEntry) {
    const step: PipelineStep = {
      id:        `step-${Date.now()}`,
      agentName: agent.name,
      label:     agent.name,
      retry:     { maxRetries: 1, backoffMs: 500 },
      timeoutMs: 60000,
    };
    setEditSteps((prev) => [...prev, step]);
    setIsDirty(true);
    setShowPicker(false);
  }

  function updateStep(index: number, patch: Partial<PipelineStep>) {
    setEditSteps((prev) => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
    setIsDirty(true);
  }

  function removeStep(index: number) {
    setEditSteps((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  function handleDragStart(index: number) {
    dragIdx.current = index;
    overIdx.current = index;
    setDragState({ drag: index, over: index });
  }

  function handleDragEnter(index: number) {
    if (index === overIdx.current) return;
    overIdx.current = index;
    setDragState((prev) => ({ ...prev, over: index }));
  }

  function handleDragEnd() {
    const from = dragIdx.current;
    const to   = overIdx.current;
    dragIdx.current = null;
    overIdx.current = null;
    setDragState({ drag: null, over: null });
    if (from === null || to === null || from === to) return;
    setEditSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setIsDirty(true);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function savePipeline() {
    setSaving(true);
    try {
      const existing = pipelines.find((p) => p.id === editId);
      const method   = existing ? "PATCH" : "POST";
      const url      = existing ? "/api/pipeline/definitions" : "/api/pipeline/definitions";

      const body = existing
        ? { id: editId, name: editName, description: editDesc, steps: editSteps, isDefault: editDefault, enabled: editEnabled }
        : { id: editId, name: editName, description: editDesc, steps: editSteps, isDefault: editDefault, enabled: editEnabled, createdBy: "admin" };

      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      showToast("Pipeline saved");
      setIsDirty(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deletePipeline(id: string) {
    if (!confirm(`Delete pipeline "${id}"?`)) return;
    await fetch(`/api/pipeline/definitions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (activePipelineId === id) newPipeline();
    await loadAll();
  }

  // ── Execute ─────────────────────────────────────────────────────────────────

  async function executePipeline() {
  if (editSteps.length === 0) { setError("Add at least one step"); return; }
  if (!editId.trim()) { setError("Save the pipeline definition before executing it"); return; }
  setRunning(true);
  setRunResult(null);
  setError(null);
  try {
  let executionId = editId;
  const persisted = pipelines.find((pipeline) => pipeline.id === editId);
  if (!persisted || isDirty) {
    const saveMethod = persisted ? "PATCH" : "POST";
    const saveResponse = await fetch("/api/pipeline/definitions", {
      method: saveMethod,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, name: editName, description: editDesc, steps: editSteps, isDefault: editDefault, enabled: editEnabled, createdBy: "admin" }),
    });
    const savePayload = await saveResponse.json() as { pipeline?: PipelineDef; validation?: { valid: boolean; errors: string[] }; error?: string };
    if (!saveResponse.ok) throw new Error(savePayload.error ?? `Pipeline save failed with HTTP ${saveResponse.status}`);
    if (!savePayload.validation?.valid) throw new Error(savePayload.validation?.errors.join("; ") || "Pipeline validation failed");
    executionId = savePayload.pipeline?.id ?? editId;
    setPipelines((current) => current.some((pipeline) => pipeline.id === executionId) ? current.map((pipeline) => pipeline.id === executionId ? savePayload.pipeline! : pipeline) : [...current, savePayload.pipeline!]);
    setActivePipelineId(executionId);
    setIsDirty(false);
  }
  const res = await fetch("/api/pipeline/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pipelineId: executionId, input: { query: "demo run" }, role: "admin" }),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const json = contentType.includes("application/json") ? await res.json() as RunResult & { error?: string } : null;
  if (!res.ok) throw new Error(json?.error ?? `Pipeline execution failed with HTTP ${res.status}`);
  if (!json || !Array.isArray(json.steps) || !Array.isArray(json.errors)) throw new Error("Pipeline execution returned an invalid response");
  setRunResult(json);
  } catch (e) {
  setError(e instanceof Error ? e.message : "Execution failed");
  } finally {
  setRunning(false);
  }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Layers className="w-[18px] h-[18px] text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Pipeline Builder</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading..." : `${pipelines.length} pipelines — ${agents.filter(a => a.enabled).length} agents available`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/40 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={newPipeline}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Pipeline
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-destructive/8 border border-destructive/25 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-xs text-destructive flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="flex items-center gap-2 bg-chart-3/8 border border-chart-3/25 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-chart-3" />
          <p className="text-xs text-chart-3">{toast}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">

        {/* ── Left panel: pipeline list ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Saved Pipelines
          </p>
          {loading ? (
            [1,2,3,4].map((i) => <div key={i} className="h-12 rounded-xl bg-muted/40 animate-pulse" />)
          ) : (
            pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => loadIntoEditor(p)}
                className={cn(
                  "w-full flex flex-col gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all",
                  activePipelineId === p.id
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-card border-border hover:border-primary/20 text-foreground",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="text-[9px] border border-chart-5/30 bg-chart-5/10 text-chart-5 rounded px-1 shrink-0">default</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span>{p.steps.length} steps</span>
                  {!p.enabled && <span className="text-destructive/70">· disabled</span>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── Right panel: editor ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Pipeline meta */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">Pipeline name</label>
                <input
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setIsDirty(true); }}
                  className="bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">Pipeline ID</label>
                <input
                  value={editId}
                  onChange={(e) => { setEditId(e.target.value); setIsDirty(true); }}
                  className="bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Description</label>
              <textarea
                rows={2}
                value={editDesc}
                onChange={(e) => { setEditDesc(e.target.value); setIsDirty(true); }}
                className="bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs text-foreground resize-none outline-none focus:border-primary/50 transition-colors leading-relaxed"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editDefault}
                  onChange={(e) => { setEditDefault(e.target.checked); setIsDirty(true); }}
                  className="w-3.5 h-3.5 accent-primary"
                />
                <span className="text-xs text-foreground">Set as default pipeline</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={(e) => { setEditEnabled(e.target.checked); setIsDirty(true); }}
                  className="w-3.5 h-3.5 accent-primary"
                />
                <span className="text-xs text-foreground">Enabled</span>
              </label>
            </div>
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                Pipeline Steps
                <span className="ml-1.5 text-muted-foreground font-normal">({editSteps.length})</span>
              </p>
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Agent
              </button>
            </div>

            {editSteps.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 rounded-xl bg-muted/40 border border-border flex items-center justify-center">
                  <Plus className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">No steps yet</p>
                <p className="text-xs text-muted-foreground/70 max-w-xs">
                  Click &ldquo;Add Agent&rdquo; to start building your pipeline. Drag steps to reorder.
                </p>
                <button
                  onClick={() => setShowPicker(true)}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  Add first agent
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {editSteps.map((step, i) => (
                  <StepEditor
                    key={step.id}
                    step={step}
                    agent={agents.find((a) => a.name === step.agentName)}
                    index={i}
                    total={editSteps.length}
                    onUpdate={(patch) => updateStep(i, patch)}
                    onRemove={() => removeStep(i)}
                    isDragging={dragState.drag === i}
                    isOver={dragState.over === i && dragState.drag !== i}
                    onDragStart={handleDragStart}
                    onDragEnter={handleDragEnter}
                    onDragEnd={handleDragEnd}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={savePipeline}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving..." : "Save Pipeline"}
            </button>

            <button
              onClick={executePipeline}
              disabled={running || editSteps.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-chart-3/15 border border-chart-3/30 text-chart-3 text-xs font-medium hover:bg-chart-3/25 disabled:opacity-40 transition-colors"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {running ? "Running..." : "Execute"}
            </button>

            {activePipelineId && !pipelines.find((p) => p.id === activePipelineId)?.isDefault && (
              <button
                onClick={() => activePipelineId && deletePipeline(activePipelineId)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-destructive/30 bg-destructive/8 text-destructive text-xs font-medium hover:bg-destructive/15 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}

            {isDirty && (
              <span className="text-[11px] text-chart-5 flex items-center gap-1">
                <Info className="w-3 h-3" /> Unsaved changes
              </span>
            )}
          </div>

          {/* Run result */}
          {runResult && (
            <RunTracePanel result={runResult} onClose={() => setRunResult(null)} />
          )}
        </div>
      </div>

      {/* Agent picker modal */}
      {showPicker && (
        <AgentPickerModal
          agents={agents}
          onSelect={addStep}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
