"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
  Download,
  Database,
  Filter,
  AlertCircle,
  Boxes,
  Check,
  Lock,
} from "lucide-react";
import schemaConfig from "@/lib/config/schemaConfig.json";
import {
  addTableToDraft,
  useDatasetDraft,
} from "@/lib/access/datasetDraft";

// Try to load the seeded full table list; fall back to schemaConfig keys.
let allTablesJson: string[] = [];
try {
  // Dynamic require so a missing file doesn't break the build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  allTablesJson = require("@/lib/config/allTables.json") as string[];
} catch {
  allTablesJson = [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TableRow  { [key: string]: unknown }
interface DataPage {
  table:      string;
  columns:    string[];
  rows:       TableRow[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
  source:     "demo" | "live_db";
}

const TABLES: string[] =
  allTablesJson.length > 0
    ? allTablesJson
    : (Object.keys(schemaConfig) as string[]);
const PAGE_SIZES = [25, 50, 100, 200];

// ── Cell renderer ─────────────────────────────────────────────────────────────

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/40 italic text-xs">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium",
        value ? "bg-chart-3/15 text-chart-3" : "bg-muted text-muted-foreground"
      )}>
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono text-xs text-foreground tabular-nums">{value.toLocaleString()}</span>;
  }
  const str = String(value);
  // Status badge
  if (["Active", "Discharged", "Billed", "Paid", "Pending", "Denied"].includes(str)) {
    const colors: Record<string, string> = {
      Active:    "bg-chart-3/15 text-chart-3",
      Billed:    "bg-chart-3/15 text-chart-3",
      Paid:      "bg-chart-3/15 text-chart-3",
      Discharged:"bg-muted text-muted-foreground",
      Pending:   "bg-chart-5/15 text-chart-5",
      Denied:    "bg-destructive/15 text-destructive",
    };
    return (
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", colors[str] ?? "bg-muted text-muted-foreground")}>
        {str}
      </span>
    );
  }
  return <span className="text-xs text-foreground">{str}</span>;
}

// ── Column filter input ───────────────────────────────────────────────────────

