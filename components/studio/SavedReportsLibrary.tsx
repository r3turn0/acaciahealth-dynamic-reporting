"use client";

/**
 * SavedReportsLibrary
 *
 * Full-page Saved Reports Library with:
 *  - Table view (default) + Card/grid view toggle
 *  - Search, filter by KPI / tag / status / visibility
 *  - Sort by name, date created, last run, run count
 *  - Per-report actions: Run, Download (CSV/JSON), Pin/Unpin, Edit, Delete
 *  - Summary stats bar at the top
 *  - Inline version badges
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Bookmark,
  Play,
  Trash2,
  Clock,
  Tag,
  Loader2,
  RefreshCw,
  Search,
  X,
  SlidersHorizontal,
  Pin,
  PinOff,
  Download,
  ChevronDown,
  LayoutList,
  LayoutGrid,
  BarChart2,
  FileText,
  Rows3,
  Database,
  TrendingUp,
  Pencil,
  History,
  MoreHorizontal,
  FilePlus2,
} from "lucide-react";
import {
  useDashboardPins,
  isPinned as isItemPinned,
  pinItem,
  unpinByRef,
} from "@/lib/hooks/useDashboardPins";
import { downloadDataset, type DownloadFormat } from "@/lib/utils/download";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LibraryReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
  visibility?: "private" | "team" | "public";
  status?: "draft" | "published" | "archived";
  created_by: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
  version?: number;
  version_history?: { version: number; saved_at: string; saved_by: string; note: string }[];
}

interface SavedReportsLibraryProps {
  onRun: (report: LibraryReport) => void;
  onNavigateCreate?: () => void;
}

type SortKey = "created_date" | "last_run_date" | "run_count" | "name";
type ViewMode = "table" | "grid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
}

function kpiChipClass(kpi: string): string {
  const map: Record<string, string> = {
    admissions: "bg-chart-1/10 text-chart-1 border-chart-1/20",
    revenue:    "bg-chart-2/10 text-chart-2 border-chart-2/20",
    census:     "bg-chart-3/10 text-chart-3 border-chart-3/20",
    custom:     "bg-muted text-muted-foreground border-border",
  };
  return map[kpi] ?? "bg-primary/10 text-primary border-primary/20";
}

// ── Download dropdown ─────────────────────────────────────────────────────────

function DownloadDropdown({ report }: { report: LibraryReport }) {
  const [open, setOpen] = useState(false);

  function dl(fmt: DownloadFormat) {
    const stub: Record<string, unknown>[] = [{
      report_id: report.id,
      name: report.name,
      kpi: report.kpi,
      sql: report.sql,
      tags: report.tags.join(","),
      created_date: report.created_date,
      run_count: report.run_count,
      last_row_count: report.last_row_count,
    }];
    downloadDataset(stub, report.name + "_definition", fmt);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-muted transition-colors"
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[130px]">
            <button onClick={() => dl("csv")} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2">
              <FileText className="w-3 h-3 text-muted-foreground" /> CSV
            </button>
            <button onClick={() => dl("json")} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2">
              <FileText className="w-3 h-3 text-muted-foreground" /> JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Row actions menu ──────────────────────────────────────────────────────────

function RowMenu({
  report,
  onDelete,
  deleting,
}: {
  report: LibraryReport;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
            <button
              onClick={() => { onDelete(); setOpen(false); }}
              disabled={deleting}
              className="w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10 flex items-center gap-2"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({
  reports,
  onRun,
  onTogglePin,
  onDelete,
  deletingId,
}: {
  reports: LibraryReport[];
  onRun: (r: LibraryReport) => void;
  onTogglePin: (r: LibraryReport) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-[35%]">Report</th>
            <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">KPI</th>
            <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Last Run</th>
            <th className="text-right px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Runs</th>
            <th className="text-right px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Rows</th>
            <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r, i) => {
            const pinned = isItemPinned("report", r.id);
            return (
              <tr
                key={r.id}
                className={`border-b border-border/50 hover:bg-accent/20 transition-colors group ${i === reports.length - 1 ? "border-b-0" : ""}`}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate max-w-[200px]">{r.name}</span>
                      {r.version && r.version > 1 && (
                        <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border shrink-0">v{r.version}</span>
                      )}
                      {r.status === "draft" && (
                        <span className="text-[9px] px-1 py-0 rounded bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 shrink-0">draft</span>
                      )}
                    </div>
                    {r.description && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">{r.description}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${kpiChipClass(r.kpi)}`}>
                    {r.kpi}
                  </span>
                </td>
                <td className="px-3 py-3 text-muted-foreground hidden md:table-cell">
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatRelative(r.last_run_date)}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground hidden lg:table-cell">{r.run_count}</td>
                <td className="px-3 py-3 text-right text-muted-foreground hidden lg:table-cell">
                  {r.last_row_count !== null ? r.last_row_count.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onTogglePin(r)}
                      className={`p-1.5 rounded transition-colors ${
                        pinned ? "text-chart-3 bg-chart-3/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                      title={pinned ? "Unpin" : "Pin to dashboard"}
                    >
                      {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                    <DownloadDropdown report={r} />
                    <button
                      onClick={() => onRun(r)}
                      className="flex items-center gap-1 text-primary hover:text-primary/80 px-2 py-1.5 rounded border border-primary/30 hover:bg-primary/10 transition-colors font-medium"
                    >
                      <Play className="w-3 h-3" /> Run
                    </button>
                    <RowMenu report={r} onDelete={() => onDelete(r.id)} deleting={deletingId === r.id} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Grid / card view ──────────────────────────────────────────────────────────

function GridView({
  reports,
  onRun,
  onTogglePin,
  onDelete,
  deletingId,
}: {
  reports: LibraryReport[];
  onRun: (r: LibraryReport) => void;
  onTogglePin: (r: LibraryReport) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {reports.map((r) => {
        const pinned = isItemPinned("report", r.id);
        return (
          <div
            key={r.id}
            className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors group"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                  {r.version && r.version > 1 && (
                    <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border">v{r.version}</span>
                  )}
                </div>
                {r.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{r.description}</p>
                )}
              </div>
              <button
                onClick={() => onTogglePin(r)}
                className={`p-1.5 rounded border shrink-0 transition-colors ${
                  pinned ? "border-chart-3/40 bg-chart-3/15 text-chart-3" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                title={pinned ? "Unpin" : "Pin to dashboard"}
              >
                {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${kpiChipClass(r.kpi)}`}>{r.kpi}</span>
              {r.tags.filter((t) => t !== r.kpi).slice(0, 2).map((tag) => (
                <span key={tag} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Tag className="w-2 h-2" />{tag}
                </span>
              ))}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2 py-2 border-y border-border/50">
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground">{r.run_count}</span>
                <span className="text-[10px] text-muted-foreground">runs</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground">
                  {r.last_row_count !== null ? r.last_row_count.toLocaleString() : "—"}
                </span>
                <span className="text-[10px] text-muted-foreground">rows</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground">{r.version ?? 1}</span>
                <span className="text-[10px] text-muted-foreground">version</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-auto">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="w-2.5 h-2.5" />
                {r.last_run_date ? formatRelative(r.last_run_date) : `Created ${formatRelative(r.created_date)}`}
              </span>
              <div className="flex items-center gap-1">
                <DownloadDropdown report={r} />
                <button
                  onClick={() => onRun(r)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2.5 py-1.5 rounded border border-primary/30 hover:bg-primary/10 transition-colors font-medium"
                >
                  <Play className="w-3 h-3" /> Run
                </button>
                <RowMenu report={r} onDelete={() => onDelete(r.id)} deleting={deletingId === r.id} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ reports }: { reports: LibraryReport[] }) {
  const totalRuns = reports.reduce((s, r) => s + r.run_count, 0);
  const totalRows = reports.reduce((s, r) => s + (r.last_row_count ?? 0), 0);
  const pinCount = reports.filter((r) => isItemPinned("report", r.id)).length;
  const kpiSet = new Set(reports.map((r) => r.kpi));

  const stats = [
    { label: "Reports", value: reports.length, icon: Rows3 },
    { label: "Total Runs", value: totalRuns.toLocaleString(), icon: TrendingUp },
    { label: "Rows Fetched", value: totalRows > 0 ? totalRows.toLocaleString() : "—", icon: Database },
    { label: "KPI Types", value: kpiSet.size, icon: BarChart2 },
    { label: "Pinned", value: pinCount, icon: Pin },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <s.icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-base font-bold text-foreground leading-none">{s.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SavedReportsLibrary({ onRun, onNavigateCreate }: SavedReportsLibraryProps) {
  const [reports, setReports] = useState<LibraryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [filterKpi, setFilterKpi] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("created_date");
  const [showFilters, setShowFilters] = useState(false);

  useDashboardPins();

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      // Idempotent seed: populates SQL library reports if not yet present.
      await fetch("/api/kpi/seed-reports", { method: "POST" }).catch(() => {});
      const res = await fetch("/api/reports");
      const json = await res.json();
      setReports(json.reports ?? []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const allKpis = useMemo(() => Array.from(new Set(reports.map((r) => r.kpi).filter(Boolean))).sort(), [reports]);
  const allTags = useMemo(() => Array.from(new Set(reports.flatMap((r) => r.tags))).sort(), [reports]);

  const filtered = useMemo(() => {
    let list = [...reports];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.kpi?.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filterKpi !== "all") list = list.filter((r) => r.kpi === filterKpi);
    if (filterTag !== "all") list = list.filter((r) => r.tags.includes(filterTag));
    if (filterStatus !== "all") list = list.filter((r) => (r.status ?? "published") === filterStatus);
    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "run_count") return b.run_count - a.run_count;
      if (sortBy === "last_run_date") return (b.last_run_date ?? "").localeCompare(a.last_run_date ?? "");
      return b.created_date.localeCompare(a.created_date);
    });
    return list;
  }, [reports, search, filterKpi, filterTag, filterStatus, sortBy]);

  const hasActiveFilters = search || filterKpi !== "all" || filterTag !== "all" || filterStatus !== "all" || sortBy !== "created_date";

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/reports/${id}`, { method: "DELETE" });
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (isItemPinned("report", id)) await unpinByRef("report", id);
    } finally { setDeletingId(null); }
  }

  async function handleTogglePin(r: LibraryReport) {
    if (isItemPinned("report", r.id)) {
      await unpinByRef("report", r.id);
    } else {
      await pinItem({
        type: "report",
        refId: r.id,
        title: r.name,
        subtitle: r.description || `${r.kpi} report`,
        kpi: r.kpi,
        meta: { sql: r.sql, prompt: r.prompt },
      });
    }
  }

  function clearFilters() {
    setSearch(""); setFilterKpi("all"); setFilterTag("all"); setFilterStatus("all"); setSortBy("created_date");
  }

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-primary" />
            Reports Library
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Browse, run, and manage all saved reports</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onNavigateCreate && (
            <button
              onClick={onNavigateCreate}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-primary/40 text-primary bg-primary/8 hover:bg-primary/15 transition-colors font-medium"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              New Report
            </button>
          )}
          <button onClick={fetchReports} className="p-1.5 rounded hover:bg-muted transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && <StatsBar reports={reports} />}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-md pl-8 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded border transition-colors ${
            hasActiveFilters
              ? "border-primary/40 text-primary bg-primary/8"
              : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="bg-card border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="created_date">Newest first</option>
          <option value="last_run_date">Last run</option>
          <option value="run_count">Most run</option>
          <option value="name">Name A–Z</option>
        </select>

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => setViewMode("table")}
            className={`p-2 transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            title="Table view"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            title="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Count */}
        <span className="text-xs text-muted-foreground">
          {filtered.length}{filtered.length !== reports.length ? ` of ${reports.length}` : ""} reports
        </span>
      </div>

      {/* Filter drawer */}
      {showFilters && (
        <div className="bg-muted/30 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-end">
          {[
            { label: "KPI", value: filterKpi, options: ["all", ...allKpis], setter: setFilterKpi },
            { label: "Tag", value: filterTag, options: ["all", ...allTags], setter: setFilterTag },
            { label: "Status", value: filterStatus, options: ["all", "published", "draft", "archived"], setter: setFilterStatus },
          ].map(({ label, value, options, setter }) => (
            <div key={label} className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
              <select
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="bg-card border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px]"
              >
                {options.map((o) => (
                  <option key={o} value={o} className="capitalize">{o === "all" ? `All ${label}s` : o}</option>
                ))}
              </select>
            </div>
          ))}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded border border-border hover:border-primary/30"
            >
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading reports...</span>
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No saved reports yet</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Run a query in Report Studio and save it, or create a new report to get started.
          </p>
          {onNavigateCreate && (
            <button
              onClick={onNavigateCreate}
              className="mt-1 flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-primary/40 text-primary bg-primary/8 hover:bg-primary/15 transition-colors font-medium"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              Create your first report
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-muted-foreground">No reports match your filters.</p>
          <button onClick={clearFilters} className="text-xs text-primary hover:text-primary/80 underline underline-offset-2">
            Clear filters
          </button>
        </div>
      ) : viewMode === "table" ? (
        <TableView
          reports={filtered}
          onRun={onRun}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      ) : (
        <GridView
          reports={filtered}
          onRun={onRun}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      )}
    </div>
  );
}
