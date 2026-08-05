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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DatasetLineagePanel, DatasetValidationHub } from "./DatasetValidationHub";

// ── Types ─────────────────────────────────────────────────────────────────────

type RelType    = "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
type RelStatus  = "Suggested" | "Accepted" | "Rejected";
type DSStatus   = "Draft" | "Pending Approval" | "Published" | "Deprecated";
type DesignerTab = "discovery" | "canvas" | "relationships" | "datasets" | "validation" | "lineage";

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
  relationships: string[];
  dimensions:    string[];
  measures:      string[];
  owner:         string;
  version:       string;
  status:        DSStatus;
  createdDate:   string;
  publishedDate?: string;
  createdBy:     string;
  health?:       number;
  publicationTargets?: string[];
  sourceTraceability?: string[];
  virtual?: boolean;
  authoritative?: boolean;
  history?: Array<{ version: string; savedAt: string; reason: string }>;
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
                    {t.columns.map((c) => (
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
  onAddToCanvas,
  onCreateRelationship,
}: {
  canvasTables: TableDef[];
  onAddToCanvas: () => void;
  onCreateRelationship: (src: DragColumn, tgt: DragColumn) => void;
}) {
  const [dragColumn, setDragColumn] = useState<DragColumn | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);

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
              {/* Column rows */}
              <div className="flex flex-col divide-y divide-border/30">
                {t.columns.map((c) => {
                  const colKey = `${t.name}.${c.name}`;
                  const isDragSource = dragColumn?.table === t.name && dragColumn?.column === c.name;
                  const isHover = hoveredColumn === colKey && dragColumn && dragColumn.table !== t.name;
                  return (
                    <div
                      key={`${t.schema}.${t.name}.${c.name}`}
                      draggable
                      onDragStart={() => handleDragStart(t.name, c.name, c.type)}
                      onDragEnd={() => setDragColumn(null)}
                      onDragOver={(e) => { e.preventDefault(); setHoveredColumn(colKey); }}
                      onDragLeave={() => setHoveredColumn(null)}
                      onDrop={() => handleDrop(t.name, c.name, c.type)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 cursor-grab active:cursor-grabbing select-none transition-colors",
                        isDragSource ? "bg-primary/10 border-l-2 border-primary" : "",
                        isHover ? "bg-chart-3/10 border-l-2 border-chart-3" : "hover:bg-muted/20",
                      )}
                      title={`Drag ${t.name}.${c.name} to create a relationship`}
                    >
                      <div className="flex items-center gap-1 w-8 shrink-0">
                        {c.isPk && <span className="text-[8px] font-bold text-chart-5">PK</span>}
                        {c.isFk && <span className="text-[8px] font-bold text-primary">FK</span>}
                      </div>
                      <span className="text-[11px] font-mono text-foreground flex-1 truncate">{c.name}</span>
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
  loading,
  onPublish,
  onRequestApproval,
  onCreate,
  onRefresh,
}: {
  datasets:      SemanticDataset[];
  relationships: Relationship[];
  loading:       boolean;
  onPublish:     (id: string) => void;
  onRequestApproval: (id: string) => void;
  onCreate:      (d: Partial<SemanticDataset>) => void;
  onRefresh:     () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ datasetName: "", description: "", owner: "Analytics Team", tables: "", dimensions: "", measures: "" });
  const [saving, setSaving] = useState(false);

  const acceptedRels = relationships.filter((r) => r.status === "Accepted");

  async function handleCreate() {
    if (!form.datasetName.trim()) return;
    setSaving(true);
    await onCreate({
      datasetName:  form.datasetName.trim(),
      description:  form.description.trim(),
      owner:        form.owner.trim() || "Analytics Team",
      tables:       form.tables.split(",").map((s) => s.trim()).filter(Boolean),
      dimensions:   form.dimensions.split(",").map((s) => s.trim()).filter(Boolean),
      measures:     form.measures.split(",").map((s) => s.trim()).filter(Boolean),
      relationships: acceptedRels.map((r) => r.id),
    });
    setSaving(false);
    setShowCreate(false);
    setForm({ datasetName: "", description: "", owner: "Analytics Team", tables: "", dimensions: "", measures: "" });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Semantic Datasets</h3>
          <span className="text-[11px] text-muted-foreground">({datasets.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg px-3 py-1.5 transition-colors font-medium"
          >
            <Plus className="w-3 h-3" />New Dataset
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Create Semantic Dataset</p>
            <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-muted/40 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: "Dataset Name *", field: "datasetName", placeholder: "e.g. Clinical Operations" },
              { label: "Owner", field: "owner", placeholder: "e.g. Analytics Team" },
              { label: "Tables (comma separated)", field: "tables", placeholder: "CLIENT_EPISODES_ALL, BRANCHES" },
              { label: "Dimensions (comma separated)", field: "dimensions", placeholder: "Branch, Service Line, Region" },
              { label: "Description", field: "description", placeholder: "Purpose and scope…" },
              { label: "Measures (comma separated)", field: "measures", placeholder: "Census, Revenue, Admissions" },
            ].map(({ label, field, placeholder }) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
                <input
                  type="text"
                  value={(form as Record<string, string>)[field]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                  placeholder={placeholder}
                  className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground flex-1">{acceptedRels.length} accepted relationships will be auto-linked.</p>
            <button onClick={() => setShowCreate(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/30 transition-colors">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={saving || !form.datasetName.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 font-medium"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* Dataset cards */}
      {datasets.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">No datasets yet. Create your first semantic dataset above.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {datasets.map((ds) => (
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

              {/* Footer actions */}
              {(ds.status === "Draft" || ds.status === "Pending Approval") && (
                <div className="pt-2 border-t border-border/50 mt-auto">
                  <button
                    onClick={() => ds.status === "Draft" ? onRequestApproval(ds.datasetId) : onPublish(ds.datasetId)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-chart-3/15 text-chart-3 border border-chart-3/30 hover:bg-chart-3/25 transition-colors font-medium"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    {ds.status === "Draft" ? "Request Approval" : "Certify & Publish"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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

interface DatasetDesignerProps {
  onNavigate?: (view: string) => void;
  initialTab?: DesignerTab;
  showStageTabs?: boolean;
}

export function DatasetDesigner({ onNavigate, initialTab = "discovery", showStageTabs = true }: DatasetDesignerProps) {
  const [tab, setTab] = useState<DesignerTab>(initialTab);
  const [canvasTables, setCanvasTables] = useState<TableDef[]>([
    SOURCE_TABLES.find((t) => t.name === "CLIENT_EPISODES_ALL")!,
    SOURCE_TABLES.find((t) => t.name === "BRANCHES")!,
  ]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [datasets, setDatasets] = useState<SemanticDataset[]>([]);
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
        tables: { table_schema: string; table_name: string; qualified_name: string }[];
      };
      if (json.source === "no_db" || !json.tables.length) return;

      // Build a lookup of existing SOURCE_TABLE names (unqualified, lowercase)
      const existingNames = new Set(SOURCE_TABLES.map((t) => t.name.toLowerCase()));

      // Tables present in the live DB but not in SOURCE_TABLES
      const newTables: TableDef[] = json.tables
        .filter((r) => !existingNames.has(r.table_name.toLowerCase()))
        .map((r) => ({
          name:                r.table_name,
          schema:              r.table_schema,
          recordCount:         0,
          columnCount:         0,
          primaryKeys:         [],
          foreignKeys:         [],
          businessDescription: `Live table discovered from ${r.table_schema} schema.`,
          columns:             [],
        }));

      setDiscoveryTables([...SOURCE_TABLES, ...newTables]);
      if (newTables.length > 0) {
        showToast(`Catalog refreshed — ${newTables.length} additional table(s) from live DB`);
      } else {
        showToast("Catalog is in sync with the live database");
      }
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
        setDatasets(json.datasets ?? []);
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

  // Canvas: add table from discovery
  function handleAddToCanvas(t: TableDef) {
    setCanvasTables((prev) => prev.find((x) => x.name === t.name) ? prev : [...prev, t]);
    setTab("canvas");
    showToast(`${t.name} added to canvas`);
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
        showToast(`Relationship ${json.relationship.id} accepted`);
        setTab("relationships");
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
        showToast(`Dataset "${json.dataset.datasetName}" created`);
      }
    } catch (err) { showToast(`Failed to create dataset${err instanceof Error ? `: ${err.message}` : ""}`, false); }
  }

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
                onAddToCanvas={() => setTab("discovery")}
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
                loading={loading}
                onPublish={handlePublish}
                onCreate={handleCreateDataset}
                onRefresh={loadData}
              />
            )}
            {tab === "validation" && (
              <DatasetValidationHub
                datasetId={datasets.find((dataset) => dataset.status === "Draft")?.datasetId ?? datasets[0]?.datasetId ?? "dataset-draft"}
                tables={canvasTables}
                relationshipCount={relationships.filter((relationship) => relationship.status === "Accepted").length}
              />
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
