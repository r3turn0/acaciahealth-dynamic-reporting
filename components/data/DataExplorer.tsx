"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Download, Filter, X, RefreshCw, Database, AlertCircle, Sparkles, Boxes, Check,
  Search, Table2, ShieldCheck, GitBranch, Clock3, Rows3, ArrowRight, Layers3,
} from "lucide-react";
import schemaConfig    from "@/lib/config/schemaConfig.json";
import {
  addTableToDraft,
  useDatasetDraft,
} from "@/lib/access/datasetDraft";
import { SemanticSearchPanel } from "@/components/discover/SemanticSearchPanel";
import { catalogTableMatches, type CatalogNavigationAction } from "@/lib/discovery/navigation";
import { downloadDataset, estimateCSVBytes } from "@/lib/utils/download";
import { logExport } from "@/lib/services/observabilityStore";
import { orchestrate } from "@/lib/orchestration/requestRegistry";

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

interface CatalogTable {
  id: string;
  name: string;
  schema: string;
  domain: string;
  entityType: string;
  columnCount: number;
  description: string;
  tags: string[];
  rowEstimate: number;
  lastSyncAt: string;
  owner: string;
  usageCount: number;
  kpiDependencies: string[];
  upstreamTables: string[];
  downstreamTables: string[];
}

interface CatalogResponse {
  tables: CatalogTable[];
  scope: { tables: number; relationships: number; kpis: number; lastRefresh: string };
}

interface TableListResponse {
  source: string;
  count: number;
  tables: { table_schema: string; table_name: string; qualified_name: string }[];
  error?: string;
}

const catalogFetcher = async (url: string): Promise<CatalogResponse> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Catalog metadata is unavailable");
  return response.json() as Promise<CatalogResponse>;
};

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
      <label htmlFor={`table-filter-${col}`} className="sr-only">Filter {col}</label>
      <input
        id={`table-filter-${col}`}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={col}
        autoComplete="off"
        className="w-full pl-6 pr-5 py-1 text-[11px] bg-muted border border-border rounded focus:outline-none focus:border-primary/60 focus:bg-accent/30 transition-colors placeholder:text-muted-foreground/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Clear ${col} filter`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DataExplorerProps {
  onOpenBuilder?: () => void;
  initialSemanticSearch?: boolean;
  onCatalogNavigate?: (action: Exclude<CatalogNavigationAction, { kind: "table" | "discover-context" }>) => void;
}

