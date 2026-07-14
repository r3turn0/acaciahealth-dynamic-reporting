"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Upload,
  Search,
  Database,
  Layers,
  Link2,
  Sliders,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  X,
  Plus,
  BarChart2,
  Clock,
  Hash,
  Type,
  Key,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  TrendingUp,
  GitBranch,
  Zap,
  Shield,
  Info,
} from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import type {
  Column,
  FilterOperator,
  ReportFilter,
  ReportPlan,
  SchemaModel,
  Table,
} from "@/lib/schema/types";
import {
  setCachedModel,
  getCachedModel,
  clearCachedModel,
  discoverFields,
  resolveJoins,
  generateFilterDefinitions,
  searchByKeywords,
  buildReportPlan,
  generateSuggestions,
  type FilterDefinition,
  type ReportSuggestion,
} from "@/lib/schema/engine";
import { parseMetadata } from "@/lib/schema/parser";
import { transformToSchemaModel } from "@/lib/schema/transformer";
import {
  tagAllTables,
  addUserTag,
  removeUserTag,
  TAG_CATEGORIES,
  type TagStore,
  type TableTag,
  type TagColor,
} from "@/lib/agents/tableTagger";
import { setTagStoreForSearch } from "@/lib/schema/engine";
import { recordQuery, predictTags, getTopTags } from "@/lib/agents/queryLearner";

// ── Utilities ─────────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  finance:        "text-chart-5 bg-chart-5/10 border-chart-5/20",
  billing:        "text-chart-2 bg-chart-2/10 border-chart-2/20",
  clinical:       "text-chart-3 bg-chart-3/10 border-chart-3/20",
  payroll:        "text-chart-4 bg-chart-4/10 border-chart-4/20",
  core_reference: "text-primary bg-primary/10 border-primary/20",
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  primary_key:    <Key  className="w-3 h-3 text-chart-5" />,
  foreign_key:    <Link2 className="w-3 h-3 text-chart-2" />,
  measure:        <Hash  className="w-3 h-3 text-chart-3" />,
  dimension:      <Type  className="w-3 h-3 text-primary" />,
  time_dimension: <Clock className="w-3 h-3 text-chart-4" />,
  audit:          <Shield className="w-3 h-3 text-muted-foreground" />,
};

function DomainBadge({ domain }: { domain: string }) {
  const cls = DOMAIN_COLORS[domain] ?? "text-muted-foreground bg-muted border-border";
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize", cls)}>
      {domain.replace(/_/g, " ")}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
      {ROLE_ICONS[role]}
      {role.replace(/_/g, " ")}
    </span>
  );
}

function ComputedBadge() {
  return (
    <span className="text-[9px] px-1 py-0 rounded bg-chart-4/10 text-chart-4 border border-chart-4/20 font-mono leading-tight">
      computed
    </span>
  );
}

