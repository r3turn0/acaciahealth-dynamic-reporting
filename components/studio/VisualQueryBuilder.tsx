"use client";

import { useState, useEffect } from "react";
import {
  Database,
  Layers,
  Filter,
  ArrowUpDown,
  Play,
  RefreshCw,
  Loader2,
  ChevronDown,
  X,
  Plus,
  CheckSquare,
  Square,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import kpiConfig from "@/lib/config/kpiConfig.json";
import schemaConfig from "@/lib/config/schemaConfig.json";
import type { QueryPlan } from "./AskAI";

type KpiKey = keyof typeof kpiConfig;

// ── Types ─────────────────────────────────────────────────────────────────────

interface FilterRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface BuilderState {
  kpi: KpiKey;
  groupBy: string[];
  filters: FilterRow[];
  orderBy: string;
  orderDir: "ASC" | "DESC";
  limit: number | "";
}

interface VisualQueryBuilderProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  onPlanReady: (plan: QueryPlan, startDate: string, endDate: string) => void;
  loading: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KPI_OPTIONS: { value: KpiKey; label: string; description: string }[] = [
  { value: "admissions", label: "Admissions", description: "Count of new patient start-of-care events" },
  { value: "discharges", label: "Discharges", description: "Count of patient discharge events" },
  { value: "revenue", label: "Revenue", description: "Total billed revenue from line items" },
  { value: "census", label: "Census", description: "Active patient census count" },
];

const GROUPING_LABELS: Record<string, string> = {
  branch: "Branch",
  week: "Week",
  month: "Month",
  region: "Region",
  care_type: "Care Type",
  service_line: "Service Line",
};

const FILTER_FIELDS: Record<KpiKey, { value: string; label: string; type: "text" | "number" | "select" }[]> = {
  admissions: [
    { value: "b.branch_name", label: "Branch Name", type: "text" },
    { value: "epi.epi_branchcode", label: "Branch Code", type: "text" },
    { value: "ct.ct_name", label: "Care Type", type: "select" },
  ],
  discharges: [
    { value: "b.branch_name", label: "Branch Name", type: "text" },
    { value: "epi.epi_branchcode", label: "Branch Code", type: "text" },
  ],
  revenue: [
    { value: "b.branch_name", label: "Branch Name", type: "text" },
    { value: "sl.sl_name", label: "Service Line", type: "text" },
    { value: "li.li_amount", label: "Amount", type: "number" },
  ],
  census: [
    { value: "b.branch_name", label: "Branch Name", type: "text" },
    { value: "ct.ct_name", label: "Care Type", type: "select" },
  ],
};

const OPERATORS = {
  text: ["=", "!=", "LIKE", "NOT LIKE", "IN", "NOT IN"],
  number: ["=", "!=", ">", ">=", "<", "<=", "BETWEEN"],
  select: ["=", "!="],
};

const PREBUILT_TEMPLATES: {
  label: string;
  description: string;
  state: Partial<BuilderState>;
}[] = [
  {
    label: "Admissions by Branch",
    description: "Count new admissions grouped by branch",
    state: { kpi: "admissions", groupBy: ["branch"], orderBy: "admissions", orderDir: "DESC" },
  },
  {
    label: "Weekly Admissions",
    description: "Week-by-week admission trend",
    state: { kpi: "admissions", groupBy: ["week", "branch"], orderBy: "week_number", orderDir: "ASC" },
  },
  {
    label: "Revenue by Service Line",
    description: "Total revenue broken down by service line",
    state: { kpi: "revenue", groupBy: ["service_line"], orderBy: "revenue", orderDir: "DESC" },
  },
  {
    label: "Active Census by Care Type",
    description: "Current active patient census by care type",
    state: { kpi: "census", groupBy: ["care_type", "branch"], orderBy: "census", orderDir: "DESC" },
  },
  {
    label: "Monthly Discharges",
    description: "Discharge count by month",
    state: { kpi: "discharges", groupBy: ["month"], orderBy: "month", orderDir: "ASC" },
  },
];

const LIMIT_OPTIONS = [10, 25, 50, 100, 500, 1000];

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-primary" />
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function GroupByToggle({
  value,
  label,
  checked,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: string, on: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value, !checked)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors",
        checked
          ? "bg-primary/10 border-primary/40 text-primary"
          : disabled
          ? "bg-muted/30 border-border/40 text-muted-foreground/40 cursor-not-allowed"
          : "bg-muted/50 border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {checked ? (
        <CheckSquare className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <Square className="w-3.5 h-3.5 shrink-0" />
      )}
      {label}
    </button>
  );
}

