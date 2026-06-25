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
} from "lucide-react";

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

export function ResultsTable({ result }: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortConfig | null>(null);

  const insights = useMemo(() => deriveInsights(result), [result]);

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

  function exportCsv() {
    const cols = result.summary.columns;
    const header = cols.join(",");
    const rows = sorted
      .map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.report_name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
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
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {/* Table */}
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
                    return (
                      <td key={col} className="px-4 py-2.5">
                        <span
                          className={`text-sm ${
                            isNum
                              ? "text-foreground tabular-nums font-medium"
                              : "text-foreground"
                          }`}
                        >
                          {isNum
                            ? (val as number) > 999
                              ? (val as number).toLocaleString()
                              : String(val)
                            : val != null
                            ? String(val)
                            : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
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
  );
}