export function DataExplorer({
  onOpenBuilder,
  initialSemanticSearch = false,
  onCatalogNavigate,
}: DataExplorerProps) {
  const staged = useDatasetDraft();
  const { data: catalog, error: catalogError } = useSWR("/api/schema/intelligence?mode=explorer", catalogFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    keepPreviousData: true,
  });
  const { data: liveTableResponse, mutate: reloadTableList, isValidating: tableListLoading } = useSWR<TableListResponse>(
    "/api/schema/tables",
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Table metadata is unavailable");
      return response.json() as Promise<TableListResponse>;
    },
    { revalidateOnFocus: false, dedupingInterval: 300_000, keepPreviousData: true },
  );
  const [selectedTable, setSelectedTable] = useState<string>(TABLES[0]);
  const [cachedTableList, setCachedTableList] = useState<string[]>(TABLES as string[]);

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
  const [showFilters, setShowFilters]   = useState(false);
  const [showSemanticSearch, setShowSemanticSearch] = useState(initialSemanticSearch);
  const [catalogSelectionError, setCatalogSelectionError] = useState<string | null>(null);
  const [selectedCatalogContext, setSelectedCatalogContext] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogView, setCatalogView] = useState<"discover" | "analyze">("discover");
  const dataIntentRef = useRef(0);
  const filterKey = JSON.stringify(filters);
  const previousFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (initialSemanticSearch) setShowSemanticSearch(true);
  }, [initialSemanticSearch]);

  const fetchData = useCallback(async (
    table: string,
    pg: number,
    ps: number,
    s: string | null,
    sd: "asc" | "desc",
    f: Record<string, string>
  ) => {
    const intent = ++dataIntentRef.current;
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
      const json = await orchestrate({ scope: "data-explorer", operation: "preview", resource: table, params: { pg, ps, s, sd, f }, policy: "latest", timeoutMs: 30_000 }, async (signal) => {
        const res = await fetch(`/api/data/${encodeURIComponent(table)}?${params}`, { signal });
        if (!res.ok) {
          const text = await res.text();
          let msg = `HTTP ${res.status}`;
          try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* keep HTTP status */ }
          throw new Error(msg);
        }
        return res.json() as Promise<DataPage>;
      });
      if (intent === dataIntentRef.current) setData(json);
    } catch (e) {
      if (e instanceof Error && (e.name === "AbortError" || e.name === "StaleRequestError")) return;
      if (intent === dataIntentRef.current) setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (intent === dataIntentRef.current) setLoading(false);
    }
  }, []);

  // One request pipeline handles paging, sorting, table changes, and filters.
  // Filter edits are debounced; all other changes load immediately.
  useEffect(() => {
    if (catalogView !== "analyze") return;
    const filtersChanged = previousFilterKeyRef.current !== filterKey;
    previousFilterKeyRef.current = filterKey;

    const timer = setTimeout(() => {
      fetchData(selectedTable, page, pageSize, sort, sortDir, filters);
    }, filtersChanged ? 350 : 0);

    return () => clearTimeout(timer);
  // `filterKey` is the stable serialized representation of `filters`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogView, selectedTable, page, pageSize, sort, sortDir, filterKey, fetchData]);

  useEffect(() => {
    try {
      const cached = localStorage.getItem("hchb_table_list");
      if (cached) {
        const names: string[] = JSON.parse(cached);
        if (names.length > 6) setCachedTableList(names);
      }
    } catch { /* Keep the static fallback list. */ }
  }, []);

  const liveTableList = useMemo(() => {
    if (liveTableResponse?.source !== "live_db" || liveTableResponse.tables.length <= 6) return null;
    return liveTableResponse.tables.map((table) => table.qualified_name).sort();
  }, [liveTableResponse]);
  const tableList = liveTableList ?? cachedTableList;
  const tableSource: "live_db" | "static_config" = liveTableList || cachedTableList.length > TABLES.length
    ? "live_db"
    : "static_config";

  useEffect(() => {
    if (!liveTableList) return;
    try { localStorage.setItem("hchb_table_list", JSON.stringify(liveTableList)); } catch { /* noop */ }
  }, [liveTableList]);

  function normalizedTableName(table: string) {
    return table.replace(/^\[|\]$/g, "").replace(/\]\./g, ".").toLowerCase();
  }

  const metadataByTable = useMemo(() => {
    const byIdentifier = new Map<string, CatalogTable>();
    const shortNameCounts = new Map<string, number>();
    for (const asset of catalog?.tables ?? []) {
      const id = normalizedTableName(asset.id);
      const shortName = id.split(".").at(-1) ?? id;
      byIdentifier.set(id, asset);
      shortNameCounts.set(shortName, (shortNameCounts.get(shortName) ?? 0) + 1);
    }
    for (const asset of catalog?.tables ?? []) {
      const id = normalizedTableName(asset.id);
      const shortName = id.split(".").at(-1) ?? id;
      if (shortNameCounts.get(shortName) === 1) byIdentifier.set(shortName, asset);
    }
    return byIdentifier;
  }, [catalog]);

  const metadataFor = useCallback((table: string) => metadataByTable.get(normalizedTableName(table)), [metadataByTable]);
  const filteredCatalogTables = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return tableList;
    return tableList.filter((table) => {
      const metadata = metadataFor(table);
      return [table, metadata?.name, metadata?.domain, metadata?.owner, metadata?.description, ...(metadata?.tags ?? []), ...(metadata?.kpiDependencies ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [catalogQuery, metadataFor, tableList]);
  const featuredTables = useMemo(() => [...filteredCatalogTables]
    .sort((a, b) => (metadataFor(b)?.usageCount ?? 0) - (metadataFor(a)?.usageCount ?? 0))
    .slice(0, 6), [filteredCatalogTables, metadataFor]);
  const selectedMetadata = metadataFor(selectedTable);
  const selectedDomain = selectedMetadata?.domain ?? (selectedTable.includes(".") ? selectedTable.split(".")[0] : "Enterprise");
  const relatedTables = useMemo(() => [...(selectedMetadata?.upstreamTables ?? []), ...(selectedMetadata?.downstreamTables ?? [])]
    .map((related) => tableList.find((table) => catalogTableMatches(table, related)))
    .filter((table): table is string => Boolean(table))
    .slice(0, 6), [selectedMetadata, tableList]);
  const catalogCoverage = useMemo(() => catalog
    ? `${Math.round((tableList.filter((table) => metadataFor(table)).length / Math.max(tableList.length, 1)) * 100)}%`
    : "—", [catalog, metadataFor, tableList]);

  function tableLabel(table: string) {
    return table.split(".").at(-1)?.replace(/_/g, " ") ?? table;
  }

  function formatCompactNumber(value: number) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }

  function openTable(t: string) {
    handleTableChange(t);
    setCatalogView("analyze");
  }

  function handleTableChange(t: string) {
    setSelectedTable(t);
    setPage(1);
    setSort(null);
    setSortDir("asc");
    setFilters({});
    setShowFilters(false);
  }

  function handleCatalogSelection(action: CatalogNavigationAction) {
    setCatalogSelectionError(null);
    if (action.kind === "table") {
      const resolvedTable = tableList.find((table) =>
        catalogTableMatches(table, action.tableLocation)
      );
      if (!resolvedTable) {
        setCatalogSelectionError(`Could not resolve ${action.assetName} to an available table (${action.tableLocation}).`);
        return;
      }
      handleTableChange(resolvedTable);
      setSelectedCatalogContext(action.assetName);
      setShowSemanticSearch(false);
      return;
    }
    if (action.kind === "discover-context") {
      setSelectedCatalogContext(action.assetName);
      setShowSemanticSearch(false);
      return;
    }
    onCatalogNavigate?.(action);
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
    setPage(1);
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
    const t0 = performance.now();
    try {
      downloadDataset(data.rows as Record<string, unknown>[], `${selectedTable}_page${data.page}`, "csv");
      const dur = Math.round(performance.now() - t0);
      logExport({
        format:        "csv",
        rowCount:      data.rows.length,
        columnCount:   data.columns.length,
        fileSizeBytes: estimateCSVBytes(data.rows.length, data.columns.length),
        reportName:    selectedTable,
        durationMs:    dur,
        success:       true,
      });
    } catch (e) {
      logExport({
        format:        "csv",
        rowCount:      data.rows.length,
        columnCount:   data.columns.length,
        fileSizeBytes: 0,
        reportName:    selectedTable,
        success:       false,
        error:         e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const columns = data?.columns ?? [];
  const isStaged = staged.some((t) => t.toLowerCase() === selectedTable.toLowerCase());

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-5 border-b border-border bg-muted/20 p-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <Layers3 className="size-4" />
              Governed data catalog
            </div>
            <div>
              <h1 className="font-sans text-2xl font-semibold tracking-tight text-foreground text-balance">Discover trusted data, then analyze the detail</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">Find operational tables by domain or meaning. Every preview remains read-only and preserves source context for dataset design.</p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1" aria-label="Discovery workflow">
            <button type="button" onClick={() => setCatalogView("discover")} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", catalogView === "discover" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Discover</button>
            <button type="button" onClick={() => setCatalogView("analyze")} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", catalogView === "analyze" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Analyze</button>
          </div>
        </div>

        {catalogView === "discover" && (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex max-w-2xl flex-col gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <label htmlFor="catalog-search" className="sr-only">Search the data catalog</label>
                <input id="catalog-search" type="search" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search tables, domains, owners, KPIs, or business concepts" className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary" />
              </div>
              {catalogError && <p role="status" className="text-xs text-muted-foreground">Governance metadata is temporarily unavailable. Physical table discovery remains available.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Available tables", value: tableList.length, icon: Table2 },
                { label: "Governed KPIs", value: catalog?.scope.kpis ?? "—", icon: ShieldCheck },
                { label: "Relationships", value: catalog?.scope.relationships ?? "—", icon: GitBranch },
                { label: "Catalog coverage", value: catalogCoverage, icon: Database },
              ].map((metric) => (
                <div key={metric.label} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><metric.icon className="size-4" /></div>
                  <div className="min-w-0"><p className="truncate text-[11px] text-muted-foreground">{metric.label}</p><p className="text-sm font-semibold text-foreground tabular-nums">{metric.value}</p></div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">Featured datasets</h2><p className="text-xs text-muted-foreground">Start with a governed source, then inspect rows and columns.</p></div><button type="button" onClick={() => setShowSemanticSearch(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary"><Sparkles className="size-3.5" />Semantic search</button></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {featuredTables.map((table, index) => {
                  const metadata = metadataFor(table);
                  const relationshipCount = (metadata?.upstreamTables.length ?? 0) + (metadata?.downstreamTables.length ?? 0);
                  return (
                    <article key={table} className="group flex min-h-48 flex-col justify-between gap-4 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40">
                      <div className="flex items-start justify-between gap-3"><div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground"><Rows3 className="size-4" /></div><span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{index < 2 ? "Featured" : metadata?.domain ?? "Catalog"}</span></div>
                      <div><h3 className="text-sm font-semibold capitalize text-foreground text-balance">{tableLabel(table)}</h3><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{metadata?.description ?? "Operational source available for governed preview, filtering, export, and dataset composition."}</p></div>
                      <dl className="grid grid-cols-3 gap-2 text-[10px]"><div><dt className="text-muted-foreground">Rows est.</dt><dd className="font-medium text-foreground">{metadata ? formatCompactNumber(metadata.rowEstimate) : "—"}</dd></div><div><dt className="text-muted-foreground">Columns</dt><dd className="font-medium text-foreground">{metadata?.columnCount ?? "—"}</dd></div><div><dt className="text-muted-foreground">Relations</dt><dd className="font-medium text-foreground">{metadata ? relationshipCount : "—"}</dd></div></dl>
                      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><code className="block truncate text-[10px] text-muted-foreground">{table}</code><span className="block truncate text-[10px] text-muted-foreground">{metadata ? `Owner: ${metadata.owner}` : "Metadata not cataloged"}</span></div><button type="button" onClick={() => openTable(table)} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">Explore <ArrowRight className="size-3.5" /></button></div>
                    </article>
                  );
                })}
              </div>
              {featuredTables.length === 0 && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No catalog assets match your search.</p>}
            </div>
          </div>
        )}
      </section>

      {catalogView === "analyze" && (
      <>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Table2 className="size-4" /></div><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Analyzing</p><h2 className="truncate text-sm font-semibold capitalize text-foreground">{tableLabel(selectedTable)}</h2><code className="block truncate text-[10px] text-muted-foreground">{selectedTable}</code><p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{selectedMetadata?.description ?? "This source is available for a governed, read-only data preview."}</p></div></div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><GitBranch className="size-3.5" />{selectedDomain}</span><span className="flex items-center gap-1"><Clock3 className="size-3.5" />On demand</span><span className="flex items-center gap-1"><ShieldCheck className="size-3.5" />Read only</span></div>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4"><div><dt className="text-[10px] text-muted-foreground">Preview rows</dt><dd className="text-sm font-semibold text-foreground tabular-nums">{data?.total.toLocaleString() ?? "—"}</dd></div><div><dt className="text-[10px] text-muted-foreground">Catalog estimate</dt><dd className="text-sm font-semibold text-foreground tabular-nums">{selectedMetadata ? formatCompactNumber(selectedMetadata.rowEstimate) : "—"}</dd></div><div><dt className="text-[10px] text-muted-foreground">Columns</dt><dd className="text-sm font-semibold text-foreground tabular-nums">{selectedMetadata?.columnCount ?? data?.columns.length ?? "—"}</dd></div><div><dt className="text-[10px] text-muted-foreground">Owner</dt><dd className="truncate text-sm font-semibold text-foreground">{selectedMetadata?.owner ?? "Not cataloged"}</dd></div></dl>
        {relatedTables.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Related tables</span>{relatedTables.map((table) => <button key={table} type="button" onClick={() => openTable(table)} className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-foreground transition-colors hover:border-primary/40">{tableLabel(table)}</button>)}</div>}
      </div>
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
            <ShieldCheck className="size-2.5" />
            Read-only
          </span>
          <button
            onClick={() => void reloadTableList()}
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
            onClick={() => setShowSemanticSearch((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors",
              showSemanticSearch
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
            title="Semantic search — find tables by meaning, not just name"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Search
          </button>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-controls="table-column-filters"
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
              type="button"
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchData(selectedTable, page, pageSize, sort, sortDir, filters)}
            disabled={loading}
            aria-label="Refresh table data"
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

      {/* Semantic Search Panel */}
      {showSemanticSearch && (
        <div className="bg-muted/20 border border-border rounded-xl p-4">
          <SemanticSearchPanel onSelectResult={handleCatalogSelection} />
        </div>
      )}

      {catalogSelectionError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {catalogSelectionError}
        </div>
      )}
      {selectedCatalogContext && !catalogSelectionError && (
        <p className="text-xs text-muted-foreground">
          Discovery context: <span className="font-medium text-foreground">{selectedCatalogContext}</span>
        </p>
      )}

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
          <div
            id="table-column-filters"
            aria-label="Column filters"
            className="px-4 py-3 border-b border-border bg-muted/30 grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0,1fr))` }}
          >
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
      </>
      )}
    </div>
  );
}
