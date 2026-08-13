"use client";

/**
 * Dataset Designer
 *
 * Four tabs backed by /api/designer/datasets:
 *   1. Discovery    — browse source tables, add to canvas
 *   2. Canvas       — drag-column-to-column relationship builder + AI inference
 *   3. Relationships — manage accepted/suggested/rejected relationships
 *   4. Datasets     — create, publish, and manage semantic datasets
 *
 * Cross-navigation: passes onNavigate prop to jump to Schema Registry or KPI Explorer.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  GitMerge,
  Info,
  Layers,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  X,
  XCircle,
  Zap,
  Edit3,
  BookOpen,
  BarChart3,
  Network,
  AlertCircle,
  Download,
  Eye,
  GitCompare,
  RotateCcw,
  Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DatasetLineagePanel, DatasetValidationHub } from "./DatasetValidationHub";

// ── Types ─────────────────────────────────────────────────────────────────────

type RelType    = "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
type RelStatus  = "Suggested" | "Accepted" | "Rejected";
type DSStatus   = "Draft" | "Pending Approval" | "Published" | "Deprecated";
type DesignerTab = "discovery" | "canvas" | "relationships" | "datasets" | "validation" | "lineage";
type DatasetStudioMode = "build" | "relationships" | "semantics" | "published";

interface ColumnDef {
  name:        string;
  type:        string;
  isPk:        boolean;
  isFk:        boolean;
  nullable:    boolean;
  description: string;
}

interface TableDef {
  name:                string;
  schema:              string;
  recordCount:         number;
  columnCount:         number;
  primaryKeys:         string[];
  foreignKeys:         string[];
  businessDescription: string;
  columns:             ColumnDef[];
}

interface Relationship {
  id:               string;
  sourceTable:      string;
  sourceColumn:     string;
  targetTable:      string;
  targetColumn:     string;
  relationshipType: RelType;
  confidence:       number;
  status:           RelStatus;
  reasons:          string[];
  createdBy:        string;
  createdDate:      string;
  kpiCount?:        number;
  reportCount?:     number;
  datasetCount?:    number;
}

interface SemanticDataset {
  datasetId:     string;
  datasetName:   string;
  description:   string;
  tables:        string[];
  selectedTables?: Array<{ name: string; schema: string; description?: string; recordCount?: number; columns: ColumnDef[] }>;
  relationships: string[];
  dimensions:    string[];
  measures:      string[];
  glossaryMappings: string[];
  businessRules: string[];
  owner:         string;
  version:       string;
  status:        DSStatus;
  createdDate:   string;
  publishedDate?: string;
  createdBy:     string;
  health?:       number;
  healthBreakdown?: Record<string, number>;
  changeSummary?: string;
  restoredFromVersion?: string;
  updatedDate?: string;
  publicationTargets?: string[];
  sourceTraceability?: string[];
  virtual?: boolean;
  authoritative?: boolean;
  history?: Array<{ version: string; savedAt: string; savedBy?: string; reason: string; definition?: SemanticDataset }>;
}

interface InferenceResult {
  detected:          boolean;
  sourceTable:       string;
  sourceColumn:      string;
  targetTable:       string;
  targetColumn:      string;
  relationshipType:  RelType;
  confidence:        number;
  reasons:           string[];
}

interface ScopeData {
  tables:        number;
  columns:       number;
  relationships: number;
  datasets:      number;
  kpis:          number;
  reports:       number;
  lastRefresh:   string;
}

// ── Static source catalog ────────────────────────────────────────────────────

const SOURCE_TABLES: TableDef[] = [
  {
    name: "CLIENT_EPISODES_ALL", schema: "dbo", recordCount: 284_512, columnCount: 47,
    primaryKeys: ["epi_id"], foreignKeys: ["epi_branchcode", "epi_slid", "epi_caretypeid"],
    businessDescription: "Core patient episode table. One row per active care episode across all service lines.",
    columns: [
      { name: "epi_id",            type: "int",      isPk: true,  isFk: false, nullable: false, description: "PK — unique episode identifier" },
      { name: "epi_branchcode",    type: "varchar",  isPk: false, isFk: true,  nullable: false, description: "FK → BRANCHES.branch_code" },
      { name: "epi_slid",          type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → SERVICE_LINES.service_line_id" },
      { name: "epi_caretypeid",    type: "int",      isPk: false, isFk: true,  nullable: true,  description: "FK → CARE_TYPES.ct_id" },
      { name: "epi_SocDate",       type: "date",     isPk: false, isFk: false, nullable: false, description: "Start of Care date" },
      { name: "epi_DischargeDate", type: "date",     isPk: false, isFk: false, nullable: true,  description: "Discharge date (NULL = still active)" },
      { name: "epi_payor",         type: "varchar",  isPk: false, isFk: false, nullable: true,  description: "Primary payor classification" },
      { name: "epi_recertDate",    type: "date",     isPk: false, isFk: false, nullable: true,  description: "Most recent recertification date" },
    ],
  },
  {
    name: "CLIENT_EPISODE_VISITS_ALL", schema: "dbo", recordCount: 2_148_932, columnCount: 32,
    primaryKeys: ["visit_id"], foreignKeys: ["epi_id", "worker_id", "discipline_id"],
    businessDescription: "Visit-level detail for all episodes — linked to episodes via epi_id.",
    columns: [
      { name: "visit_id",      type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK — unique visit" },
      { name: "epi_id",        type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "worker_id",     type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → WORKER_BASE.worker_id" },
      { name: "visit_date",    type: "date",    isPk: false, isFk: false, nullable: false, description: "Date of service visit" },
      { name: "visit_points",  type: "decimal", isPk: false, isFk: false, nullable: true,  description: "Worker productivity points" },
      { name: "discipline_id", type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → DISCIPLINES.discipline_id" },
    ],
  },
  {
    name: "CLIENT_EPISODE_VISIT_NOTES", schema: "dbo", recordCount: 2_101_445, columnCount: 18,
    primaryKeys: ["note_id"], foreignKeys: ["visit_id", "epi_id"],
    businessDescription: "Clinical notes and OASIS documentation attached to visits.",
    columns: [
      { name: "note_id",   type: "int",      isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "visit_id",  type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODE_VISITS_ALL.visit_id" },
      { name: "epi_id",    type: "int",      isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "note_type", type: "varchar",  isPk: false, isFk: false, nullable: false, description: "OASIS, Narrative, Assessment" },
      { name: "note_date", type: "datetime", isPk: false, isFk: false, nullable: false, description: "Note creation timestamp" },
      { name: "note_text", type: "nvarchar", isPk: false, isFk: false, nullable: true,  description: "Clinical note content" },
    ],
  },
  {
    name: "CLIENT_EPISODE_RECERT_HISTORY", schema: "dbo", recordCount: 412_890, columnCount: 14,
    primaryKeys: ["recert_id"], foreignKeys: ["epi_id"],
    businessDescription: "Recertification history per episode — tracks cert periods and renewal dates.",
    columns: [
      { name: "recert_id",   type: "int",  isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "epi_id",      type: "int",  isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "cert_period", type: "int",  isPk: false, isFk: false, nullable: false, description: "Cert period number (1, 2, 3…)" },
      { name: "cert_start",  type: "date", isPk: false, isFk: false, nullable: false, description: "Cert period start date" },
      { name: "cert_end",    type: "date", isPk: false, isFk: false, nullable: false, description: "Cert period end date" },
    ],
  },
  {
    name: "BRANCHES", schema: "dbo", recordCount: 16, columnCount: 12,
    primaryKeys: ["branch_code"], foreignKeys: [],
    businessDescription: "Branch dimension — maps branch codes to names, regions, counties, and states.",
    columns: [
      { name: "branch_code",   type: "varchar", isPk: true,  isFk: false, nullable: false, description: "PK — matches epi_branchcode" },
      { name: "branch_name",   type: "varchar", isPk: false, isFk: false, nullable: false, description: "Human-readable branch name" },
      { name: "branch_county", type: "varchar", isPk: false, isFk: false, nullable: true,  description: "County where branch operates" },
      { name: "branch_state",  type: "varchar", isPk: false, isFk: false, nullable: false, description: "State abbreviation" },
      { name: "region",        type: "varchar", isPk: false, isFk: false, nullable: true,  description: "Region grouping (OC, IE, SGV, Desert)" },
    ],
  },
  {
    name: "WORKER_BASE", schema: "dbo", recordCount: 892, columnCount: 24,
    primaryKeys: ["worker_id"], foreignKeys: ["branch_code"],
    businessDescription: "Clinician and staff worker registry — linked to visit and productivity data.",
    columns: [
      { name: "worker_id",   type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK — unique worker identifier" },
      { name: "branch_code", type: "varchar", isPk: false, isFk: true,  nullable: false, description: "FK → BRANCHES.branch_code" },
      { name: "worker_name", type: "varchar", isPk: false, isFk: false, nullable: false, description: "Full name" },
      { name: "worker_type", type: "varchar", isPk: false, isFk: false, nullable: false, description: "FT, PT, PRN" },
      { name: "discipline",  type: "varchar", isPk: false, isFk: false, nullable: true,  description: "SN, PT, OT, ST" },
      { name: "hire_date",   type: "date",    isPk: false, isFk: false, nullable: true,  description: "Hire date" },
    ],
  },
  {
    name: "Billing.LINE_ITEMS", schema: "Billing", recordCount: 1_892_441, columnCount: 38,
    primaryKeys: ["li_id"], foreignKeys: ["epi_id", "invoice_id"],
    businessDescription: "Billing line items — claim charges, payments, and adjustments per episode.",
    columns: [
      { name: "li_id",           type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "epi_id",          type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "invoice_id",      type: "int",     isPk: false, isFk: true,  nullable: true,  description: "FK → Billing.INVOICES.invoice_id" },
      { name: "li_amount",       type: "decimal", isPk: false, isFk: false, nullable: false, description: "Billed charge amount" },
      { name: "li_paid",         type: "decimal", isPk: false, isFk: false, nullable: true,  description: "Amount paid by payor" },
      { name: "li_claim_status", type: "varchar", isPk: false, isFk: false, nullable: false, description: "Submitted, Paid, Denied, Adjusted" },
    ],
  },
  {
    name: "Billing.INVOICES", schema: "Billing", recordCount: 412_100, columnCount: 16,
    primaryKeys: ["invoice_id"], foreignKeys: ["epi_id"],
    businessDescription: "Invoice-level billing records — parent to LINE_ITEMS claims.",
    columns: [
      { name: "invoice_id",     type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "epi_id",         type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "invoice_date",   type: "date",    isPk: false, isFk: false, nullable: false, description: "Invoice creation date" },
      { name: "invoice_total",  type: "decimal", isPk: false, isFk: false, nullable: false, description: "Total billed amount" },
      { name: "invoice_status", type: "varchar", isPk: false, isFk: false, nullable: false, description: "Invoice status" },
    ],
  },
  {
    name: "PDGM_PERIOD", schema: "dbo", recordCount: 512_890, columnCount: 22,
    primaryKeys: ["period_id"], foreignKeys: ["epi_id"],
    businessDescription: "PDGM 30-day period records — HIPPS codes, LUPA status, and reimbursement type.",
    columns: [
      { name: "period_id",          type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "epi_id",             type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "period_number",      type: "int",     isPk: false, isFk: false, nullable: false, description: "PDGM period number" },
      { name: "hipps_code",         type: "varchar", isPk: false, isFk: false, nullable: true,  description: "HIPPS classification code" },
      { name: "is_lupa",            type: "bit",     isPk: false, isFk: false, nullable: false, description: "1 = LUPA period" },
      { name: "reimbursement_type", type: "varchar", isPk: false, isFk: false, nullable: true,  description: "Early/Late, Community/Institutional" },
    ],
  },
  {
    name: "CLIENT_EPISODE_ADMISSION_TYPES", schema: "dbo", recordCount: 38_120, columnCount: 8,
    primaryKeys: ["admission_type_id"], foreignKeys: ["epi_id"],
    businessDescription: "Lookup table mapping episodes to admission type classifications.",
    columns: [
      { name: "admission_type_id", type: "int",     isPk: true,  isFk: false, nullable: false, description: "PK" },
      { name: "epi_id",            type: "int",     isPk: false, isFk: true,  nullable: false, description: "FK → CLIENT_EPISODES_ALL.epi_id" },
      { name: "admission_type",    type: "varchar", isPk: false, isFk: false, nullable: false, description: "New, Recert, Resumption" },
    ],
  },
];

// ── Badge helpers ─────────────────────────────────────────────────────────────

function RelTypeBadge({ type }: { type: RelType }) {
  const styles: Record<RelType, string> = {
    ManyToOne:  "bg-primary/15 text-primary border-primary/30",
    OneToMany:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
    OneToOne:   "bg-chart-3/15 text-chart-3 border-chart-3/30",
    ManyToMany: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  };
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border", styles[type])}>
      {type}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? "bg-chart-3" : pct >= 70 ? "bg-chart-5" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: RelStatus | DSStatus }) {
  const map: Record<string, string> = {
    Accepted:    "bg-chart-3/15 text-chart-3 border-chart-3/30",
    Published:   "bg-chart-3/15 text-chart-3 border-chart-3/30",
  Suggested:   "bg-chart-5/15 text-chart-5 border-chart-5/30",
  "Pending Approval": "bg-chart-5/15 text-chart-5 border-chart-5/30",
  Draft:       "bg-muted text-muted-foreground border-border",
    Rejected:    "bg-destructive/15 text-destructive border-destructive/30",
    Deprecated:  "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border", map[status] ?? "bg-muted text-muted-foreground border-border")}>
      {status}
    </span>
  );
}

// ── Drag-column selector ──────────────────────────────────────────────────────

interface DragColumn {
  table:  string;
  column: string;
  type:   string;
}

// ── Inference popup ───────────────────────────────────────────────────────────

function InferencePopup({
  inference,
  onAccept,
  onReject,
  onModify,
  loading,
  onClose,
}: {
  inference:  InferenceResult;
  onAccept:   () => void;
  onReject:   () => void;
  onModify:   () => void;
  loading:    boolean;
  onClose:    () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-chart-5" />
            <h3 className="text-sm font-semibold text-foreground">Suggested Relationship</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/50 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Source → Target */}
        <div className="bg-muted/20 border border-border rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-mono text-foreground">{inference.sourceTable}</span>
            <span className="text-[10px] text-muted-foreground">.</span>
            <span className="text-xs font-mono text-primary">{inference.sourceColumn}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex-1 h-px bg-border" />
            <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-mono text-foreground">{inference.targetTable}</span>
            <span className="text-[10px] text-muted-foreground">.</span>
            <span className="text-xs font-mono text-primary">{inference.targetColumn}</span>
          </div>
        </div>

        {/* Type + Confidence */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Type:</span>
            <RelTypeBadge type={inference.relationshipType} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Confidence:</span>
            <span className="text-xs font-mono font-semibold text-chart-3">{Math.round(inference.confidence * 100)}%</span>
          </div>
        </div>

        {/* Confidence bar */}
        <ConfidenceBar score={inference.confidence} />

        {/* Reasons */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Detection Signals</p>
          <div className="flex flex-col gap-1">
            {inference.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <CheckCircle2 className="w-3 h-3 text-chart-3 mt-0.5 shrink-0" />
                {r}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button
            onClick={onAccept}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 font-medium"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Accept
          </button>
          <button
            onClick={onModify}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg border border-border hover:bg-muted/30 transition-colors text-foreground"
          >
            <Edit3 className="w-3 h-3" />
            Modify
          </button>
          <button
            onClick={onReject}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg border border-destructive/30 hover:bg-destructive/10 text-destructive transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Discovery Panel ───────────────────────────────────────────────────────────

function TableSamplePreview({ table }: { table: TableDef }) {
  const [state, setState] = useState<{ loading: boolean; rows: Record<string, unknown>[]; error: string | null }>({ loading: true, rows: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    const identifier = table.schema.toLowerCase() === "dbo" ? table.name : `${table.schema}.${table.name}`;
    void fetch(`/api/data/${encodeURIComponent(identifier)}?page=1&pageSize=5`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { rows?: Record<string, unknown>[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setState({ loading: false, rows: payload.rows ?? [], error: null });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ loading: false, rows: [], error: error instanceof Error ? error.message : "Preview unavailable" });
      });
    return () => controller.abort();
  }, [table.name, table.schema]);

  if (state.loading) return <div role="status" className="flex items-center gap-2 py-3 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading five-row sample…</div>;
  if (state.error) return <p role="status" className="py-3 text-[10px] text-destructive">Sample unavailable: {state.error}</p>;
  if (state.rows.length === 0) return <p role="status" className="py-3 text-[10px] text-muted-foreground">The table has columns but currently returns no rows.</p>;

  const previewColumns = Object.keys(state.rows[0]).slice(0, 4);
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border" aria-label={`${table.name} sample rows`}>
      <table className="w-full text-left text-[9px]">
        <thead className="bg-muted/30 text-muted-foreground"><tr>{previewColumns.map((column) => <th key={column} className="px-2 py-1 font-medium">{column}</th>)}</tr></thead>
        <tbody>{state.rows.map((row, index) => <tr key={index} className="border-t border-border/50">{previewColumns.map((column) => <td key={column} className="max-w-36 truncate px-2 py-1 font-mono text-foreground">{row[column] == null ? "—" : String(row[column])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function DiscoveryPanel({
  canvasTables,
  onAddToCanvas,
  sourceTables,
  isRefreshing,
  onRefresh,
}: {
  canvasTables:  Set<string>;
  onAddToCanvas: (t: TableDef) => void;
  sourceTables:  TableDef[];
  isRefreshing:  boolean;
  onRefresh:     () => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = sourceTables.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.businessDescription.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Source Tables", value: sourceTables.length },
          { label: "Total Columns", value: sourceTables.reduce((n, t) => n + t.columnCount, 0) },
          { label: "Total Records", value: "7.8M+" },
        ].map((s) => (
          <div key={s.label} className="bg-muted/15 border border-border rounded-lg px-3 py-2.5 text-center">
            <p className="text-sm font-semibold text-primary">{typeof s.value === "number" ? s.value : s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables, descriptions…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted/20 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh catalog from live schema"
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors shrink-0",
            isRefreshing && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Table list */}
      <div className="flex flex-col gap-1.5">
        {filtered.map((t) => {
          const tableId = `${t.schema}.${t.name}`;
          const isExpanded = expanded === tableId;
          const isOnCanvas = canvasTables.has(t.name);
          return (
            <div key={tableId} className="border border-border rounded-lg overflow-hidden">
              {/* Use div + role to avoid button-in-button — HTML spec disallows nested interactive elements */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isExpanded ? null : tableId)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(isExpanded ? null : tableId); } }}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/20 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Table2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground font-mono truncate">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.schema} · {t.columnCount} cols · {t.recordCount.toLocaleString()} rows</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {isOnCanvas ? (
                    <span className="text-[9px] font-medium text-chart-3 bg-chart-3/10 border border-chart-3/20 rounded px-1.5 py-0.5">On Canvas</span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddToCanvas(t); }}
                      className="text-[9px] font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded px-1.5 py-0.5 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-2.5 h-2.5" />Add
                    </button>
                  )}
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border bg-muted/5">
                  <p className="text-[11px] text-muted-foreground py-2 leading-relaxed">{t.businessDescription}</p>
                  <div className="flex flex-col gap-0.5">
                    {t.columns.length === 0 ? <p className="py-2 text-[10px] text-muted-foreground">Column metadata is unavailable for this source.</p> : t.columns.map((c) => (
                      <div key={`${tableId}.${c.name}`} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-1 w-8 shrink-0">
                          {c.isPk && <span className="text-[8px] font-bold text-chart-5 bg-chart-5/10 rounded px-0.5">PK</span>}
                          {c.isFk && <span className="text-[8px] font-bold text-primary bg-primary/10 rounded px-0.5">FK</span>}
                        </div>
                        <span className="text-[11px] font-mono text-foreground flex-1 truncate">{c.name}</span>
                        <span className="text-[9px] text-muted-foreground font-mono bg-muted/30 rounded px-1">{c.type}</span>
                      </div>
                    ))}
                  </div>
                  <TableSamplePreview table={t} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Canvas Panel ─────────────────────────────────────────────────────────────

function CanvasPanel({
  canvasTables,
  availableTables,
  onAddToCanvas,
  onToggleTable,
  selectedColumns,
  onToggleColumn,
  onCreateRelationship,
}: {
  canvasTables: TableDef[];
  availableTables: TableDef[];
  onAddToCanvas: () => void;
  onToggleTable: (table: TableDef, selected: boolean) => void;
  selectedColumns: Record<string, string[]>;
  onToggleColumn: (table: TableDef, column: string | "*", selected: boolean) => void;
  onCreateRelationship: (src: DragColumn, tgt: DragColumn) => void;
}) {
  const [dragColumn, setDragColumn] = useState<DragColumn | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [columnSearch, setColumnSearch] = useState<Record<string, string>>({});
  const [typeFilter, setTypeFilter] = useState<Record<string, string>>({});

  function handleDragStart(table: string, column: string, type: string) {
    setDragColumn({ table, column, type });
  }

  function handleDrop(table: string, column: string, type: string) {
    if (!dragColumn) return;
    if (dragColumn.table === table && dragColumn.column === column) { setDragColumn(null); return; }
    onCreateRelationship(dragColumn, { table, column, type });
    setDragColumn(null);
    setHoveredColumn(null);
  }

  const hasCanvas = canvasTables.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="rounded-lg border border-border bg-muted/10 p-4">
        <legend className="px-1 text-xs font-semibold text-foreground">Governed source tables</legend>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">Select multiple sources for this draft. Selection stays in Build and never advances the workflow automatically.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Available source tables">
          {availableTables.map((table) => {
            const selected = canvasTables.some((item) => item.name === table.name);
            return (
              <label key={`${table.schema}.${table.name}`} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors", selected ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:border-primary/30")}>
                <input type="checkbox" checked={selected} onChange={(event) => onToggleTable(table, event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                <span className="min-w-0"><span className="block truncate font-mono text-[11px] font-semibold text-foreground">{table.name}</span><span className="block text-[10px] text-muted-foreground">{table.schema} · {table.columnCount} columns</span></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Instructions */}
      <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
        <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Drag a column from one table card and drop it onto a column in another table to create a relationship.
          The Smart Inference Engine will analyze the pair and suggest the relationship type automatically.
        </p>
      </div>

      {!hasCanvas ? (
        <div className="flex flex-col items-center gap-3 py-12 border border-dashed border-border rounded-lg">
          <Database className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No tables on canvas</p>
          <p className="text-xs text-muted-foreground/70">Go to the Discovery tab and add tables to start building relationships.</p>
          <button
            onClick={onAddToCanvas}
            className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors mt-1"
          >
            <Plus className="w-3 h-3" />
            Add tables from Discovery
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {canvasTables.map((t) => (
            <div key={`${t.schema}.${t.name}`} className="border border-border rounded-lg overflow-hidden bg-card">
              {/* Table header */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border-b border-border">
                <Table2 className="w-3.5 h-3.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground font-mono truncate">{t.name}</p>
                  <p className="text-[9px] text-muted-foreground">{t.schema} · {t.columnCount} cols</p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-b border-border bg-muted/10 p-2">
                <div className="relative flex-1"><Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><input value={columnSearch[t.name] ?? ""} onChange={(event) => setColumnSearch((current) => ({ ...current, [t.name]: event.target.value }))} placeholder="Filter columns" className="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-[10px] text-foreground" /></div>
                <select aria-label={`Filter ${t.name} by type`} value={typeFilter[t.name] ?? "all"} onChange={(event) => setTypeFilter((current) => ({ ...current, [t.name]: event.target.value }))} className="rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground"><option value="all">All types</option>{[...new Set(t.columns.map((column) => column.type))].sort().map((type) => <option key={type} value={type}>{type}</option>)}</select>
              </div>
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] text-muted-foreground"><span>{selectedColumns[t.name]?.length ?? 0} of {t.columns.length} selected</span><span className="flex gap-2"><button type="button" onClick={() => onToggleColumn(t, "*", true)} className="text-primary hover:underline">Select all</button><button type="button" onClick={() => onToggleColumn(t, "*", false)} className="hover:text-foreground hover:underline">Deselect all</button></span></div>
              {/* Column rows */}
              <div className="max-h-72 overflow-y-auto flex flex-col divide-y divide-border/30">
                {t.columns.filter((column) => column.name.toLowerCase().includes((columnSearch[t.name] ?? "").toLowerCase()) && ((typeFilter[t.name] ?? "all") === "all" || column.type === typeFilter[t.name])).sort((a, b) => Number(b.isPk) - Number(a.isPk) || a.name.localeCompare(b.name)).map((c) => {
                  const colKey = `${t.name}.${c.name}`;
                  const selected = selectedColumns[t.name]?.includes(c.name) ?? false;
                  const isDragSource = dragColumn?.table === t.name && dragColumn?.column === c.name;
                  const isHover = hoveredColumn === colKey && dragColumn && dragColumn.table !== t.name;
                  return (
                    <div key={`${t.schema}.${t.name}.${c.name}`} className={cn("flex items-center gap-2 px-3 py-1.5 transition-colors", selected ? "bg-card" : "bg-muted/20 opacity-65", isDragSource && "border-l-2 border-primary bg-primary/10", isHover && "border-l-2 border-chart-3 bg-chart-3/10")}
                      draggable={selected}
                      onDragStart={() => selected && handleDragStart(t.name, c.name, c.type)}
                      onDragEnd={() => setDragColumn(null)}
                      onDragOver={(e) => { if (selected) { e.preventDefault(); setHoveredColumn(colKey); } }}
                      onDragLeave={() => setHoveredColumn(null)}
                      onDrop={() => selected && handleDrop(t.name, c.name, c.type)}>
                      <input aria-label={`Include ${t.name}.${c.name}`} type="checkbox" checked={selected} onChange={(event) => onToggleColumn(t, c.name, event.target.checked)} className="size-3.5 accent-primary" />
                      <div className="flex items-center gap-1 w-8 shrink-0">{c.isPk && <span className="text-[8px] font-bold text-chart-5">PK</span>}{c.isFk && <span className="text-[8px] font-bold text-primary">FK</span>}</div>
                      <span className="text-[11px] font-mono text-foreground flex-1 truncate" title={c.description}>{c.name}</span>
                      {!c.nullable && <span className="text-[8px] text-muted-foreground">Required</span>}
                      <span className="text-[9px] text-muted-foreground font-mono bg-muted/30 rounded px-1">{c.type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drag hint */}
      {dragColumn && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none">
          <Link2 className="w-3.5 h-3.5" />
          Dragging <span className="font-mono font-semibold">{dragColumn.table}.{dragColumn.column}</span> — drop on target column
        </div>
      )}
    </div>
  );
}

// ── Relationship Manager ──────────────────────────────────────────────────────

function RelationshipsPanel({
  relationships,
  loading,
  onAccept,
  onReject,
  onRefresh,
}: {
  relationships: Relationship[];
  loading:       boolean;
  onAccept:      (id: string) => void;
  onReject:      (id: string) => void;
  onRefresh:     () => void;
}) {
  const [filter, setFilter] = useState<"All" | RelStatus>("All");

  const filtered = filter === "All" ? relationships : relationships.filter((r) => r.status === filter);
  const counts = {
    All:       relationships.length,
    Accepted:  relationships.filter((r) => r.status === "Accepted").length,
    Suggested: relationships.filter((r) => r.status === "Suggested").length,
    Rejected:  relationships.filter((r) => r.status === "Rejected").length,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 p-1 bg-muted/30 rounded-lg border border-border w-fit">
          {(["All", "Accepted", "Suggested", "Rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                filter === s ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s} <span className="ml-1 text-[9px] opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {/* Relationship rows */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">No {filter !== "All" ? filter.toLowerCase() : ""} relationships found.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((rel) => (
            <div
              key={rel.id}
              className={cn(
                "border rounded-lg p-4 flex flex-col gap-3",
                rel.status === "Accepted" ? "border-chart-3/30 bg-chart-3/5" :
                rel.status === "Suggested" ? "border-chart-5/30 bg-chart-5/5" :
                "border-border bg-muted/5"
              )}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">{rel.id}</span>
                  <StatusBadge status={rel.status} />
                  <RelTypeBadge type={rel.relationshipType} />
                </div>
                {rel.status === "Suggested" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onAccept(rel.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-chart-3/15 text-chart-3 border border-chart-3/30 hover:bg-chart-3/25 transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3" />Accept
                    </button>
                    <button
                      onClick={() => onReject(rel.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors"
                    >
                      <XCircle className="w-3 h-3" />Reject
                    </button>
                  </div>
                )}
              </div>

              {/* Path */}
              <div className="flex items-center gap-1.5 flex-wrap font-mono text-xs">
                <span className="text-foreground">{rel.sourceTable}</span>
                <span className="text-muted-foreground">.</span>
                <span className="text-primary">{rel.sourceColumn}</span>
                <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                <span className="text-foreground">{rel.targetTable}</span>
                <span className="text-muted-foreground">.</span>
                <span className="text-primary">{rel.targetColumn}</span>
              </div>

              {/* Confidence + usage */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <ConfidenceBar score={rel.confidence} />
                </div>
                {(rel.kpiCount !== undefined || rel.reportCount !== undefined) && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
                    {rel.kpiCount !== undefined && (
                      <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" />{rel.kpiCount} KPIs</span>
                    )}
                    {rel.reportCount !== undefined && (
                      <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{rel.reportCount} Reports</span>
                    )}
                  </div>
                )}
              </div>

              {/* Reasons */}
              {rel.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rel.reasons.map((r, i) => (
                    <span key={i} className="text-[9px] text-muted-foreground bg-muted/30 border border-border rounded px-1.5 py-0.5">{r}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Datasets Panel ────────────────────────────────────────────────────────────

function DatasetsPanel({
  datasets,
  relationships,
  availableTables,
  selectedColumns,
  mode,
  loading,
  onPublish,
  onRequestApproval,
  onCreate,
  onUpdate,
  onRefresh,
  }: {
  datasets:      SemanticDataset[];
  relationships: Relationship[];
  availableTables: TableDef[];
  selectedColumns: Record<string, string[]>;
  mode: "semantics" | "published";
  loading:       boolean;
  onPublish:     (id: string) => void;
  onRequestApproval: (id: string) => void;
  onCreate:      (d: Partial<SemanticDataset>) => Promise<void> | void;
  onUpdate:      (id: string, d: Partial<SemanticDataset>) => Promise<void> | void;
  onRefresh:     () => void;
  }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = { datasetName: "", description: "", owner: "Analytics Team", tables: "", dimensions: "", measures: "", glossaryMappings: "", businessRules: "", relationships: [] as string[] };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDataset, setPreviewDataset] = useState<SemanticDataset | null>(null);
  const [historyDatasetId, setHistoryDatasetId] = useState<string | null>(null);
  const [versionDiff, setVersionDiff] = useState<{ version: string; added: string[]; removed: string[]; modified: string[] } | null>(null);

  const acceptedRels = relationships.filter((r) => r.status === "Accepted");
  const visibleDatasets = mode === "published" ? datasets.filter((dataset) => dataset.status === "Published") : datasets.filter((dataset) => dataset.status !== "Published");

  function quoteIdentifier(identifier: string) {
    return identifier.split(".").map((part) => `[${part.replaceAll("]", "]]")}]`).join(".");
  }

  function generateReadOnlySql(dataset: SemanticDataset) {
    const [baseTable, ...remainingTables] = dataset.tables;
    if (!baseTable) return "-- No source tables are selected for this dataset.";
    const selectedRelationships = dataset.relationships.map((id) => acceptedRels.find((relationship) => relationship.id === id)).filter((relationship): relationship is Relationship => Boolean(relationship));
    const joinedTables = new Set([baseTable]);
    const joins: string[] = [];
    for (const relationship of selectedRelationships) {
      const sourceJoined = joinedTables.has(relationship.sourceTable);
      const targetJoined = joinedTables.has(relationship.targetTable);
      if (sourceJoined === targetJoined) continue;
      const nextTable = sourceJoined ? relationship.targetTable : relationship.sourceTable;
      joins.push(`LEFT JOIN ${quoteIdentifier(nextTable)} ON ${quoteIdentifier(relationship.sourceTable)}.${quoteIdentifier(relationship.sourceColumn)} = ${quoteIdentifier(relationship.targetTable)}.${quoteIdentifier(relationship.targetColumn)}`);
      joinedTables.add(nextTable);
    }
    for (const table of remainingTables) {
      if (!joinedTables.has(table)) joins.push(`-- Relationship required before joining ${quoteIdentifier(table)}`);
    }
    const projected = (dataset.selectedTables ?? []).flatMap((table) => table.columns.map((column) => `  ${quoteIdentifier(table.name)}.${quoteIdentifier(column.name)} AS ${quoteIdentifier(`${table.name.replaceAll(".", "_")}_${column.name}`)}`));
    if (!projected.length) return "-- Select at least one governed field before previewing this dataset.";
    return [`SELECT TOP (100)`, projected.join(",\n"), `FROM ${quoteIdentifier(baseTable)}`, ...joins].join("\n");
  }

 async function runPreview(dataset: SemanticDataset) {
 setPreviewingId(dataset.datasetId);
 setPreviewDataset(dataset);
 setPreviewRows([]);
    setPreviewColumns([]);
    setPreviewError(null);
    try {
      const response = await fetch("/api/run-sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: generateReadOnlySql(dataset), report_name: `${dataset.datasetName} preview` }) });
      const payload = await response.json() as { rows?: Record<string, unknown>[]; columns?: Array<string | { name?: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const rows = payload.rows ?? [];
      setPreviewRows(rows);
      setPreviewColumns((payload.columns ?? []).map((column) => typeof column === "string" ? column : column.name ?? "column"));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Preview execution failed");
    } finally {
      setPreviewingId(null);
    }
  }

  async function exportMetadata(dataset: SemanticDataset, format: "json" | "yaml" | "dictionary" | "lineage" | "graph") {
    const response = await fetch("/api/designer/datasets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export_metadata", datasetId: dataset.datasetId, format }) });
    const payload = await response.json() as { filename?: string; mime?: string; content?: string; error?: string };
    if (!response.ok || !payload.content || !payload.filename) { setPreviewError(payload.error ?? "Export failed"); return; }
    const url = URL.createObjectURL(new Blob([payload.content], { type: payload.mime ?? "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = payload.filename; link.click(); URL.revokeObjectURL(url);
  }

  async function compareVersion(dataset: SemanticDataset, version: string) {
    const response = await fetch("/api/designer/datasets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare_version", datasetId: dataset.datasetId, version }) });
    const payload = await response.json() as { diff?: { added: string[]; removed: string[]; modified: string[] }; error?: string };
    if (!response.ok || !payload.diff) { setPreviewError(payload.error ?? "Comparison failed"); return; }
    setVersionDiff({ version, ...payload.diff });
  }

  async function restoreVersion(dataset: SemanticDataset, version: string) {
    if (!window.confirm(`Restore immutable version ${version} as a new draft? Existing versions will remain unchanged.`)) return;
    const response = await fetch("/api/designer/datasets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore_version", datasetId: dataset.datasetId, version, actor: "analyst" }) });
    const payload = await response.json() as { dataset?: SemanticDataset; error?: string };
    if (!response.ok || !payload.dataset) { setPreviewError(payload.error ?? "Restore failed"); return; }
    await onRefresh();
    setHistoryDatasetId(null);
  }

  async function handleSave() {
  if (!form.datasetName.trim()) return;
  setSaving(true);
  const definition: Partial<SemanticDataset> = {
  datasetName: form.datasetName.trim(),
  description: form.description.trim(),
  owner: form.owner.trim() || "Analytics Team",
  tables: form.tables.split(",").map((s) => s.trim()).filter(Boolean),
  selectedTables: form.tables.split(",").map((s) => s.trim()).filter(Boolean).map((name) => {
    const table = availableTables.find((candidate) => candidate.name === name);
    const selected = selectedColumns[name] ?? table?.columns.map((column) => column.name) ?? [];
    return { name, schema: table?.schema ?? "dbo", description: table?.businessDescription, recordCount: table?.recordCount, columns: (table?.columns ?? []).filter((column) => selected.includes(column.name)) };
  }),
  dimensions: form.dimensions.split(",").map((s) => s.trim()).filter(Boolean),
  measures: form.measures.split(",").map((s) => s.trim()).filter(Boolean),
  glossaryMappings: form.glossaryMappings.split(",").map((s) => s.trim()).filter(Boolean),
  businessRules: form.businessRules.split(/[;\n]/).map((s) => s.trim()).filter(Boolean),
  relationships: form.relationships,
  };
  if (editingId) await onUpdate(editingId, definition);
  else await onCreate({ ...definition, relationships: acceptedRels.map((r) => r.id) });
  setSaving(false);
  setShowCreate(false);
  setEditingId(null);
  setForm(emptyForm);
  }

  function beginEdit(dataset: SemanticDataset) {
  setEditingId(dataset.datasetId);
  setShowCreate(true);
  setForm({
  datasetName: dataset.datasetName,
  description: dataset.description,
  owner: dataset.owner,
  tables: dataset.tables.join(", "),
  dimensions: dataset.dimensions.join(", "),
  measures: dataset.measures.join(", "),
  glossaryMappings: (dataset.glossaryMappings ?? []).join(", "),
  businessRules: (dataset.businessRules ?? []).join("\n"),
  relationships: dataset.relationships,
  });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{mode === "published" ? "Published Datasets" : "Semantic Drafts"}</h3>
          <span className="text-[11px] text-muted-foreground">({visibleDatasets.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
          {mode === "semantics" && <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg px-3 py-1.5 transition-colors font-medium"
          >
            <Plus className="w-3 h-3" />New Draft
          </button>}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
  <p className="text-sm font-semibold text-foreground">{editingId ? "Edit Semantic Dataset" : "Create Semantic Dataset"}</p>
  <button onClick={() => { setShowCreate(false); setEditingId(null); setForm(emptyForm); }} className="p-1 rounded hover:bg-muted/40 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: "Dataset Name *", field: "datasetName", placeholder: "e.g. Clinical Operations" },
              { label: "Owner", field: "owner", placeholder: "e.g. Analytics Team" },
              { label: "Dimensions (comma separated)", field: "dimensions", placeholder: "Branch, Service Line, Region" },
  { label: "Description", field: "description", placeholder: "Purpose and scope…" },
  { label: "Measures (comma separated)", field: "measures", placeholder: "Census, Revenue, Admissions" },
  { label: "Glossary mappings (comma separated)", field: "glossaryMappings", placeholder: "Active Census, Gross Revenue" },
  { label: "Business rules (separate with semicolons)", field: "businessRules", placeholder: "Exclude test records; Use service date" },
            ].map(({ label, field, placeholder }) => {
              const stringField = field as Exclude<keyof typeof form, "relationships">;
              return (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
                <input
                  type="text"
                  value={form[stringField]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                  placeholder={placeholder}
                  className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              );
            })}
	  </div>
      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Source tables</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {availableTables.map((table) => {
            const selectedTables = form.tables.split(",").map((item) => item.trim()).filter(Boolean);
            const selected = selectedTables.includes(table.name);
            return <label key={`${table.schema}.${table.name}`} className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={selected} onChange={(event) => setForm((current) => ({ ...current, tables: (event.target.checked ? [...new Set([...selectedTables, table.name])] : selectedTables.filter((name) => name !== table.name)).join(", ") }))} className="size-4 accent-primary" /><span className="truncate font-mono text-[10px]">{table.schema}.{table.name}</span></label>;
          })}
        </div>
      </fieldset>
	  {acceptedRels.length > 0 && <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3"><legend className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Accepted relationships</legend>{acceptedRels.map((relationship) => <label key={relationship.id} className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={form.relationships.includes(relationship.id)} onChange={(event) => setForm((current) => ({ ...current, relationships: event.target.checked ? [...current.relationships, relationship.id] : current.relationships.filter((id) => id !== relationship.id) }))} className="h-3.5 w-3.5 accent-primary" /><span className="font-mono text-[10px]">{relationship.sourceTable}.{relationship.sourceColumn} → {relationship.targetTable}.{relationship.targetColumn}</span></label>)}</fieldset>}
  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
  <p className="text-[10px] text-muted-foreground flex-1">{editingId ? "Saving creates a revision and returns pending definitions to Draft." : `${acceptedRels.length} accepted relationships will be auto-linked.`}</p>
  <button onClick={() => { setShowCreate(false); setEditingId(null); setForm(emptyForm); }} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/30 transition-colors">Cancel</button>
  <button
  onClick={handleSave}
              disabled={saving || !form.datasetName.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 font-medium"
            >
  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
  {editingId ? "Save Revision" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Dataset cards */}
      {visibleDatasets.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">{mode === "published" ? "No published datasets are available." : "No semantic drafts yet. Create a draft above."}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleDatasets.map((ds) => (
            <div key={ds.datasetId} className="border border-border rounded-xl p-4 flex flex-col gap-3 bg-card hover:border-primary/30 transition-colors">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{ds.datasetName}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{ds.owner} · v{ds.version}</p>
                </div>
                <StatusBadge status={ds.status} />
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{ds.description}</p>

              {/* Health bar */}
              {ds.health !== undefined && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">Dataset Health</span>
                    <span className="text-[10px] font-mono font-semibold text-chart-3">{ds.health}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", ds.health >= 90 ? "bg-chart-3" : ds.health >= 70 ? "bg-chart-5" : "bg-destructive")}
                      style={{ width: `${ds.health}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Chips */}
              <div className="flex flex-wrap gap-1">
                <span className="text-[9px] bg-muted/30 border border-border text-muted-foreground rounded px-1.5 py-0.5">{ds.tables.length} tables</span>
                <span className="text-[9px] bg-muted/30 border border-border text-muted-foreground rounded px-1.5 py-0.5">{ds.relationships.length} relationships</span>
                <span className="text-[9px] bg-muted/30 border border-border text-muted-foreground rounded px-1.5 py-0.5">{ds.dimensions.length} dimensions</span>
                <span className="text-[9px] bg-muted/30 border border-border text-muted-foreground rounded px-1.5 py-0.5">{ds.measures.length} measures</span>
                <span className="text-[9px] bg-primary/10 border border-primary/20 text-primary rounded px-1.5 py-0.5">Virtual · read-only</span>
              </div>
              {Boolean(ds.publicationTargets?.length) && <p className="text-[10px] leading-relaxed text-muted-foreground">Available in {ds.publicationTargets!.join(", ")}</p>}
              {Boolean(ds.sourceTraceability?.length) && <p className="text-[10px] leading-relaxed text-muted-foreground">Source: {ds.sourceTraceability!.join(" · ")}</p>}

              <div className="mt-auto flex flex-wrap gap-2 border-t border-border/50 pt-3">
                <button type="button" onClick={() => setPreviewDataset((current) => current?.datasetId === ds.datasetId ? null : ds)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/30"><Eye className="size-3" />{previewDataset?.datasetId === ds.datasetId ? "Hide details" : "Preview"}</button>
                <button type="button" onClick={() => setHistoryDatasetId((current) => current === ds.datasetId ? null : ds.datasetId)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/30"><Clock3 className="size-3" />History</button>
                {(ds.status === "Draft" || ds.status === "Pending Approval") && <><button onClick={() => beginEdit(ds)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/30"><Edit3 className="size-3" />Edit Draft</button><button onClick={() => ds.status === "Draft" ? onRequestApproval(ds.datasetId) : onPublish(ds.datasetId)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-chart-3/30 bg-chart-3/15 px-3 py-1.5 text-xs font-medium text-chart-3 hover:bg-chart-3/25"><ShieldCheck className="size-3" />{ds.status === "Draft" ? "Request Approval" : "Certify & Publish"}</button></>}
                {ds.status === "Published" && <><button type="button" onClick={() => beginEdit(ds)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/30"><Edit3 className="size-3" />Draft Revision</button><button type="button" onClick={() => void runPreview(ds)} disabled={previewingId === ds.datasetId || generateReadOnlySql(ds).startsWith("--")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{previewingId === ds.datasetId ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}Run Preview</button></>}
              </div>
              {previewDataset?.datasetId === ds.datasetId && <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-3">
                <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4"><span><strong className="block text-foreground">{ds.selectedTables?.reduce((sum, table) => sum + table.columns.length, 0) ?? 0}</strong>Selected fields</span><span><strong className="block text-foreground">{ds.health ?? 0}%</strong>Health score</span><span><strong className="block text-foreground">{ds.relationships.length}</strong>Join edges</span><span><strong className="block text-foreground">{ds.version}</strong>Version</span></div>
                {ds.healthBreakdown && <div className="grid grid-cols-2 gap-2 text-[10px]">{Object.entries(ds.healthBreakdown).map(([label, score]) => <div key={label}><div className="flex justify-between"><span className="capitalize text-muted-foreground">{label}</span><span className="font-mono text-foreground">{score}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${score}%` }} /></div></div>)}</div>}
                <div className="max-h-40 overflow-auto rounded border border-border bg-background p-2">{(ds.selectedTables ?? []).map((table) => <div key={table.name} className="border-b border-border/50 py-1.5 last:border-0"><p className="font-mono text-[10px] font-semibold text-foreground">{table.schema}.{table.name}</p><p className="text-[10px] text-muted-foreground">{table.columns.map((column) => column.name).join(", ") || "No fields selected"}</p></div>)}</div>
                <pre className="max-h-48 overflow-auto rounded border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground">{generateReadOnlySql(ds)}</pre>
                <div className="flex flex-wrap gap-2"><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Download className="size-3" />Export</span>{(["json", "yaml", "dictionary", "lineage", "graph"] as const).map((format) => <button type="button" key={format} onClick={() => void exportMetadata(ds, format)} className="rounded border border-border px-2 py-1 text-[10px] uppercase text-foreground hover:bg-muted/30">{format}</button>)}</div>
              </div>}
              {historyDatasetId === ds.datasetId && <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/10 p-3">
                <div className="flex items-center justify-between"><p className="text-xs font-semibold text-foreground">Immutable version history</p><span className="text-[10px] text-muted-foreground">Restore creates a new draft</span></div>
                {(ds.history?.length ?? 0) === 0 ? <p className="text-[10px] text-muted-foreground">No prior revisions recorded.</p> : ds.history!.slice().reverse().map((entry) => <div key={`${entry.version}-${entry.savedAt}`} className="flex items-center gap-2 rounded border border-border bg-background p-2"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-foreground">v{entry.version} · {entry.reason}</p><p className="text-[9px] text-muted-foreground">{new Date(entry.savedAt).toLocaleString()} {entry.savedBy ? `· ${entry.savedBy}` : ""}</p></div><button type="button" onClick={() => void compareVersion(ds, entry.version)} className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label={`Compare version ${entry.version}`}><GitCompare className="size-3" /></button><button type="button" onClick={() => void restoreVersion(ds, entry.version)} className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label={`Restore version ${entry.version} as new draft`}><RotateCcw className="size-3" /></button></div>)}
                {versionDiff && <div className="rounded border border-border bg-background p-2 text-[10px]"><p className="font-semibold text-foreground">v{versionDiff.version} compared with current</p><p className="mt-1 text-chart-3">Added: {versionDiff.added.join(", ") || "None"}</p><p className="text-destructive">Removed: {versionDiff.removed.join(", ") || "None"}</p><p className="text-chart-5">Modified: {versionDiff.modified.join(", ") || "None"}</p></div>}
              </div>}
            </div>
          ))}
        </div>
      )}
      {mode === "published" && previewError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{previewError}</div>}
      {mode === "published" && previewRows.length > 0 && <div className="overflow-auto rounded-lg border border-border" aria-label="Published dataset preview results"><div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2"><p className="text-xs font-semibold text-foreground">{previewDataset?.datasetName ?? "Dataset"} sample data</p><span className="text-[10px] text-muted-foreground">{Math.min(previewRows.length, 25)} rows shown · read-only</span></div><table className="w-full min-w-max text-left text-xs"><thead className="bg-muted/30"><tr>{(previewColumns.length ? previewColumns : Object.keys(previewRows[0])).map((column) => <th key={column} className="border-b border-border px-3 py-2 font-semibold text-foreground">{column}</th>)}</tr></thead><tbody>{previewRows.slice(0, 25).map((row, index) => <tr key={index} className="border-b border-border/50 last:border-0">{(previewColumns.length ? previewColumns : Object.keys(previewRows[0])).map((column) => <td key={column} className="max-w-64 truncate px-3 py-2 text-muted-foreground">{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div>}
    </div>
  );
}

// ── Scope Summary Bar ─────────────────────────────────────────────────────────

function ScopeSummaryBar({ scope }: { scope: ScopeData | null }) {
  if (!scope) return null;
  const items = [
    { label: "Tables",    value: scope.tables },
    { label: "Columns",   value: scope.columns.toLocaleString() },
    { label: "Rels",      value: scope.relationships },
    { label: "Datasets",  value: scope.datasets },
    { label: "KPIs",      value: scope.kpis },
    { label: "Reports",   value: scope.reports },
  ];
  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-muted/10 border border-border rounded-lg">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-primary">{item.value}</span>
          <span className="text-[10px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
      <div className="ml-auto text-[9px] text-muted-foreground">
        Refreshed {scope.lastRefresh ? new Date(scope.lastRefresh).toLocaleTimeString() : "—"}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export interface DatasetWorkflowState {
  tableCount: number;
  acceptedRelationshipCount: number;
  datasetCount: number;
  selectedDatasetId: string | null;
  selectedDatasetStatus: DSStatus | null;
}

interface DatasetDesignerProps {
  onNavigate?: (view: string) => void;
  initialTab?: DesignerTab;
  studioMode?: DatasetStudioMode;
  showStageTabs?: boolean;
  onWorkflowStateChange?: (state: DatasetWorkflowState) => void;
}

export function DatasetDesigner({ onNavigate, initialTab = "discovery", studioMode, showStageTabs = true, onWorkflowStateChange }: DatasetDesignerProps) {
  const [tab, setTab] = useState<DesignerTab>(initialTab);
  const [canvasTables, setCanvasTables] = useState<TableDef[]>([
    SOURCE_TABLES.find((t) => t.name === "CLIENT_EPISODES_ALL")!,
    SOURCE_TABLES.find((t) => t.name === "BRANCHES")!,
  ]);
  const [selectedColumns, setSelectedColumns] = useState<Record<string, string[]>>(() => Object.fromEntries(SOURCE_TABLES.slice(0, 1).concat(SOURCE_TABLES.filter((table) => table.name === "BRANCHES")).map((table) => [table.name, table.columns.map((column) => column.name)])));
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [datasets, setDatasets] = useState<SemanticDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inferring, setInferring] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [pendingPair, setPendingPair] = useState<{ src: DragColumn; tgt: DragColumn } | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Live discovery catalog (merges SOURCE_TABLES with live DB schema) ─────────
  const [discoveryTables, setDiscoveryTables] = useState<TableDef[]>(SOURCE_TABLES);
  const [isRefreshingCatalog, setIsRefreshingCatalog] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setIsRefreshingCatalog(true);
    try {
      const res = await fetch("/api/schema/tables");
      if (!res.ok) return;
  const json = await res.json() as {
  source: string;
  tables: Array<{
  table_schema: string;
  table_name: string;
  qualified_name: string;
  estimated_row_count?: number;
  columns?: Array<{ column_name: string; data_type: string; is_nullable: boolean; is_primary_key: boolean; is_foreign_key: boolean }>;
  }>;
  };
  if (json.source === "no_db" || !json.tables.length) return;

  const staticByName = new Map(SOURCE_TABLES.map((table) => [table.name.toLowerCase(), table]));
  const hydratedTables: TableDef[] = json.tables.map((row) => {
  const existing = staticByName.get(row.table_name.toLowerCase());
  const columns = (row.columns ?? []).map((column) => ({
  name: column.column_name,
  type: column.data_type,
  isPk: column.is_primary_key,
  isFk: column.is_foreign_key,
  nullable: column.is_nullable,
  description: existing?.columns.find((item) => item.name.toLowerCase() === column.column_name.toLowerCase())?.description ?? "Live source column",
  }));
  return {
  name: row.table_name,
  schema: row.table_schema,
  recordCount: row.estimated_row_count ?? existing?.recordCount ?? 0,
  columnCount: columns.length || existing?.columnCount || 0,
  primaryKeys: columns.filter((column) => column.isPk).map((column) => column.name),
  foreignKeys: columns.filter((column) => column.isFk).map((column) => column.name),
  businessDescription: existing?.businessDescription ?? `Live table discovered from ${row.table_schema} schema.`,
  columns: columns.length ? columns : existing?.columns ?? [],
  };
  });
  const liveNames = new Set(hydratedTables.map((table) => table.name.toLowerCase()));
  const staticOnly = SOURCE_TABLES.filter((table) => !liveNames.has(table.name.toLowerCase()));
  setDiscoveryTables([...hydratedTables, ...staticOnly]);
  setCanvasTables((current) => current.map((table) => hydratedTables.find((live) => live.name.toLowerCase() === table.name.toLowerCase()) ?? table));
  showToast(`Catalog refreshed — ${hydratedTables.length} live table(s) hydrated`);
    } catch {
      // Non-critical — keep showing SOURCE_TABLES
    } finally {
      setIsRefreshingCatalog(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canvasSet = new Set(canvasTables.map((t) => t.name));

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/designer/datasets");
      if (res.ok) {
        const json = await res.json() as {
          datasets: SemanticDataset[];
          relationships: Relationship[];
          scope: ScopeData;
        };
        const nextDatasets = json.datasets ?? [];
        setDatasets(nextDatasets);
        setSelectedDatasetId((current) => current && nextDatasets.some((dataset) => dataset.datasetId === current)
          ? current
          : nextDatasets.find((dataset) => dataset.status === "Draft")?.datasetId ?? nextDatasets[0]?.datasetId ?? null);
        setRelationships(json.relationships ?? []);
        setScope(json.scope ?? null);
      }
    } catch {
      // Fallback — non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // Auto-refresh the live DB catalog on mount so the Discovery panel shows all tables
  // immediately (not only after user manually clicks Refresh)
  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);

  // Add the table to Build state without changing workflow stages. Users can
  // continue discovering sources, then open Build explicitly when ready.
  function handleAddToCanvas(t: TableDef) {
    setCanvasTables((prev) => prev.find((x) => x.name === t.name) ? prev : [...prev, t]);
    setSelectedColumns((current) => ({ ...current, [t.name]: current[t.name]?.length ? current[t.name] : t.columns.map((column) => column.name) }));
    showToast(`${t.name} added to Build.`);
  }

  function handleToggleCanvasTable(table: TableDef, selected: boolean) {
    setCanvasTables((current) => selected
      ? current.some((item) => item.name === table.name) ? current : [...current, table]
      : current.filter((item) => item.name !== table.name));
    setSelectedColumns((current) => selected
      ? { ...current, [table.name]: current[table.name]?.length ? current[table.name] : table.columns.map((column) => column.name) }
      : Object.fromEntries(Object.entries(current).filter(([name]) => name !== table.name)));
  }

  function handleToggleColumn(table: TableDef, column: string | "*", selected: boolean) {
    setSelectedColumns((current) => {
      const existing = current[table.name] ?? [];
      const next = column === "*" ? (selected ? table.columns.map((item) => item.name) : []) : selected ? [...new Set([...existing, column])] : existing.filter((name) => name !== column);
      return { ...current, [table.name]: next };
    });
  }

  // Canvas: create relationship (from drag-drop)
  async function handleCreateRelationship(src: DragColumn, tgt: DragColumn) {
    setPendingPair({ src, tgt });
    setInferring(true);
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:       "infer",
          sourceTable:  src.table,
          sourceColumn: src.column,
          sourceType:   src.type,
          targetTable:  tgt.table,
          targetColumn: tgt.column,
          targetType:   tgt.type,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; inference: InferenceResult };
      if (json.success && json.inference.detected) {
        setInferenceResult(json.inference);
      } else {
        // Low confidence — still show popup with fallback
        setInferenceResult({
          detected:         true,
          sourceTable:      src.table,
          sourceColumn:     src.column,
          targetTable:      tgt.table,
          targetColumn:     tgt.column,
          relationshipType: "ManyToOne",
          confidence:       0.65,
          reasons:          ["Manual column pair selected"],
        });
      }
    } catch {
      setInferenceResult({
        detected: true,
        sourceTable: src.table, sourceColumn: src.column,
        targetTable: tgt.table, targetColumn: tgt.column,
        relationshipType: "ManyToOne", confidence: 0.7,
        reasons: ["Manual selection"],
      });
    } finally {
      setInferring(false);
    }
  }

  async function handleAcceptInference() {
    if (!inferenceResult) return;
    setInferring(true);
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:           "accept_rel",
          sourceTable:      inferenceResult.sourceTable,
          sourceColumn:     inferenceResult.sourceColumn,
          targetTable:      inferenceResult.targetTable,
          targetColumn:     inferenceResult.targetColumn,
          relationshipType: inferenceResult.relationshipType,
          confidence:       inferenceResult.confidence,
          reasons:          inferenceResult.reasons,
          createdBy:        "analyst",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; relationship: Relationship };
      if (json.success) {
        setRelationships((prev) => {
          const exists = prev.find((r) => r.id === json.relationship.id);
          return exists ? prev.map((r) => r.id === json.relationship.id ? json.relationship : r) : [json.relationship, ...prev];
        });
        showToast(`Relationship ${json.relationship.id} accepted. Open Relationships to review it.`);
      }
    } catch (err) {
      showToast(`Failed to save relationship${err instanceof Error ? `: ${err.message}` : ""}`, false);
    } finally {
      setInferring(false);
      setInferenceResult(null);
      setPendingPair(null);
    }
  }

  async function handleAcceptExisting(id: string) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_rel", id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; relationship: Relationship };
      if (json.success) {
        setRelationships((prev) => prev.map((r) => r.id === id ? json.relationship : r));
        showToast(`${id} accepted`);
      }
    } catch (err) { showToast(`Failed to update relationship${err instanceof Error ? `: ${err.message}` : ""}`, false); }
  }

  async function handleRejectExisting(id: string) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject_rel", id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; relationship: Relationship };
      if (json.success) {
        setRelationships((prev) => prev.map((r) => r.id === id ? json.relationship : r));
        showToast(`${id} rejected`);
      }
    } catch (err) { showToast(`Failed to update relationship${err instanceof Error ? `: ${err.message}` : ""}`, false); }
  }

  async function handleRequestApproval(datasetId: string) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_approval", datasetId }),
      });
      const json = await res.json() as { success?: boolean; dataset?: SemanticDataset; error?: string };
      if (!res.ok || !json.success || !json.dataset) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDatasets((prev) => prev.map((dataset) => dataset.datasetId === datasetId ? json.dataset! : dataset));
      showToast(`${json.dataset.datasetName} submitted for approval`);
    } catch (err) { showToast(`Approval request blocked${err instanceof Error ? `: ${err.message}` : ""}`, false); }
  }

  async function handlePublish(datasetId: string) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish_dataset", datasetId }),
      });
      const json = await res.json() as { success?: boolean; dataset?: SemanticDataset; error?: string };
      if (!res.ok || !json.success || !json.dataset) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDatasets((prev) => prev.map((d) => d.datasetId === datasetId ? json.dataset! : d));
      showToast(`${json.dataset.datasetName} published`);
    } catch (err) { showToast(`Failed to publish dataset${err instanceof Error ? `: ${err.message}` : ""}`, false); }
  }

  async function handleCreateDataset(data: Partial<SemanticDataset>) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_dataset", ...data }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; dataset: SemanticDataset };
      if (json.success) {
        setDatasets((prev) => [...prev, json.dataset]);
        setSelectedDatasetId(json.dataset.datasetId);
        showToast(`Dataset "${json.dataset.datasetName}" created`);
      }
    } catch (err) { showToast(`Failed to create dataset${err instanceof Error ? `: ${err.message}` : ""}`, false); throw err; }
  }

  async function handleUpdateDataset(datasetId: string, data: Partial<SemanticDataset>) {
    try {
      const res = await fetch("/api/designer/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_dataset", datasetId, actor: "analyst", ...data }),
      });
      const json = await res.json() as { success?: boolean; dataset?: SemanticDataset; error?: string };
      if (!res.ok || !json.success || !json.dataset) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDatasets((current) => current.some((dataset) => dataset.datasetId === json.dataset!.datasetId)
        ? current.map((dataset) => dataset.datasetId === json.dataset!.datasetId ? json.dataset! : dataset)
        : [...current, json.dataset!]);
      setSelectedDatasetId(json.dataset.datasetId);
      showToast(`${json.dataset.datasetName} saved as draft v${json.dataset.version} · published revision preserved`);
    } catch (err) { showToast(`Failed to update dataset${err instanceof Error ? `: ${err.message}` : ""}`, false); throw err; }
  }

  const selectedDataset = datasets.find((dataset) => dataset.datasetId === selectedDatasetId) ?? null;
  const validationTables = selectedDataset?.tables.length
    ? selectedDataset.tables.map((tableName) => discoveryTables.find((table) => table.name === tableName) ?? { name: tableName, schema: "unknown", recordCount: 0, columnCount: 0, primaryKeys: [], foreignKeys: [], businessDescription: "Referenced by the selected semantic dataset.", columns: [] })
    : canvasTables;
 const validationRelationships = selectedDataset
 ? selectedDataset.relationships.map((relationshipId) => relationships.find((relationship) => relationship.id === relationshipId)).filter((relationship): relationship is Relationship => relationship !== undefined).filter((relationship) => relationship.status === "Accepted")
 : relationships.filter((relationship) => relationship.status === "Accepted");
 const validationRelationshipCount = validationRelationships.length;

  useEffect(() => {
    onWorkflowStateChange?.({
      tableCount: validationTables.length,
      acceptedRelationshipCount: validationRelationshipCount,
      datasetCount: datasets.length,
      selectedDatasetId: selectedDataset?.datasetId ?? null,
      selectedDatasetStatus: selectedDataset?.status ?? null,
    });
  }, [datasets.length, onWorkflowStateChange, selectedDataset?.datasetId, selectedDataset?.status, validationRelationshipCount, validationTables.length]);

  const TABS: { id: DesignerTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "discovery",    label: "Table Discovery", icon: Database,    count: SOURCE_TABLES.length },
    { id: "canvas",       label: "Relationship Canvas", icon: GitMerge, count: canvasTables.length },
    { id: "relationships",label: "Relationships",   icon: Network,     count: relationships.length },
    { id: "datasets",     label: "Semantic Datasets", icon: Layers,    count: datasets.length },
    { id: "validation",   label: "Validation",        icon: ShieldCheck },
    { id: "lineage",      label: "Lineage",           icon: Network },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Scope summary */}
      <ScopeSummaryBar scope={scope} />

      {/* Optional standalone tab bar; Dataset Studio owns the canonical workflow navigation. */}
      {showStageTabs && (
        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border w-fit overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0",
                tab === id
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {count !== undefined && (
                <span className="text-[9px] bg-muted/50 border border-border rounded-full px-1.5 py-0.5">{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="bg-card border border-border rounded-xl p-5">
        {loading && tab !== "canvas" && tab !== "discovery" ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />Loading…
          </div>
        ) : (
          <>
            {tab === "discovery" && (
              <DiscoveryPanel
                canvasTables={canvasSet}
                onAddToCanvas={handleAddToCanvas}
                sourceTables={discoveryTables}
                isRefreshing={isRefreshingCatalog}
                onRefresh={refreshCatalog}
              />
            )}
            {tab === "canvas" && (
              <CanvasPanel
                canvasTables={canvasTables}
                availableTables={discoveryTables}
                onAddToCanvas={() => setTab("discovery")}
                onToggleTable={handleToggleCanvasTable}
                selectedColumns={selectedColumns}
                onToggleColumn={handleToggleColumn}
                onCreateRelationship={handleCreateRelationship}
              />
            )}
            {tab === "relationships" && (
              <RelationshipsPanel
                relationships={relationships}
                loading={loading}
                onAccept={handleAcceptExisting}
                onReject={handleRejectExisting}
                onRefresh={loadData}
              />
            )}
            {tab === "datasets" && (
	  <DatasetsPanel
	  datasets={datasets}
	  relationships={relationships}
	      availableTables={discoveryTables}
          selectedColumns={selectedColumns}
	      mode={studioMode === "published" ? "published" : "semantics"}
	  loading={loading}
  onPublish={handlePublish}
  onRequestApproval={handleRequestApproval}
  onCreate={handleCreateDataset}
  onUpdate={handleUpdateDataset}
                onRefresh={loadData}
              />
            )}
            {tab === "validation" && (
              <div className="flex flex-col gap-4">
                {datasets.length > 0 && <label className="flex flex-col gap-1.5 text-xs text-muted-foreground"><span>Semantic dataset to validate</span><select value={selectedDatasetId ?? ""} onChange={(event) => setSelectedDatasetId(event.target.value)} className="max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary">{datasets.map((dataset) => <option key={dataset.datasetId} value={dataset.datasetId}>{dataset.datasetName} · {dataset.status}</option>)}</select></label>}
                {selectedDataset && selectedDataset.tables.length === 0 && canvasTables.length === 0 ? <div role="status" className="rounded-xl border border-chart-5/30 bg-chart-5/10 p-5"><h3 className="text-sm font-semibold text-foreground">This semantic dataset has no selected source tables</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Return to Build, add governed source tables to the canvas, then update or recreate the semantic dataset before validation. Publication remains blocked until source traceability is complete.</p><button type="button" onClick={() => setTab("canvas")} className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Go to Build</button></div> : <DatasetValidationHub datasetId={selectedDataset?.datasetId ?? "dataset-draft"} tables={validationTables} relationships={validationRelationships} />}
              </div>
            )}
            {tab === "lineage" && (
              <DatasetLineagePanel
                tables={canvasTables}
                relationshipCount={relationships.filter((relationship) => relationship.status === "Accepted").length}
              />
            )}
          </>
        )}
      </div>

      {/* Cross-navigation */}
      {onNavigate && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">Continue to:</p>
          <button
            onClick={() => onNavigate("registry")}
            className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
          >
            <Network className="w-3 h-3" />Schema Registry
          </button>
          <button
            onClick={() => onNavigate("kpi")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/20 transition-colors"
          >
            <BarChart3 className="w-3 h-3" />KPI Explorer
          </button>
          <button
            onClick={() => onNavigate("schema")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" />Schema Intelligence
          </button>
        </div>
      )}

      {/* Inference popup */}
      {inferenceResult && (
        <InferencePopup
          inference={inferenceResult}
          onAccept={handleAcceptInference}
          onReject={() => { setInferenceResult(null); setPendingPair(null); showToast("Relationship rejected"); }}
          onModify={() => { /* Future: open edit form */ setInferenceResult(null); setPendingPair(null); }}
          loading={inferring}
          onClose={() => { setInferenceResult(null); setPendingPair(null); }}
        />
      )}

      {/* Inferring spinner */}
      {inferring && !inferenceResult && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-card border border-border text-xs text-muted-foreground px-4 py-2.5 rounded-lg shadow-lg">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          Running Smart Inference Engine…
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-xs px-4 py-2.5 rounded-full shadow-lg transition-all",
          toast.ok ? "bg-chart-3/20 text-chart-3 border border-chart-3/30" : "bg-destructive/20 text-destructive border border-destructive/30"
        )}>
          {toast.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
