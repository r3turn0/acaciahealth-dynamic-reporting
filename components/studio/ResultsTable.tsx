"use client";

import { useState, useMemo } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart2,
  TableIcon,
  FileSpreadsheet,
  X,
  Maximize2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

export interface ReportResult {
  report_name: string;
  generated_at: string;
  kpi: string;
  sql_used: string;
  data: Record<string, unknown>[];
  summary: {
    row_count: number;
    columns: string[];
    aggregates?: Record<string, number>;
  };
  cache_hit?: boolean;
  demo_mode?: boolean;
  execution_ms?: number;
}

interface KpiInsight {
  label: string;
  value: number;
  change_pct: number | null;
  unit: string;
}

function deriveInsights(result: ReportResult): KpiInsight[] {
  const { data, summary } = result;
  if (!data.length) return [];

  const insights: KpiInsight[] = [];
  const numCols = summary.columns.filter(
    (c) => typeof data[0]?.[c] === "number"
  );

  for (const col of numCols.slice(0, 3)) {
    const values = data.map((r) => Number(r[col]) || 0);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = total / values.length;

    // Crude MoM comparison — split data in half
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, half).reduce((a, b) => a + b, 0);
    const secondHalf = values.slice(half).reduce((a, b) => a + b, 0);
    const changePct =
      firstHalf !== 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : null;

    insights.push({
      label: col.replace(/_/g, " "),
      value: total > 999 ? Math.round(total) : Math.round(avg * 10) / 10,
      change_pct: changePct !== null ? Math.round(changePct * 10) / 10 : null,
      unit: col.includes("revenue") || col.includes("amount") ? "$" : "",
    });
  }

  return insights;
}

const PAGE_SIZES = [25, 50, 100];

interface SortConfig {
  col: string;
  dir: "asc" | "desc";
}

interface ResultsTableProps {
  result: ReportResult;
}

// ── Chart helpers ────────────────────────────────────────────────────────────

function deriveChartData(result: ReportResult): { labelKey: string; valueKey: string; data: Record<string, unknown>[] } | null {
  const { data, summary } = result;
  if (!data.length) return null;

  const labelKey = summary.columns.find((c) => typeof data[0]?.[c] === "string");
  const valueKey = summary.columns.find((c) => typeof data[0]?.[c] === "number");
  if (!labelKey || !valueKey) return null;

  // Aggregate by label (take top 20 to keep chart readable)
  const agg: Record<string, number> = {};
  for (const row of data) {
    const k = String(row[labelKey] ?? "Other");
    agg[k] = (agg[k] ?? 0) + (Number(row[valueKey]) || 0);
  }

  const chartData = Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([label, value]) => ({ label, value }));

  return { labelKey, valueKey, data: chartData };
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// ── Main component ────────────────────────────────────────────────────────────