function ColumnFilter({ col, value, onChange }: {
  col:      string;
  value:    string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={col}
        className="w-full pl-6 pr-5 py-1 text-[11px] bg-muted border border-border rounded focus:outline-none focus:border-primary/60 focus:bg-accent/30 transition-colors placeholder:text-muted-foreground/50"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataExplorer({ onOpenBuilder }: { onOpenBuilder?: () => void }) {
  const staged = useDatasetDraft();
  const [selectedTable, setSelectedTable] = useState<string>(TABLES[0]);
  // Full list of tables in the database — populated from /api/schema (live or
  // static). Falls back to the statically-known schemaConfig tables.
  const [tableList, setTableList] = useState<string[]>(TABLES as string[]);
  const [tableSource, setTableSource] = useState<"live_db" | "static_config">("static_config");
  const [tableListLoading, setTableListLoading] = useState(false);

  function handleAddToDataset() {
    addTableToDraft(selectedTable);
    onOpenBuilder?.();
  }
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort]         = useState<string | null>(null);
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");
  const [filters, setFilters]   = useState<Record<string, string>>({});
  const [data, setData]         = useState<DataPage | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (
    table: string,
    pg: number,
    ps: number,
    s: string | null,
    sd: "asc" | "desc",
    f: Record<string, string>
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page:     String(pg),
        pageSize: String(ps),
        ...(s ? { sort: s, dir: sd } : {}),
        ...(Object.keys(f).some((k) => f[k])
          ? { filters: JSON.stringify(f) }
          : {}),
      });
      const res  = await fetch(`/api/data/${encodeURIComponent(table)}?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Immediate fetch on table / page / pageSize / sort change
  useEffect(() => {
    fetchData(selectedTable, page, pageSize, sort, sortDir, filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, page, pageSize, sort, sortDir]);

  // Debounced fetch on filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchData(selectedTable, 1, pageSize, sort, sortDir, filters);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Load the complete table list by querying sys.objects via the existing
  // /api/run-sql endpoint — requires no new route file on the user's machine.
  const loadTableList = useCallback(async () => {
    setTableListLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch("/api/run-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql: `SELECT s.name AS table_schema, o.name AS table_name,
                  CASE o.type WHEN 'U' THEN 'BASE TABLE' WHEN 'V' THEN 'VIEW' ELSE 'OTHER' END AS table_type
                FROM sys.objects o
                JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
                ORDER BY o.type DESC, o.name`,
          start_date: today,
          end_date: today,
          report_name: "__table_list__",
        }),
      });
      if (!res.ok) return;
      const json = await res.json() as { data?: Record<string, string>[] };
      const rows = (json.data ?? []) as { table_schema: string; table_name: string }[];
      if (rows.length > 6) {
        const names = rows.map((r) =>
          !r.table_schema || r.table_schema === "dbo"
            ? r.table_name
            : `${r.table_schema}.${r.table_name}`
        ).sort();
        setTableList(names);
        setTableSource("live_db");
        try { localStorage.setItem("hchb_table_list", JSON.stringify(names)); } catch { /* noop */ }
      }
    } catch {
      // Keep the static fallback list.
    } finally {
      setTableListLoading(false);
    }
  }, []);

  useEffect(() => {
    // Seed immediately from localStorage (previous session) so dropdown is
    // populated before the async fetch returns.
    try {
      const cached = localStorage.getItem("hchb_table_list");
      if (cached) {
        const names: string[] = JSON.parse(cached);
        if (names.length > 6) {
          setTableList(names);
          setTableSource("live_db");
        }
      }
    } catch { /* noop */ }
    // Always re-fetch fresh from the server
    loadTableList();
  }, [loadTableList]);

  function handleTableChange(t: string) {
    setSelectedTable(t);
    setPage(1);
    setSort(null);
    setSortDir("asc");
    setFilters({});
    setShowFilters(false);
  }

  function handleSort(col: string) {
    if (sort === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  function handleFilterChange(col: string, val: string) {
    setFilters((prev) => ({ ...prev, [col]: val }));
  }

  function clearAllFilters() {
    setFilters({});
    setSort(null);
    setSortDir("asc");
    setPage(1);
  }

  function exportCSV() {
    if (!data) return;
    const header = data.columns.join(",");
    const rows   = data.rows.map((r) =>
      data.columns.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    );
    const csv   = [header, ...rows].join("\n");
    const blob  = new Blob([csv], { type: "text/csv" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = `${selectedTable}_page${data.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const columns = data?.columns ?? [];
  const isStaged = staged.some((t) => t.toLowerCase() === selectedTable.toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Table picker — dropdown of all tables in the database */}
        <div className="flex items-center gap-2 flex-wrap">
          <Database className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="relative">
            <select
              value={selectedTable}
              onChange={(e) => handleTableChange(e.target.value)}
              aria-label="Select a table to preview"
              className="appearance-none min-w-[220px] bg-muted border border-border rounded-md pl-3 pr-8 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
            >
              {tableList.map((t) => {
                const tableStaged = staged.some((s) => s.toLowerCase() === t.toLowerCase());
                return (
                  <option key={t} value={t}>
                    {tableStaged ? "✓ " : ""}{t}
                  </option>
                );
              })}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {tableList.length} table{tableList.length !== 1 ? "s" : ""}
          </span>
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium border",
              tableSource === "live_db"
                ? "bg-chart-3/10 text-chart-3 border-chart-3/25"
                : "bg-muted text-muted-foreground border-border"
            )}
            title={tableSource === "live_db" ? "Tables loaded from live database" : "Using static config — click refresh to load from database"}
          >
            <Database className="w-2.5 h-2.5" />
            {tableSource === "live_db" ? "Live DB" : "Static"}
          </span>
          <span
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground border border-border"
            title="Tables are read-only in Discover Data"
          >
            <Lock className="w-2.5 h-2.5" />
            Read-only
          </span>
          <button
            onClick={() => loadTableList()}
            disabled={tableListLoading}
            title="Reload full table list from database"
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3 h-3", tableListLoading && "animate-spin")} />
            {tableListLoading ? "Loading…" : "Reload tables"}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:ml-auto shrink-0">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors",
              showFilters
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {(activeFilterCount > 0 || sort) && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
          <button
            onClick={() => fetchData(selectedTable, page, pageSize, sort, sortDir, filters)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={exportCSV}
            disabled={!data || loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={handleAddToDataset}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            {isStaged ? <Check className="w-3.5 h-3.5" /> : <Boxes className="w-3.5 h-3.5" />}
            {isStaged ? "In Dataset — Open Builder" : "Add to Dataset"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {data.total.toLocaleString()}
            </span>{" "}
            {data.total === 1 ? "row" : "rows"}
          </span>
          <span>
            {data.columns.length} columns
          </span>
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium",
            data.source === "live_db"
              ? "bg-chart-3/15 text-chart-3"
              : "bg-chart-5/15 text-chart-5"
          )}>
            {data.source === "live_db" ? "Live DB" : "Demo"}
          </span>
          {activeFilterCount > 0 && (
            <span className="text-primary">
              {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} applied
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Column filters strip */}
        {showFilters && columns.length > 0 && (
          <div className="px-4 py-3 border-b border-border bg-muted/30 grid gap-2"
               style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0,1fr))` }}>
            {columns.map((col) => (
              <ColumnFilter
                key={col}
                col={col}
                value={filters[col] ?? ""}
                onChange={(val) => handleFilterChange(col, val)}
              />
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-foreground select-none"
                    onClick={() => handleSort(col)}
                  >
                    <div className="flex items-center gap-1">
                      {col}
                      {sort === col ? (
                        sortDir === "asc"
                          ? <ChevronUp   className="w-3 h-3 text-primary" />
                          : <ChevronDown className="w-3 h-3 text-primary" />
                      ) : (
                        <ChevronsUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-50" />
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No rows match the current filters.
                  </td>
                </tr>
              )}
              {data?.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={cn(
                    "border-b border-border/50 last:border-0 transition-colors hover:bg-muted/20",
                    loading && "opacity-40"
                  )}
                >
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-2 whitespace-nowrap">
                      <CellValue value={row[col]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary/60"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>
                {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, data.total)} of {data.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-0.5 ml-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1 || loading}
                  className="p-1 rounded hover:bg-accent/50 disabled:opacity-30 transition-colors"
                  aria-label="First page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="p-1 rounded hover:bg-accent/50 disabled:opacity-30 transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-medium text-foreground">
                  {page} / {data.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages || loading}
                  className="p-1 rounded hover:bg-accent/50 disabled:opacity-30 transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage(data.totalPages)}
                  disabled={page === data.totalPages || loading}
                  className="p-1 rounded hover:bg-accent/50 disabled:opacity-30 transition-colors"
                  aria-label="Last page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