function IdentityBadge() {
  return (
    <span className="text-[9px] px-1 py-0 rounded bg-chart-5/10 text-chart-5 border border-chart-5/20 font-mono leading-tight">
      identity
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MetadataReportEngine() {
  const [model, setModel] = useState<SchemaModel | null>(() => getCachedModel());
  const [activePanel, setActivePanel] = useState<"datasets" | "fields" | "joins" | "builder" | "suggestions" | "tags">("datasets");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedMeasures, setSelectedMeasures] = useState<{ table: string; column: string }[]>([]);
  const [selectedDimensions, setSelectedDimensions] = useState<{ table: string; column: string }[]>([]);
  const [activeFilters, setActiveFilters] = useState<ReportFilter[]>([]);
  const [reportPlan, setReportPlan] = useState<ReportPlan | null>(null);
  const [planCopied, setPlanCopied] = useState(false);
  const [tagStore, setTagStore] = useState<TagStore>({});

  function handleModelReady(m: SchemaModel) {
    setCachedModel(m);
    setModel(m);
    setSelectedTableIds([]);
    setSelectedMeasures([]);
    setSelectedDimensions([]);
    setActiveFilters([]);
    setReportPlan(null);
    setActivePanel("datasets");
    // Auto-tag all tables and wire into the TF-IDF search engine
    const store = tagAllTables(Object.values(m.tables));
    setTagStore(store);
    setTagStoreForSearch(store);
  }

  function handleTagOverride(tableId: string, action: "add" | "remove", tag: string) {
    setTagStore((prev) => {
      const next = action === "add"
        ? addUserTag(prev, tableId, tag)
        : removeUserTag(prev, tableId, tag);
      setTagStoreForSearch(next);
      return next;
    });
  }

  function handleRetag(m: SchemaModel) {
    const store = tagAllTables(Object.values(m.tables));
    setTagStore(store);
    setTagStoreForSearch(store);
  }

  function handleReset() {
    clearCachedModel();
    setModel(null);
    setSelectedTableIds([]);
    setSelectedMeasures([]);
    setSelectedDimensions([]);
    setActiveFilters([]);
    setReportPlan(null);
  }

  function toggleTable(id: string) {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
    setSelectedMeasures([]);
    setSelectedDimensions([]);
    setReportPlan(null);
  }

  function toggleMeasure(table: string, column: string) {
    const key = `${table}.${column}`;
    setSelectedMeasures((prev) => {
      const exists = prev.find((m) => `${m.table}.${m.column}` === key);
      return exists ? prev.filter((m) => `${m.table}.${m.column}` !== key) : [...prev, { table, column }];
    });
    setReportPlan(null);
  }

  function toggleDimension(table: string, column: string) {
    const key = `${table}.${column}`;
    setSelectedDimensions((prev) => {
      const exists = prev.find((d) => `${d.table}.${d.column}` === key);
      return exists ? prev.filter((d) => `${d.table}.${d.column}` !== key) : [...prev, { table, column }];
    });
    setReportPlan(null);
  }

  function buildPlan() {
    if (!model) return;
    const plan = buildReportPlan(model, {
      tableIds: selectedTableIds,
      measureColumns: selectedMeasures,
      dimensionColumns: selectedDimensions,
      filters: activeFilters,
    });
    setReportPlan(plan);
  }

  async function copyPlan() {
    if (!reportPlan) return;
    await copyToClipboard(JSON.stringify(reportPlan, null, 2));
    setPlanCopied(true);
    setTimeout(() => setPlanCopied(false), 1500);
  }

  const panels = [
    { id: "datasets",    label: "Datasets",    icon: Database },
    { id: "fields",      label: "Fields",      icon: Layers },
    { id: "joins",       label: "Joins",       icon: GitBranch },
    { id: "builder",     label: "Builder",     icon: Sliders },
    { id: "suggestions", label: "Suggestions", icon: Lightbulb },
    { id: "tags",        label: "Tags",        icon: Zap },
  ] as const;

  if (!model) {
    return <MetadataUploader onModelReady={handleModelReady} />;
  }

  const fields = discoverFields(model, selectedTableIds);
  const resolvedJoins = resolveJoins(model, selectedTableIds);
  const filterDefs = generateFilterDefinitions(model, selectedTableIds);
  const suggestions = generateSuggestions(model);

  return (
    <div className="flex flex-col gap-4">
      {/* Model summary bar */}
      <ModelSummaryBar model={model} onReset={handleReset} />

      {/* Panel tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted border border-border rounded-lg w-fit">
        {panels.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActivePanel(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activePanel === id
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === "datasets" && selectedTableIds.length > 0 && (
              <span className="ml-0.5 px-1 py-0 rounded text-[10px] bg-primary/20 text-primary font-semibold">
                {selectedTableIds.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {activePanel === "datasets" && (
          <DatasetSelector
            model={model}
            selectedTableIds={selectedTableIds}
            onToggleTable={toggleTable}
          />
        )}
        {activePanel === "fields" && (
          <SmartFieldPanel
            model={model}
            fields={fields}
            selectedMeasures={selectedMeasures}
            selectedDimensions={selectedDimensions}
            onToggleMeasure={toggleMeasure}
            onToggleDimension={toggleDimension}
            selectedTableIds={selectedTableIds}
          />
        )}
        {activePanel === "joins" && (
          <JoinVisualizer
            model={model}
            selectedTableIds={selectedTableIds}
            resolvedJoins={resolvedJoins}
          />
        )}
        {activePanel === "builder" && (
          <QueryBuilderPanel
            model={model}
            selectedTableIds={selectedTableIds}
            selectedMeasures={selectedMeasures}
            selectedDimensions={selectedDimensions}
            filterDefs={filterDefs}
            activeFilters={activeFilters}
            onFiltersChange={setActiveFilters}
            reportPlan={reportPlan}
            onBuildPlan={buildPlan}
            onCopyPlan={copyPlan}
            planCopied={planCopied}
          />
        )}
        {activePanel === "suggestions" && (
          <SuggestionsPanel
            suggestions={suggestions}
            model={model}
            onApplySuggestion={(s) => {
              setSelectedTableIds(s.tables);
              setActivePanel("fields");
            }}
          />
        )}
        {activePanel === "tags" && (
          <TagsPanel
            model={model}
            tagStore={tagStore}
            onTagOverride={handleTagOverride}
            onRetag={() => handleRetag(model)}
          />
        )}
      </div>
    </div>
  );
}

// ── 0. Metadata uploader ──────────────────────────────────────────────────────

function MetadataUploader({ onModelReady }: { onModelReady: (m: SchemaModel) => void }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function processRaw(raw: unknown) {
    if (!raw || typeof raw !== "object") throw new Error("Body must be a JSON object.");
    const tables = parseMetadata(raw as Parameters<typeof parseMetadata>[0]);
    if (tables.length === 0)
      throw new Error(
        'No tables found. Expected an array at "tables" with entries containing "schema", "table", "columns", and "foreign_keys".'
      );
    return transformToSchemaModel(tables, raw as Parameters<typeof transformToSchemaModel>[1]);
  }

  async function processFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const model = await processRaw(raw);
      onModelReady(model);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse metadata");
    } finally {
      setLoading(false);
    }
  }

  async function processText(text: string) {
    setLoading(true);
    setError(null);
    try {
      const raw = JSON.parse(text);
      const model = await processRaw(raw);
      onModelReady(model);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse metadata");
    } finally {
      setLoading(false);
    }
  }

  async function loadDemo() {
    await processText(JSON.stringify(DEMO_METADATA));
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Metadata-Driven Report Engine</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Upload your <code className="font-mono text-primary">metadata.json</code> to build a full
          schema intelligence model — column role inference, prefix stripping, domain grouping,
          BFS join paths, and ReportPlan generation. Supports the AcaciaHealth export format with{" "}
          <code className="font-mono text-primary">schema</code>,{" "}
          <code className="font-mono text-primary">table</code>,{" "}
          <code className="font-mono text-primary">primary_keys</code>, and structured{" "}
          <code className="font-mono text-primary">foreign_keys</code>.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) processFile(file);
        }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
        />
        {loading ? (
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        ) : (
          <Upload className="w-8 h-8 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {loading ? "Processing metadata..." : "Drop metadata.json here"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs text-muted-foreground">or try the demo</span>
        <div className="flex-1 border-t border-border" />
      </div>
      <button
        onClick={loadDemo}
        disabled={loading}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors text-sm text-foreground disabled:opacity-50"
      >
        <Database className="w-4 h-4 text-primary" />
        Load demo metadata (healthcare schema)
      </button>

      {/* Paste box */}
      <PasteBox onSubmit={processText} loading={loading} />
    </div>
  );
}

function PasteBox({ onSubmit, loading }: { onSubmit: (t: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <span>Paste JSON directly</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="border-t border-border p-3 flex flex-col gap-2">
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"generated_at": "...", "tables": [{"schema": "Accounting", "table": "CASH_DEPOSITS", ...}]}'
            className="w-full bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <button
            onClick={() => onSubmit(text)}
            disabled={!text.trim() || loading}
            className="self-end px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Processing..." : "Process JSON"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Model summary bar ─────────────────────────────────────────────────────────

function ModelSummaryBar({ model, onReset }: { model: SchemaModel; onReset: () => void }) {
  const tableCount  = Object.keys(model.tables).length;
  const domainCount = Object.keys(model.domains).length;
  const edgeCount   = model.graph.edges.filter((e) => e.type === "many-to-one").length;
  const indexSize   = Object.keys(model.searchIndex).length;

  const schemaNames = [...new Set(Object.values(model.tables).map((t) => t.schema))];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-card border border-border rounded-lg">
      <div className="flex flex-wrap items-center gap-5">
        <StatChip label="Tables"        value={tableCount}  color="primary"  />
        <StatChip label="Schemas"       value={schemaNames.length} color="chart-3" />
        <StatChip label="Domains"       value={domainCount} color="chart-2"  />
        <StatChip label="Relationships" value={edgeCount}   color="chart-4"  />
        <StatChip label="Index terms"   value={indexSize}   color="chart-5"  />
        {model.sourceGeneratedAt && (
          <span className="text-[10px] text-muted-foreground hidden md:inline">
            exported {new Date(model.sourceGeneratedAt).toLocaleDateString()}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
          {model.sourceHash}
        </span>
      </div>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Load new metadata
      </button>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("text-sm font-semibold", `text-${color}`)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ── 1. Dataset Selector ───────────────────────────────────────────────────────

function DatasetSelector({
  model,
  selectedTableIds,
  onToggleTable,
}: {
  model: SchemaModel;
  selectedTableIds: string[];
  onToggleTable: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    return searchByKeywords(model, search);
  }, [model, search]);

  const displayTables: Record<string, string[]> = useMemo(() => {
    if (searchResults) return { "Search Results": searchResults };
    return model.domains;
  }, [model, searchResults]);

  useEffect(() => {
    const firstDomain = Object.keys(model.domains)[0];
    if (firstDomain && !expandedDomain) setExpandedDomain(firstDomain);
  }, [model]);

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Dataset Selector</h3>
        {selectedTableIds.length > 0 && (
          <span className="text-[11px] text-primary">{selectedTableIds.length} selected</span>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tables, columns, FK targets, domains..."
          className="w-full bg-muted border border-border rounded-md pl-8 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {Object.entries(displayTables).map(([domain, ids]) => (
          <DomainGroup
            key={domain}
            domain={domain}
            tableIds={ids}
            model={model}
            selectedTableIds={selectedTableIds}
            expanded={expandedDomain === domain || !!search}
            onToggleExpand={() =>
              setExpandedDomain((prev) => (prev === domain ? null : domain))
            }
            onToggleTable={onToggleTable}
          />
        ))}
      </div>
    </div>
  );
}

function DomainGroup({
  domain, tableIds, model, selectedTableIds, expanded, onToggleExpand, onToggleTable,
}: {
  domain: string; tableIds: string[]; model: SchemaModel; selectedTableIds: string[];
  expanded: boolean; onToggleExpand: () => void; onToggleTable: (id: string) => void;
}) {
  const selectedInGroup = tableIds.filter((id) => selectedTableIds.includes(id)).length;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={onToggleExpand}
        className="flex items-center justify-between w-full px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground capitalize">
            {domain.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-muted-foreground">({tableIds.length})</span>
        </div>
        {selectedInGroup > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">
            {selectedInGroup} selected
          </span>
        )}
      </button>

      {expanded && (
        <div className="divide-y divide-border/40">
          {tableIds.map((id) => {
            const table = model.tables[id];
            if (!table) return null;
            return (
              <TableRow
                key={id}
                table={table}
                selected={selectedTableIds.includes(id)}
                hints={model.entityHints[id]}
                onToggle={() => onToggleTable(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TableRow({
  table, selected, hints, onToggle,
}: {
  table: Table; selected: boolean; hints: SchemaModel["entityHints"][string]; onToggle: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasMeta =
    table.meta.triggers.length > 0 ||
    table.meta.checkConstraints.length > 0 ||
    table.meta.indexes.length > 0;

  return (
    <div className={cn(
      "border-l-2 transition-colors",
      selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/30"
    )}>
      <div className="flex items-start justify-between px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex flex-col gap-0.5 min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-foreground truncate">
              {table.name}
            </span>
            <span className="text-[9px] text-muted-foreground font-mono">{table.schema}</span>
          </div>
          {table.description && (
            <span className="text-[10px] text-muted-foreground truncate">{table.description}</span>
          )}
          <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{table.columns.length} cols</span>
            <span className="text-[10px] text-muted-foreground">{table.foreignKeys.length} FK</span>
            {hints?.measures.length > 0 && (
              <span className="text-[10px] text-chart-3">{hints.measures.length} measures</span>
            )}
            {hints?.timeColumns.length > 0 && (
              <span className="text-[10px] text-chart-4">{hints.timeColumns.length} dates</span>
            )}
            {table.isMemoryOptimized && (
              <span className="text-[9px] px-1 py-0 rounded bg-chart-3/10 text-chart-3 border border-chart-3/20 font-mono">
                in-memory
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          <DomainBadge domain={table.domain} />
          {hasMeta && (
            <button
              onClick={(e) => { e.stopPropagation(); setDetailsOpen((v) => !v); }}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              title="View table meta (triggers, constraints, indexes)"
            >
              <Info className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
          {selected && <CheckCircle className="w-3.5 h-3.5 text-primary" />}
        </div>
      </div>

      {detailsOpen && (
        <div className="px-3 pb-3 flex flex-col gap-2 border-t border-border/40 bg-muted/10">
          <MetaSection label="Indexes"     items={table.meta.indexes}          color="primary"  />
          <MetaSection label="Triggers"    items={table.meta.triggers}         color="chart-4"  />
          <MetaSection label="Constraints" items={table.meta.checkConstraints} color="chart-5"  />
          {table.primaryKeys.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-chart-5 uppercase tracking-wide mb-1">
                Primary Keys
              </p>
              <div className="flex flex-wrap gap-1">
                {table.primaryKeys.map((k) => (
                  <code key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-chart-5/10 text-chart-5 border border-chart-5/20">
                    {k}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaSection({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={cn("text-[9px] font-semibold uppercase tracking-wide mb-1", `text-${color}`)}>
        {label} ({items.length})
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <code
            key={item}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60 max-w-xs truncate"
            title={item}
          >
            {item}
          </code>
        ))}
      </div>
    </div>
  );
}

// ── 2. Smart Field Panel ──────────────────────────────────────────────────────

function SmartFieldPanel({
  model,
  fields,
  selectedMeasures,
  selectedDimensions,
  onToggleMeasure,
  onToggleDimension,
  selectedTableIds,
}: {
  model: SchemaModel;
  fields: ReturnType<typeof discoverFields>;
  selectedMeasures: { table: string; column: string }[];
  selectedDimensions: { table: string; column: string }[];
  onToggleMeasure: (t: string, c: string) => void;
  onToggleDimension: (t: string, c: string) => void;
  selectedTableIds: string[];
}) {
  if (selectedTableIds.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center gap-2 text-center">
        <Layers className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Select datasets first to discover fields</p>
      </div>
    );
  }

  // Count audit columns for info display
  const auditCount = selectedTableIds.reduce((acc, id) => {
    return acc + (model.entityHints[id]?.auditColumns.length ?? 0);
  }, 0);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Smart Field Panel</h3>
        {auditCount > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {auditCount} audit columns hidden
          </span>
        )}
      </div>

      <FieldSection
        title="Measures"
        icon={<Hash className="w-3.5 h-3.5 text-chart-3" />}
        items={fields.measures}
        selectedKeys={selectedMeasures.map((m) => `${m.table}.${m.column}`)}
        onToggle={(t, c) => onToggleMeasure(t, c)}
        emptyText="No numeric measure columns in selected tables"
        accentClass="text-chart-3"
        badgeClass="bg-chart-3/10 text-chart-3 border-chart-3/20"
      />

      <FieldSection
        title="Dimensions"
        icon={<Type className="w-3.5 h-3.5 text-primary" />}
        items={fields.dimensions}
        selectedKeys={selectedDimensions.map((d) => `${d.table}.${d.column}`)}
        onToggle={(t, c) => onToggleDimension(t, c)}
        emptyText="No categorical dimension columns found"
        accentClass="text-primary"
        badgeClass="bg-primary/10 text-primary border-primary/20"
      />

      <FieldSection
        title="Time Dimensions"
        icon={<Clock className="w-3.5 h-3.5 text-chart-4" />}
        items={fields.timeColumns}
        selectedKeys={[]}
        onToggle={() => {}}
        emptyText="No date/time columns found"
        accentClass="text-chart-4"
        badgeClass="bg-chart-4/10 text-chart-4 border-chart-4/20"
        readOnly
      />
    </div>
  );
}

function FieldSection({
  title, icon, items, selectedKeys, onToggle, emptyText, accentClass, badgeClass, readOnly,
}: {
  title: string;
  icon: React.ReactNode;
  items: { table: string; column: Column }[];
  selectedKeys: string[];
  onToggle: (table: string, column: string) => void;
  emptyText: string;
  accentClass: string;
  badgeClass: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className={cn("text-xs font-semibold", accentClass)}>{title}</h4>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground px-1">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {items.map(({ table, column }) => {
            const key = `${table}.${column.name}`;
            const selected = selectedKeys.includes(key);
            return (
              <button
                key={key}
                onClick={() => !readOnly && onToggle(table, column.name)}
                disabled={readOnly}
                className={cn(
                  "flex items-start justify-between gap-2 px-2.5 py-2 rounded-md border text-left transition-colors",
                  readOnly
                    ? "cursor-default border-border bg-muted/20"
                    : selected
                      ? `border ${badgeClass} bg-card`
                      : "border-border hover:border-primary/40 hover:bg-muted/40"
                )}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  {/* Display name (human-readable, prefix stripped) */}
                  <span className="text-[11px] font-medium text-foreground truncate">
                    {column.displayName}
                  </span>
                  {/* Raw column name + table */}
                  <span className="text-[9px] text-muted-foreground font-mono truncate">
                    {table.split(".").pop()}.{column.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono truncate">
                    {column.type}
                    {column.aggregation && ` · ${column.aggregation.toUpperCase()}`}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    {column.isComputed && <ComputedBadge />}
                    {column.isIdentity && <IdentityBadge />}
                  </div>
                </div>
                <RoleBadge role={column.role} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 3. Join Visualizer ────────────────────────────────────────────────────────

function JoinVisualizer({
  model,
  selectedTableIds,
  resolvedJoins,
}: {
  model: SchemaModel;
  selectedTableIds: string[];
  resolvedJoins: ReturnType<typeof resolveJoins>;
}) {
  if (selectedTableIds.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center gap-2 text-center">
        <GitBranch className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Select 2+ datasets to visualize joins</p>
      </div>
    );
  }

  const allEdges = model.graph.edges.filter(
    (e) =>
      selectedTableIds.includes(e.from) &&
      selectedTableIds.includes(e.to) &&
      e.type === "many-to-one"
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Join Visualizer</h3>

      {/* Node diagram */}
      <div className="border border-border rounded-md bg-muted/20 p-4 overflow-x-auto">
        <div className="flex flex-wrap gap-3 min-w-max">
          {selectedTableIds.map((id) => {
            const table = model.tables[id];
            const outEdges = allEdges.filter((e) => e.from === id);
            const isRoot = !allEdges.some((e) => e.to === id);

            return (
              <div key={id} className="flex items-center gap-2">
                <div className={cn(
                  "border rounded-md px-3 py-2.5 min-w-[150px]",
                  isRoot ? "border-primary bg-primary/10" : "border-chart-2/50 bg-chart-2/5"
                )}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-mono font-semibold text-foreground">
                      {table?.name ?? id}
                    </span>
                  </div>
                  {table && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] text-muted-foreground font-mono">
                        PK: {table.primaryKey}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {table.columns.length} cols · {table.foreignKeys.length} FK
                      </span>
                      <div className="mt-0.5">
                        <DomainBadge domain={table.domain} />
                      </div>
                    </div>
                  )}
                </div>

                {outEdges.map((edge) => (
                  <div key={`${edge.from}-${edge.to}`} className="flex items-center gap-1">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="h-px w-10 bg-chart-2/50" />
                      <span className="text-[8px] text-chart-2 font-mono truncate max-w-[80px]" title={edge.via}>
                        {edge.fromColumn} → {edge.toColumn}
                      </span>
                      <span className="text-[8px] text-muted-foreground">{edge.type.replace("-", " ")}</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-chart-2" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Resolved joins list */}
      {resolvedJoins.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Auto-resolved join path
          </h4>
          <div className="flex flex-col gap-1">
            {resolvedJoins.map((join, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border/50 rounded-md flex-wrap"
              >
                <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
                <code className="text-[11px] font-mono text-foreground">
                  {join.from.split(".").pop()}
                </code>
                <span className="text-[10px] text-muted-foreground">JOIN</span>
                <code className="text-[11px] font-mono text-foreground">
                  {join.to.split(".").pop()}
                </code>
                <span className="text-[10px] text-muted-foreground">ON</span>
                <code className="text-[11px] font-mono text-primary">{join.condition}</code>
                {join.via && (
                  <span className="text-[9px] text-muted-foreground font-mono truncate" title={join.via}>
                    [{join.via}]
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        selectedTableIds.length > 1 && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-chart-5/10 border border-chart-5/20">
            <AlertCircle className="w-3.5 h-3.5 text-chart-5 mt-0.5 shrink-0" />
            <p className="text-xs text-chart-5">
              No direct join path found between selected tables. They may require an intermediate
              bridge table not currently loaded.
            </p>
          </div>
        )
      )}

      <AllJoinPaths model={model} selectedTableIds={selectedTableIds} />
    </div>
  );
}

function AllJoinPaths({ model, selectedTableIds }: { model: SchemaModel; selectedTableIds: string[] }) {
  const [open, setOpen] = useState(false);

  const relevant = Object.entries(model.joinPaths).filter(([src]) =>
    selectedTableIds.includes(src)
  );

  if (relevant.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <span>All reachable join paths from selection</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="border-t border-border p-3 flex flex-col gap-3">
          {relevant.map(([src, paths]) => (
            <div key={src}>
              <p className="text-[10px] font-mono font-semibold text-primary mb-1.5">{src}</p>
              <div className="flex flex-col gap-0.5 pl-3">
                {Object.entries(paths).map(([target, path]) => (
                  <div key={target} className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-muted-foreground">→</span>
                    <span className="text-foreground">{target.split(".").pop()}</span>
                    <span className="text-muted-foreground/60 text-[9px]">
                      ({path.length - 1} hop{path.length > 2 ? "s" : ""})
                    </span>
                    <span className="text-muted-foreground/40 text-[9px]">
                      [{path.map((p) => p.split(".").pop()).join(" → ")}]
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 4. Query Builder ──────────────────────────────────────────────────────────

function QueryBuilderPanel({
  model,
  selectedTableIds,
  selectedMeasures,
  selectedDimensions,
  filterDefs,
  activeFilters,
  onFiltersChange,
  reportPlan,
  onBuildPlan,
  onCopyPlan,
  planCopied,
}: {
  model: SchemaModel;
  selectedTableIds: string[];
  selectedMeasures: { table: string; column: string }[];
  selectedDimensions: { table: string; column: string }[];
  filterDefs: FilterDefinition[];
  activeFilters: ReportFilter[];
  onFiltersChange: (f: ReportFilter[]) => void;
  reportPlan: ReportPlan | null;
  onBuildPlan: () => void;
  onCopyPlan: () => void;
  planCopied: boolean;
}) {
  if (selectedTableIds.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center gap-2 text-center">
        <Sliders className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Select datasets and fields to build a query</p>
      </div>
    );
  }

  function addFilter() {
    const firstDef = filterDefs[0];
    if (!firstDef) return;
    onFiltersChange([...activeFilters, { table: firstDef.table, column: firstDef.column, operator: "=", value: "" }]);
  }

  function updateFilter(idx: number, patch: Partial<ReportFilter>) {
    onFiltersChange(activeFilters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  function removeFilter(idx: number) {
    onFiltersChange(activeFilters.filter((_, i) => i !== idx));
  }

  const canBuild = selectedTableIds.length > 0 && (selectedMeasures.length > 0 || selectedDimensions.length > 0);

  // Use displayName for summary tiles
  const measureLabels = selectedMeasures.map((m) => {
    const col = model.tables[m.table]?.columns.find((c) => c.name === m.column);
    return col?.displayName ?? m.column;
  });
  const dimensionLabels = selectedDimensions.map((d) => {
    const col = model.tables[d.table]?.columns.find((c) => c.name === d.column);
    return col?.displayName ?? d.column;
  });

  return (
    <div className="p-4 flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Query Builder</h3>

      {/* Selection summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Tables"     items={selectedTableIds.map((id) => id.split(".").pop()!)} color="primary"  />
        <SummaryTile label="Measures"   items={measureLabels}                                       color="chart-3"  />
        <SummaryTile label="Dimensions" items={dimensionLabels}                                     color="chart-2"  />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Filters</h4>
          <button
            onClick={addFilter}
            disabled={filterDefs.length === 0}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Add filter
          </button>
        </div>

        {activeFilters.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No filters applied.{filterDefs.length === 0 ? " Select tables with filterable columns first." : ' Click "Add filter" to restrict results.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeFilters.map((f, idx) => (
              <FilterRow
                key={idx}
                filter={f}
                filterDefs={filterDefs}
                model={model}
                onChange={(patch) => updateFilter(idx, patch)}
                onRemove={() => removeFilter(idx)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Build button */}
      <button
        onClick={onBuildPlan}
        disabled={!canBuild}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
      >
        <BarChart2 className="w-4 h-4" />
        Generate ReportPlan
      </button>

      {/* Plan output */}
      {reportPlan && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-foreground uppercase tracking-wide">
              ReportPlan JSON
            </h4>
            <button
              onClick={onCopyPlan}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {planCopied ? (
                <><Check className="w-3 h-3 text-chart-3" /> Copied</>
              ) : (
                <><Copy className="w-3 h-3" /> Copy</>
              )}
            </button>
          </div>
          <pre className="text-[11px] font-mono text-foreground/80 bg-muted border border-border rounded-md p-3 overflow-x-auto max-h-80 leading-relaxed">
            {JSON.stringify(reportPlan, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const OPERATORS: FilterOperator[] = ["=", "!=", ">", "<", ">=", "<=", "IN", "BETWEEN", "LIKE"];

function FilterRow({
  filter, filterDefs, model, onChange, onRemove,
}: {
  filter: ReportFilter;
  filterDefs: FilterDefinition[];
  model: SchemaModel;
  onChange: (p: Partial<ReportFilter>) => void;
  onRemove: () => void;
}) {
  const sel = `${filter.table}.${filter.column}`;

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/30 border border-border/60 rounded-md">
      <select
        value={sel}
        onChange={(e) => {
          // fd.column is a raw column name; table may include dots so split on first dot
          const fd = filterDefs.find((f) => `${f.table}.${f.column}` === e.target.value);
          if (fd) onChange({ table: fd.table, column: fd.column });
        }}
        className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {filterDefs.map((fd) => {
          const col = model.tables[fd.table]?.columns.find((c) => c.name === fd.column);
          const label = col ? `${fd.table.split(".").pop()}.${col.displayName}` : `${fd.table.split(".").pop()}.${fd.column}`;
          return (
            <option key={`${fd.table}.${fd.column}`} value={`${fd.table}.${fd.column}`}>
              {label}
            </option>
          );
        })}
      </select>

      <select
        value={filter.operator}
        onChange={(e) => onChange({ operator: e.target.value as FilterOperator })}
        className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>

      <input
        value={String(filter.value)}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="value"
        className="w-24 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <button onClick={onRemove}>
        <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
      </button>
    </div>
  );
}

function SummaryTile({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div className="border border-border rounded-md p-2.5 bg-muted/20">
      <p className={cn("text-[10px] font-semibold uppercase tracking-wide mb-1.5", `text-${color}`)}>
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">None</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <span key={item} className="text-[10px] font-mono text-foreground truncate">{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 5. Suggestions Panel ──────────────────────────────────────────────────────

const SUGGESTION_ICONS: Record<string, React.ReactNode> = {
  trending: <TrendingUp className="w-4 h-4 text-chart-3" />,
  bar:      <BarChart2  className="w-4 h-4 text-primary" />,
  join:     <Link2      className="w-4 h-4 text-chart-2" />,
  time:     <Clock      className="w-4 h-4 text-chart-4" />,
  filter:   <Sliders    className="w-4 h-4 text-chart-5" />,
};

function SuggestionsPanel({
  suggestions,
  model,
  onApplySuggestion,
}: {
  suggestions: ReportSuggestion[];
  model: SchemaModel;
  onApplySuggestion: (s: ReportSuggestion) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return suggestions;
    const q = search.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.includes(q))
    );
  }, [suggestions, search]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Suggestions</h3>
        <span className="text-[11px] text-muted-foreground">{suggestions.length} generated</span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter suggestions..."
          className="w-full bg-muted border border-border rounded-md pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No suggestions match your search.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((s, i) => (
            <button
              key={i}
              onClick={() => onApplySuggestion(s)}
              className="flex items-start gap-3 p-3 border border-border rounded-lg hover:border-primary/50 hover:bg-primary/5 text-left transition-colors group"
            >
              <div className="shrink-0 mt-0.5">
                {SUGGESTION_ICONS[s.icon] ?? <Lightbulb className="w-4 h-4 text-chart-4" />}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                  {s.label}
                </span>
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  {s.description}
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.tables.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60"
                    >
                      {t.split(".").pop()}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 6. Tags Panel ─────────────────────────────────────────────────────────────

// Tailwind colour map for each tag category
const TAG_COLOR_CLASSES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  admissions:    { bg: "bg-blue-500/10",   text: "text-blue-600",   border: "border-blue-500/30",   dot: "bg-blue-500"   },
  service_lines: { bg: "bg-purple-500/10", text: "text-purple-600", border: "border-purple-500/30", dot: "bg-purple-500" },
  kpi:           { bg: "bg-green-500/10",  text: "text-green-700",  border: "border-green-500/30",  dot: "bg-green-500"  },
  care_types:    { bg: "bg-orange-500/10", text: "text-orange-600", border: "border-orange-500/30", dot: "bg-orange-500" },
  patient_notes: { bg: "bg-teal-500/10",   text: "text-teal-600",   border: "border-teal-500/30",   dot: "bg-teal-500"   },
  billing:       { bg: "bg-yellow-500/10", text: "text-yellow-700", border: "border-yellow-500/30", dot: "bg-yellow-500" },
  clinical:      { bg: "bg-red-500/10",    text: "text-red-600",    border: "border-red-500/30",    dot: "bg-red-500"    },
  quality:       { bg: "bg-indigo-500/10", text: "text-indigo-600", border: "border-indigo-500/30", dot: "bg-indigo-500" },
  referrals:     { bg: "bg-pink-500/10",   text: "text-pink-600",   border: "border-pink-500/30",   dot: "bg-pink-500"   },
  staff:         { bg: "bg-cyan-500/10",   text: "text-cyan-700",   border: "border-cyan-500/30",   dot: "bg-cyan-500"   },
  pharmacy:      { bg: "bg-amber-500/10",  text: "text-amber-700",  border: "border-amber-500/30",  dot: "bg-amber-500"  },
  compliance:    { bg: "bg-slate-500/10",  text: "text-slate-600",  border: "border-slate-500/30",  dot: "bg-slate-500"  },
};

function TagBadge({
  tagId,
  removable = false,
  onRemove,
  small = false,
}: {
  tagId: string;
  removable?: boolean;
  onRemove?: () => void;
  small?: boolean;
}) {
  const cat = TAG_CATEGORIES.find((c) => c.id === tagId);
  const cls = TAG_COLOR_CLASSES[tagId] ?? {
    bg: "bg-muted", text: "text-muted-foreground", border: "border-border", dot: "bg-muted-foreground",
  };
  const label = cat?.label ?? tagId;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        small ? "text-[10px] px-1.5 py-0" : "text-[11px] px-2 py-0.5",
        cls.bg, cls.text, cls.border
      )}
    >
      <span className={cn("rounded-full shrink-0", small ? "w-1 h-1" : "w-1.5 h-1.5", cls.dot)} />
      {label}
      {removable && onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label={`Remove ${label} tag`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

function TableTagEditor({
  tableId,
  tableName,
  entry,
  onAdd,
  onRemove,
}: {
  tableId: string;
  tableName: string;
  entry: import("@/lib/agents/tableTagger").TableTag | undefined;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTags = entry?.tags ?? [];
  const availableToAdd = TAG_CATEGORIES.filter((c) => !activeTags.includes(c.id));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-mono text-foreground truncate">{tableName}</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate">{tableId}</span>
        </div>
        {/* Confidence dots */}
        <div className="flex items-center gap-0.5 shrink-0">
          {TAG_CATEGORIES.slice(0, 6).map((cat) => {
            const conf = entry?.confidence[cat.id] ?? 0;
            const cls = TAG_COLOR_CLASSES[cat.id];
            return (
              <span
                key={cat.id}
                title={`${cat.label}: ${(conf * 100).toFixed(0)}%`}
                className={cn("w-1.5 h-1.5 rounded-full transition-opacity", cls.dot)}
                style={{ opacity: Math.max(0.1, conf * 8) }}
              />
            );
          })}
        </div>
      </div>

      {/* Active tags */}
      <div className="flex flex-wrap gap-1">
        {activeTags.length === 0 ? (
          <span className="text-[10px] text-muted-foreground italic">No tags</span>
        ) : (
          activeTags.map((tag) => (
            <TagBadge
              key={tag}
              tagId={tag}
              removable
              onRemove={() => onRemove(tag)}
              small
            />
          ))
        )}
        {/* Add tag button */}
        <button
          onClick={() => setOpen((p) => !p)}
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border rounded-full px-1.5 py-0 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          Add
        </button>
      </div>

      {/* Tag picker dropdown */}
      {open && (
        <div className="flex flex-wrap gap-1 p-2 bg-muted/50 border border-border rounded-md">
          {availableToAdd.length === 0 ? (
            <span className="text-[10px] text-muted-foreground italic">All tags applied</span>
          ) : (
            availableToAdd.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { onAdd(cat.id); setOpen(false); }}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border bg-card hover:bg-accent transition-colors"
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", TAG_COLOR_CLASSES[cat.id]?.dot ?? "bg-muted-foreground")} />
                {cat.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TagsPanel({
  model,
  tagStore,
  onTagOverride,
  onRetag,
}: {
  model: SchemaModel;
  tagStore: TagStore;
  onTagOverride: (tableId: string, action: "add" | "remove", tag: string) => void;
  onRetag: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [retagging, setRetagging] = useState(false);

  const tables = useMemo(() => Object.values(model.tables), [model]);

  const filtered = useMemo(() => {
    let list = tables;
    if (filterTag) {
      list = list.filter((t) => tagStore[t.id]?.tags.includes(filterTag));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (tagStore[t.id]?.tags ?? []).some((tag) =>
            TAG_CATEGORIES.find((c) => c.id === tag)?.label.toLowerCase().includes(q)
          )
      );
    }
    return list;
  }, [tables, filterTag, searchQuery, tagStore]);

  // Tag distribution summary
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(tagStore)) {
      for (const tag of entry.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  }, [tagStore]);

  async function handleRetag() {
    setRetagging(true);
    try { onRetag(); } finally {
      setTimeout(() => setRetagging(false), 600);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Healthcare Tag Index</span>
          <span className="text-[11px] text-muted-foreground">
            {tables.length} tables &middot; {Object.values(tagStore).filter((e) => e.tags.length > 0).length} tagged
          </span>
        </div>
        <button
          onClick={handleRetag}
          disabled={retagging}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {retagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Re-tag All
        </button>
      </div>

      {/* Tag category summary strip */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
        <button
          onClick={() => setFilterTag(null)}
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors",
            filterTag === null
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:bg-accent"
          )}
        >
          All ({tables.length})
        </button>
        {TAG_CATEGORIES.map((cat) => {
          const count = tagCounts[cat.id] ?? 0;
          if (count === 0) return null;
          const cls = TAG_COLOR_CLASSES[cat.id];
          return (
            <button
              key={cat.id}
              onClick={() => setFilterTag(filterTag === cat.id ? null : cat.id)}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors",
                filterTag === cat.id
                  ? cn(cls.bg, cls.text, cls.border, "ring-1 ring-current")
                  : "bg-card text-muted-foreground border-border hover:bg-accent"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", cls.dot)} />
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tables or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="w-8 h-8 mb-2 opacity-30" />
            <span className="text-sm">No tables match your filter</span>
          </div>
        ) : (
          filtered.map((table) => (
            <div key={table.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
              <TableTagEditor
                tableId={table.id}
                tableName={table.name}
                entry={tagStore[table.id]}
                onAdd={(tag) => onTagOverride(table.id, "add", tag)}
                onRemove={(tag) => onTagOverride(table.id, "remove", tag)}
              />
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2.5 border-t border-border bg-muted/20">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Tags are inferred automatically from column names, FK relationships, and the healthcare thesaurus. 
          Use the <strong>+&nbsp;Add</strong> button to apply custom tags or click &times; to remove one.
          The TF-IDF search engine re-indexes with tag terms when tags change.
        </p>
      </div>
    </div>
  );
}

// ── Demo metadata (legacy format, still supported by parser) ──────────────────

const DEMO_METADATA = {
  schemas: {
    dbo: {
      domain: "core_reference",
      tables: {
        CLIENT_EPISODES_ALL: {
          description: "Core patient episode records",
          primaryKey: "epi_id",
          columns: [
            { name: "epi_id",             type: "int",     role: "primary_key"    },
            { name: "epi_branchcode",      type: "varchar", role: "dimension"      },
            { name: "epi_sl_id",           type: "int",     role: "foreign_key"    },
            { name: "epi_care_type_id",    type: "int",     role: "foreign_key"    },
            { name: "epi_admit_date",      type: "date",    role: "time_dimension" },
            { name: "epi_discharge_date",  type: "date",    role: "time_dimension" },
            { name: "epi_status",          type: "varchar", role: "dimension"      },
            { name: "epi_count",           type: "int",     role: "measure", aggregation: "count" },
          ],
          foreignKeys: [
            { column: "epi_branchcode",   references: { table: "dbo.BRANCHES",      column: "branch_code" } },
            { column: "epi_sl_id",        references: { table: "dbo.SERVICE_LINES",  column: "sl_id"       } },
            { column: "epi_care_type_id", references: { table: "dbo.CARE_TYPES",     column: "ct_id"       } },
          ],
        },
        BRANCHES: {
          description: "Branch / location reference",
          primaryKey: "branch_code",
          columns: [
            { name: "branch_code",   type: "varchar", role: "primary_key" },
            { name: "branch_name",   type: "varchar", role: "dimension"   },
            { name: "branch_region", type: "varchar", role: "dimension"   },
            { name: "branch_active", type: "bit",     role: "dimension"   },
          ],
          foreignKeys: [],
        },
        SERVICE_LINES: {
          description: "Service line / program reference",
          primaryKey: "sl_id",
          columns: [
            { name: "sl_id",   type: "int",     role: "primary_key" },
            { name: "sl_name", type: "varchar", role: "dimension"   },
            { name: "sl_code", type: "varchar", role: "dimension"   },
          ],
          foreignKeys: [],
        },
        CARE_TYPES: {
          description: "Care type classification",
          primaryKey: "ct_id",
          columns: [
            { name: "ct_id",       type: "int",     role: "primary_key" },
            { name: "ct_name",     type: "varchar", role: "dimension"   },
            { name: "ct_category", type: "varchar", role: "dimension"   },
          ],
          foreignKeys: [],
        },
      },
    },
    Billing: {
      domain: "billing",
      tables: {
        LINE_ITEMS: {
          description: "Billing line items linked to episodes",
          primaryKey: "li_id",
          columns: [
            { name: "li_id",     type: "int",     role: "primary_key"    },
            { name: "li_epi_id", type: "int",     role: "foreign_key"    },
            { name: "li_date",   type: "date",    role: "time_dimension" },
            { name: "li_amount", type: "decimal", role: "measure", aggregation: "sum"   },
            { name: "li_units",  type: "int",     role: "measure", aggregation: "sum"   },
            { name: "li_status", type: "varchar", role: "dimension"      },
            { name: "li_payer",  type: "varchar", role: "dimension"      },
          ],
          foreignKeys: [
            { column: "li_epi_id", references: { table: "dbo.CLIENT_EPISODES_ALL", column: "epi_id" } },
          ],
        },
        ADJUSTMENTS: {
          description: "Billing adjustments and writeoffs",
          primaryKey: "adj_id",
          columns: [
            { name: "adj_id",     type: "int",     role: "primary_key"    },
            { name: "adj_li_id",  type: "int",     role: "foreign_key"    },
            { name: "adj_date",   type: "date",    role: "time_dimension" },
            { name: "adj_amount", type: "decimal", role: "measure", aggregation: "sum" },
            { name: "adj_reason", type: "varchar", role: "dimension"      },
          ],
          foreignKeys: [
            { column: "adj_li_id", references: { table: "Billing.LINE_ITEMS", column: "li_id" } },
          ],
        },
      },
    },
    Accounting: {
      domain: "finance",
      tables: {
        GL_TRANSACTIONS: {
          description: "General ledger transactions",
          primaryKey: "gl_id",
          columns: [
            { name: "gl_id",          type: "int",     role: "primary_key"    },
            { name: "gl_date",        type: "date",    role: "time_dimension" },
            { name: "gl_branch_code", type: "varchar", role: "foreign_key"    },
            { name: "gl_amount",      type: "decimal", role: "measure", aggregation: "sum" },
            { name: "gl_account",     type: "varchar", role: "dimension"      },
            { name: "gl_type",        type: "varchar", role: "dimension"      },
          ],
          foreignKeys: [
            { column: "gl_branch_code", references: { table: "dbo.BRANCHES", column: "branch_code" } },
          ],
        },
      },
    },
  },
};