function FilterRowItem({
  row,
  fields,
  onChange,
  onRemove,
}: {
  row: FilterRow;
  fields: { value: string; label: string; type: "text" | "number" | "select" }[];
  onChange: (updated: FilterRow) => void;
  onRemove: () => void;
}) {
  const fieldDef = fields.find((f) => f.value === row.field);
  const operators = fieldDef ? OPERATORS[fieldDef.type] : OPERATORS.text;

  return (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
      {/* Field selector */}
      <div className="relative min-w-[130px]">
        <select
          value={row.field}
          onChange={(e) => onChange({ ...row, field: e.target.value, operator: "=", value: "" })}
          className="w-full appearance-none bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-7"
        >
          <option value="">Select field...</option>
          {fields.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
      </div>

      {/* Operator selector */}
      <div className="relative min-w-[90px]">
        <select
          value={row.operator}
          onChange={(e) => onChange({ ...row, operator: e.target.value })}
          className="w-full appearance-none bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-7"
        >
          {operators.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
      </div>

      {/* Value input */}
      <input
        type={fieldDef?.type === "number" ? "number" : "text"}
        placeholder="Value..."
        value={row.value}
        onChange={(e) => onChange({ ...row, value: e.target.value })}
        className="flex-1 min-w-[100px] bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-destructive transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── SQL preview builder ───────────────────────────────────────────────────────

function buildPreviewSQL(state: BuilderState, startDate: string, endDate: string): string {
  const kpi = kpiConfig[state.kpi];
  const groupDefs: Record<string, { selectExpr: string; groupExpr: string; alias: string }> = {
    branch: { selectExpr: "b.branch_name", groupExpr: "b.branch_name", alias: "branch_name" },
    week: { selectExpr: `DATEPART(WEEK, ${kpi.alias}.${kpi.date_column})`, groupExpr: `DATEPART(WEEK, ${kpi.alias}.${kpi.date_column})`, alias: "week_number" },
    month: { selectExpr: `DATEPART(MONTH, ${kpi.alias}.${kpi.date_column})`, groupExpr: `DATEPART(MONTH, ${kpi.alias}.${kpi.date_column})`, alias: "month" },
    care_type: { selectExpr: "ct.ct_name", groupExpr: "ct.ct_name", alias: "care_type" },
    service_line: { selectExpr: "sl.sl_name", groupExpr: "sl.sl_name", alias: "service_line" },
    region: { selectExpr: "b.branch_name", groupExpr: "b.branch_name", alias: "region" },
  };

  const selectCols: string[] = [];
  const groupExprs: string[] = [];

  for (const g of state.groupBy) {
    const def = groupDefs[g];
    if (!def) continue;
    selectCols.push(`    ${def.selectExpr} AS ${def.alias}`);
    groupExprs.push(def.groupExpr);
  }
  selectCols.push(`    ${kpi.aggregation} AS ${state.kpi}`);

  // JOINs
  const joins: string[] = [];
  const needsBranch = state.groupBy.includes("branch") || state.groupBy.includes("region");
  const needsCareType = state.groupBy.includes("care_type");
  const needsServiceLine = state.groupBy.includes("service_line");
  const isRevenue = kpi.fact_table === "Billing.LINE_ITEMS";

  if (needsBranch) {
    if (isRevenue) {
      joins.push("JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id");
      joins.push("JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)");
    } else {
      joins.push("JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)");
    }
  }
  if (needsCareType && !isRevenue) {
    joins.push("JOIN CARE_TYPES ct ON epi.epi_care_type_id = ct.ct_id");
  }
  if (needsServiceLine) {
    if (isRevenue) {
      if (!joins.some((j) => j.includes("CLIENT_EPISODES_ALL"))) {
        joins.push("JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id");
      }
      joins.push("JOIN SERVICE_LINES sl ON epi.epi_sl_id = sl.sl_id");
    } else {
      joins.push("JOIN SERVICE_LINES sl ON epi.epi_sl_id = sl.sl_id");
    }
  }

  // WHERE
  const whereFilters = [
    `${kpi.alias}.${kpi.date_column} BETWEEN @StartDate AND @EndDate`,
    `-- @StartDate = '${startDate}', @EndDate = '${endDate}'`,
    ...state.filters
      .filter((f) => f.field && f.value)
      .map((f) => {
        if (f.operator === "LIKE" || f.operator === "NOT LIKE") {
          return `${f.field} ${f.operator} '%${f.value}%'`;
        }
        if (f.operator === "IN" || f.operator === "NOT IN") {
          return `${f.field} ${f.operator} (${f.value})`;
        }
        const isNum = !isNaN(Number(f.value));
        return `${f.field} ${f.operator} ${isNum ? f.value : `'${f.value}'`}`;
      }),
  ];

  const orderByExpr = state.orderBy || (groupExprs[0] ?? state.kpi);

  const lines: string[] = [
    `SELECT`,
    selectCols.join(",\n"),
    `FROM ${kpi.fact_table} ${kpi.alias}`,
    ...joins,
    `WHERE`,
    `    ${whereFilters.join("\n    AND ")}`,
    groupExprs.length > 0 ? `GROUP BY\n    ${groupExprs.join(",\n    ")}` : "",
    `ORDER BY ${orderByExpr} ${state.orderDir}`,
    state.limit ? `OFFSET 0 ROWS FETCH NEXT ${state.limit} ROWS ONLY` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

// ── Main component ────────────────────────────────────────────────────────────

export function VisualQueryBuilder({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onPlanReady,
  loading,
}: VisualQueryBuilderProps) {
  const [state, setState] = useState<BuilderState>({
    kpi: "admissions",
    groupBy: ["branch"],
    filters: [],
    orderBy: "admissions",
    orderDir: "DESC",
    limit: 100,
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const kpi = kpiConfig[state.kpi];
  const allowedGroups = kpi.grouping_options as string[];
  const filterFields = FILTER_FIELDS[state.kpi];
  const previewSQL = buildPreviewSQL(state, startDate, endDate);

  // Reset groupBy when KPI changes to only keep valid groups
  function setKpi(k: KpiKey) {
    const newKpiConfig = kpiConfig[k];
    const allowed = new Set(newKpiConfig.grouping_options as string[]);
    setState((s) => ({
      ...s,
      kpi: k,
      groupBy: s.groupBy.filter((g) => allowed.has(g)),
      filters: [],
      orderBy: k,
    }));
  }

  function toggleGroup(value: string, on: boolean) {
    setState((s) => ({
      ...s,
      groupBy: on
        ? [...s.groupBy, value]
        : s.groupBy.filter((g) => g !== value),
    }));
  }

  function addFilter() {
    const firstField = filterFields[0]?.value ?? "";
    setState((s) => ({
      ...s,
      filters: [
        ...s.filters,
        { id: makeId(), field: firstField, operator: "=", value: "" },
      ],
    }));
  }

  function updateFilter(id: string, updated: FilterRow) {
    setState((s) => ({
      ...s,
      filters: s.filters.map((f) => (f.id === id ? updated : f)),
    }));
  }

  function removeFilter(id: string) {
    setState((s) => ({ ...s, filters: s.filters.filter((f) => f.id !== id) }));
  }

  function applyTemplate(t: (typeof PREBUILT_TEMPLATES)[number]) {
    setState((s) => ({
      ...s,
      ...t.state,
      filters: [],
      limit: s.limit,
    }));
  }

  async function generate() {
    if (!startDate || !endDate) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${kpi.label} by ${state.groupBy.join(" and ")} from ${startDate} to ${endDate}`,
          start_date: startDate,
          end_date: endDate,
          // Pass builder state directly so the route can use it for structured generation
          builder: {
            kpi: state.kpi,
            group_by: state.groupBy,
            filters: state.filters.filter((f) => f.field && f.value),
            order_by: state.orderBy,
            order_dir: state.orderDir,
            limit: state.limit || undefined,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) return;

      // Use our previewSQL as the definitive SQL — the API explanation is supplementary
      const plan: QueryPlan = {
        ...json,
        sql: previewSQL,
        tables_used: [kpi.fact_table, "BRANCHES", ...(state.groupBy.includes("care_type") ? ["CARE_TYPES"] : []), ...(state.groupBy.includes("service_line") ? ["SERVICE_LINES"] : [])],
        filters_applied: [
          `Date: ${startDate} → ${endDate}`,
          `KPI: ${kpi.label}`,
          `Group by: ${state.groupBy.map((g) => GROUPING_LABELS[g] ?? g).join(", ")}`,
          ...state.filters.filter((f) => f.field && f.value).map((f) => `${f.field} ${f.operator} ${f.value}`),
        ],
        kpi_detected: state.kpi,
        strategy: "sql",
      };
      onPlanReady(plan, startDate, endDate);
    } finally {
      setGenerating(false);
    }
  }

  const isLoading = generating || loading;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
          <LayoutGrid className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Visual Query Builder</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
          No-code SQL
        </span>
      </div>

      {/* Templates */}
      <div>
        <SectionHeader icon={LayoutGrid} title="Quick Templates" subtitle="Apply a preset to get started" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {PREBUILT_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className={cn(
                "text-left px-3 py-2.5 rounded-lg border text-xs transition-colors",
                state.kpi === t.state.kpi &&
                  JSON.stringify(state.groupBy) === JSON.stringify(t.state.groupBy)
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-muted/40 border-border hover:border-primary/40 hover:bg-muted/60 text-foreground"
              )}
            >
              <p className="font-medium">{t.label}</p>
              <p className="text-muted-foreground mt-0.5">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 1 — KPI */}
      <div>
        <SectionHeader icon={Database} title="1. Select KPI" subtitle="What metric are you measuring?" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {KPI_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKpi(opt.value)}
              className={cn(
                "text-left px-3 py-2.5 rounded-lg border transition-colors",
                state.kpi === opt.value
                  ? "bg-primary/10 border-primary/40"
                  : "bg-muted/40 border-border hover:border-primary/40"
              )}
            >
              <p className={cn("text-xs font-semibold", state.kpi === opt.value ? "text-primary" : "text-foreground")}>
                {opt.label}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {opt.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 — Date range */}
      <div>
        <SectionHeader icon={Filter} title="2. Date Range" subtitle="Filter results by date" />
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Step 3 — Group By */}
      <div>
        <SectionHeader icon={Layers} title="3. Group By" subtitle="Dimensions to break data down by" />
        <div className="flex flex-wrap gap-2">
          {Object.entries(GROUPING_LABELS).map(([value, label]) => {
            const disabled = !allowedGroups.includes(value);
            return (
              <GroupByToggle
                key={value}
                value={value}
                label={label}
                checked={state.groupBy.includes(value)}
                disabled={disabled}
                onChange={toggleGroup}
              />
            );
          })}
        </div>
        {state.groupBy.length === 0 && (
          <p className="text-[11px] text-destructive mt-2">Select at least one grouping dimension.</p>
        )}
      </div>

      {/* Step 4 — Filters */}
      <div>
        <SectionHeader icon={Filter} title="4. Filters" subtitle="Narrow down results with WHERE conditions" />
        <div className="flex flex-col gap-2">
          {state.filters.map((row) => (
            <FilterRowItem
              key={row.id}
              row={row}
              fields={filterFields}
              onChange={(updated) => updateFilter(row.id, updated)}
              onRemove={() => removeFilter(row.id)}
            />
          ))}
          <button
            type="button"
            onClick={addFilter}
            className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 mt-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add filter
          </button>
        </div>
      </div>

      {/* Step 5 — Ordering & Limit */}
      <div>
        <SectionHeader icon={ArrowUpDown} title="5. Sort & Limit" subtitle="Control ordering and row cap" />
        <div className="flex flex-wrap items-end gap-3">
          {/* Order by */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Order by</label>
            <div className="relative">
              <select
                value={state.orderBy}
                onChange={(e) => setState((s) => ({ ...s, orderBy: e.target.value }))}
                className="appearance-none bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-7 min-w-[120px]"
              >
                <option value={state.kpi}>{kpi.label} (metric)</option>
                {state.groupBy.map((g) => (
                  <option key={g} value={GROUPING_LABELS[g]?.toLowerCase().replace(/ /g, "_") ?? g}>
                    {GROUPING_LABELS[g] ?? g}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Direction */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Direction</label>
            <div className="flex gap-1 p-0.5 bg-muted border border-border rounded-md">
              {(["ASC", "DESC"] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, orderDir: dir }))}
                  className={cn(
                    "px-3 py-1 rounded text-xs font-medium transition-colors",
                    state.orderDir === dir
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {dir === "ASC" ? "Low to High" : "High to Low"}
                </button>
              ))}
            </div>
          </div>

          {/* Limit */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Row limit</label>
            <div className="relative">
              <select
                value={state.limit}
                onChange={(e) => setState((s) => ({ ...s, limit: Number(e.target.value) || "" }))}
                className="appearance-none bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-7"
              >
                <option value="">No limit</option>
                {LIMIT_OPTIONS.map((l) => (
                  <option key={l} value={l}>{l.toLocaleString()} rows</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* SQL Preview */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setPreviewOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
        >
          <span className="text-xs font-semibold text-foreground">Generated SQL Preview</span>
          <ChevronDown
            className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", previewOpen && "rotate-180")}
          />
        </button>
        {previewOpen && (
          <pre className="font-mono text-[11px] text-primary/85 bg-muted/20 px-4 py-3 overflow-x-auto whitespace-pre leading-5">
            {previewSQL}
          </pre>
        )}
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={isLoading || state.groupBy.length === 0 || !startDate || !endDate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {isLoading ? "Building query..." : "Build & Run Query"}
        </button>
        <button
          type="button"
          onClick={() =>
            setState({
              kpi: "admissions",
              groupBy: ["branch"],
              filters: [],
              orderBy: "admissions",
              orderDir: "DESC",
              limit: 100,
            })
          }
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-md border border-border hover:border-primary/40"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
}