export function ResultsTable({ result }: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortConfig | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "chart">("table");
  // Expanded cell modal: { col, rowIndex, value }
  const [expandedCell, setExpandedCell] = useState<{ col: string; value: string } | null>(null);

  // Columns that are likely to contain long narrative text
  const summaryCols: string[] =
    result.summary?.columns ??
    (result.data[0] ? Object.keys(result.data[0]) : []);
  const narrativeCols = useMemo(
    () =>
      new Set(
        summaryCols.filter((c) =>
          /narrative|assessment|note|comment|description|text|reason/i.test(c)
        )
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryCols.join(",")]
  );

  const TRUNCATE_LENGTH = 120;

  const insights = useMemo(() => deriveInsights(result), [result]);
  const chartData = useMemo(() => deriveChartData(result), [result]);

  const sorted = useMemo(() => {
    if (!sort) return result.data;
    return [...result.data].sort((a, b) => {
      const av = a[sort.col];
      const bv = b[sort.col];
      if (typeof av === "number" && typeof bv === "number") {
        return sort.dir === "asc" ? av - bv : bv - av;
      }
      return sort.dir === "asc"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });
  }, [result.data, sort]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(col: string) {
    setSort((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col, dir: "asc" }
    );
    setPage(0);
  }

  // ── Export helpers ────────────────────────────────────────────────────────

  /**
   * RFC 4180-compliant CSV cell escape.
   * - Wraps every value in double-quotes.
   * - Escapes embedded double-quotes as "".
   * - Replaces embedded newlines with a single space so each data row stays on
   *   exactly one CSV line. This is what was causing Excel to explode multi-line
   *   narrative fields (cevn_Assessment, cevn_VisitNarrative) across hundreds of
   *   rows.
   */
  function csvCell(value: unknown): string {
    const str = String(value ?? "")
      .replace(/\r\n/g, " ")   // CRLF → space
      .replace(/\r/g, " ")     // CR   → space
      .replace(/\n/g, " ")     // LF   → space
      .replace(/"/g, '""');    // escape embedded quotes
    return `"${str}"`;
  }

  function exportCsv() {
    const cols = result.summary.columns;
    const header = cols.map(csvCell).join(",");
    const rows = sorted
      .map((r) => cols.map((c) => csvCell(r[c])).join(","))
      .join("\r\n");
    const blob = new Blob(["\uFEFF" + header + "\r\n" + rows], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.report_name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Excel (XLSX) export via SheetJS.
   * Long text fields (Assessment, VisitNarrative, etc.) get wrap-text formatting
   * so each row stays as one row and the content is readable inside the cell.
   */
  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const cols = result.summary.columns;

    // Build plain array-of-arrays so SheetJS preserves newlines inside cells
    const aoaData: unknown[][] = [
      cols, // header row
      ...sorted.map((r) => cols.map((c) => r[c] ?? "")),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Apply wrap-text to every cell so multi-line narratives don't break layout
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) continue;
        ws[addr].s = { alignment: { wrapText: true, vertical: "top" } };
      }
    }

    // Set column widths: narrow for IDs, wider for narrative fields
    ws["!cols"] = cols.map((c) => {
      const isNarrative = /narrative|assessment|note|comment/i.test(c);
      const isName = /name|firstname|lastname/i.test(c);
      return { wch: isNarrative ? 60 : isName ? 20 : 14 };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${result.report_name.replace(/\s+/g, "_")}.xlsx`);
  }

  return (
    <>
    <div className="flex flex-col gap-4">
      {/* KPI Insights */}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {insights.map((ins) => (
            <div
              key={ins.label}
              className="bg-card border border-border rounded-lg px-4 py-3"
            >
              <p className="text-[11px] text-muted-foreground capitalize font-medium mb-1">
                {ins.label}
              </p>
              <div className="flex items-end gap-2">
                <span className="text-lg font-semibold text-foreground tabular-nums">
                  {ins.unit === "$"
                    ? `$${ins.value.toLocaleString()}`
                    : ins.value.toLocaleString()}
                </span>
                {ins.change_pct !== null && (
                  <div
                    className={`flex items-center gap-0.5 text-[11px] font-medium pb-0.5 ${
                      ins.change_pct > 0
                        ? "text-chart-3"
                        : ins.change_pct < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {ins.change_pct > 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : ins.change_pct < 0 ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {Math.abs(ins.change_pct)}%
                  </div>
                )}
              </div>
              {ins.change_pct !== null && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {ins.change_pct > 0 ? "increased" : ins.change_pct < 0 ? "decreased" : "unchanged"}{" "}
                  period-over-period
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Table card */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Table header bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{result.report_name}</span>
            <span className="text-xs text-muted-foreground">
              {result.summary.row_count.toLocaleString()} rows
            </span>
            {result.demo_mode && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-chart-5/15 text-chart-5 border border-chart-5/25">
                Demo Data
              </span>
            )}
            {result.cache_hit && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                Cached
              </span>
            )}
            {result.execution_ms && (
              <span className="text-[11px] text-muted-foreground">{result.execution_ms}ms</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            {chartData && (
              <div className="flex gap-0.5 p-0.5 bg-muted border border-border rounded-md">
                <button
                  onClick={() => setViewMode("table")}
                  title="Table view"
                  className={`p-1.5 rounded transition-colors ${viewMode === "table" ? "bg-card text-foreground border border-border shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <TableIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("chart")}
                  title="Chart view"
                  className={`p-1.5 rounded transition-colors ${viewMode === "chart" ? "bg-card text-foreground border border-border shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {viewMode === "table" && (
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} / page
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={exportCsv}
              title="Export as CSV (newlines in narrative fields are collapsed to spaces)"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={exportXlsx}
              title="Export as Excel — narrative fields render as wrapped cells"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              XLSX
            </button>
          </div>
        </div>

        {/* Chart view */}
        {viewMode === "chart" && chartData && (
          <div className="p-4">
            <ChartContainer
              config={{
                value: { label: chartData.valueKey.replace(/_/g, " "), color: "var(--chart-1)" },
              }}
              className="h-64 w-full"
            >
              <BarChart data={chartData.data} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {chartData.data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Top {chartData.data.length} results by {chartData.valueKey.replace(/_/g, " ")}
            </p>
          </div>
        )}

        {/* Table */}
        {viewMode === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {result.summary.columns.map((col) => {
                  const isActive = sort?.col === col;
                  return (
                    <th
                      key={col}
                      onClick={() => toggleSort(col)}
                      className="px-4 py-2.5 text-left cursor-pointer select-none hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {col.replace(/_/g, " ")}
                        </span>
                        {isActive ? (
                          sort?.dir === "asc" ? (
                            <ChevronUp className="w-3 h-3 text-primary" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-primary" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageData.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  {result.summary.columns.map((col) => {
                    const val = row[col];
                    const isNum = typeof val === "number";
                    const strVal = val != null ? String(val) : "";
                    const isLong = narrativeCols.has(col) || strVal.length > TRUNCATE_LENGTH;
                    const truncated = isLong
                      ? strVal.replace(/[\r\n]+/g, " ").slice(0, TRUNCATE_LENGTH) + "…"
                      : strVal;

                    return (
                      <td key={col} className="px-4 py-2.5 max-w-xs">
                        {isNum ? (
                          <span className="text-sm text-foreground tabular-nums font-medium">
                            {(val as number) > 999
                              ? (val as number).toLocaleString()
                              : String(val)}
                          </span>
                        ) : isLong ? (
                          <div className="flex items-start gap-2">
                            <span className="text-sm text-foreground leading-snug line-clamp-2 flex-1">
                              {truncated}
                            </span>
                            <button
                              onClick={() =>
                                setExpandedCell({ col, value: strVal })
                              }
                              title="View full text"
                              className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-sm text-foreground">
                            {strVal || "—"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        )}

        {/* Pagination */}
        {viewMode === "table" && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 text-xs rounded border border-border hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-foreground"
              >
                Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      p === page
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:border-primary/40 text-foreground"
                    }`}
                  >
                    {p + 1}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="px-2.5 py-1 text-xs rounded border border-border hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-foreground"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

      {/* Expanded narrative cell modal */}
      {expandedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExpandedCell(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
              <span className="text-sm font-semibold text-foreground">
                {expandedCell.col.replace(/_/g, " ")}
              </span>
              <button
                onClick={() => setExpandedCell(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Modal body — scrollable */}
            <div className="overflow-y-auto flex-1 px-5 py-4">
              <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {expandedCell.value}
              </pre>
            </div>
            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
              <span className="text-xs text-muted-foreground mr-auto">
                {expandedCell.value.length.toLocaleString()} characters
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(expandedCell.value).catch(() => {});
                }}
                className="text-xs px-3 py-1.5 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
              >
                Copy
              </button>
              <button
                onClick={() => setExpandedCell(null)}
                className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
