"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Bookmark,
  Play,
  Trash2,
  Clock,
  Tag,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
  SlidersHorizontal,
  Pin,
  PinOff,
  FilePlus2,
  Download,
  ChevronDown,
  Pencil,
  History,
  FileText,
  CheckCircle2,
  MoreHorizontal,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useDashboardPins,
  isPinned as isItemPinned,
  pinItem,
  unpinByRef,
} from "@/lib/hooks/useDashboardPins";
import { downloadDataset, type DownloadFormat } from "@/lib/utils/download";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SavedReport {
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
  version_history?: VersionEntry[];
}

interface VersionEntry {
  version: number;
  saved_at: string;
  saved_by: string;
  note: string;
  sql_snapshot: string;
}

interface SavedReportsProps {
  onLoad: (report: SavedReport) => void;
  pendingSave?: { name: string; sql: string; prompt: string; kpi: string } | null;
  onSaveDone?: () => void;
  allowCreate?: boolean;
  /** Current result rows for download (populated after a report is run). */
  currentRows?: Record<string, unknown>[];
}

type SortKey = "created_date" | "last_run_date" | "run_count" | "name";

// ── Utility ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1 hour ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function kpiColor(kpi: string) {
  const map: Record<string, string> = {
    admissions: "bg-chart-1/10 text-chart-1 border-chart-1/20",
    revenue:    "bg-chart-2/10 text-chart-2 border-chart-2/20",
    census:     "bg-chart-3/10 text-chart-3 border-chart-3/20",
    custom:     "bg-muted text-muted-foreground border-border",
  };
  return map[kpi] ?? "bg-primary/10 text-primary border-primary/20";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DownloadMenu({
  reportName,
  currentRows,
  onDownloadReport,
}: {
  reportName: string;
  currentRows?: Record<string, unknown>[];
  onDownloadReport: (fmt: DownloadFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded border border-border hover:border-primary/40"
        title="Download"
      >
        <Download className="w-3 h-3" />
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-3 py-1.5 font-medium">
              Download report
            </p>
            <button
              onClick={() => { onDownloadReport("csv"); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
            >
              <FileText className="w-3 h-3 text-muted-foreground" /> CSV
            </button>
            <button
              onClick={() => { onDownloadReport("json"); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
            >
              <FileText className="w-3 h-3 text-muted-foreground" /> JSON
            </button>
            {currentRows && currentRows.length > 0 && (
              <>
                <hr className="border-border my-1" />
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-3 py-1 font-medium">
                  Current results ({currentRows.length.toLocaleString()} rows)
                </p>
                <button
                  onClick={() => { downloadDataset(currentRows, reportName, "csv"); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
                >
                  <Download className="w-3 h-3 text-muted-foreground" /> Results as CSV
                </button>
                <button
                  onClick={() => { downloadDataset(currentRows, reportName, "json"); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
                >
                  <Download className="w-3 h-3 text-muted-foreground" /> Results as JSON
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ActionMenu({
  report,
  onEdit,
  onHistory,
  onDelete,
  deleting,
}: {
  report: SavedReport;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title="More actions"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            <button
              onClick={() => { onEdit(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
            >
              <Pencil className="w-3 h-3 text-muted-foreground" /> Edit metadata
            </button>
            {report.version_history && report.version_history.length > 0 && (
              <button
                onClick={() => { onHistory(); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent/50 flex items-center gap-2"
              >
                <History className="w-3 h-3 text-muted-foreground" /> Version history
              </button>
            )}
            <hr className="border-border my-1" />
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

function MetadataModal({
  report,
  onSave,
  onClose,
}: {
  report: SavedReport;
  onSave: (patch: { name: string; description: string; tags: string[]; visibility: string; versionNote: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(report.name);
  const [description, setDescription] = useState(report.description);
  const [tagsRaw, setTagsRaw] = useState(report.tags.join(", "));
  const [visibility, setVisibility] = useState<string>(report.visibility ?? "team");
  const [versionNote, setVersionNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        tags: tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
        visibility,
        versionNote,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            Edit Report Metadata
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Name *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</span>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="admissions, branch, weekly"
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1.5 flex-1">
              <span className="text-xs font-medium text-muted-foreground">Visibility</span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="private">Private</option>
                <option value="team">Team</option>
                <option value="public">Public</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Version note (creates new version)</span>
            <input
              value={versionNote}
              onChange={(e) => setVersionNote(e.target.value)}
              placeholder="Optional: describe what changed"
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded border border-border transition-colors"
          >
            Cancel
          </button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-4 text-xs gap-1.5"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function VersionHistoryDrawer({
  report,
  onClose,
  onRestoreVersion,
}: {
  report: SavedReport;
  onClose: () => void;
  onRestoreVersion: (v: VersionEntry) => void;
}) {
  const versions = [...(report.version_history ?? [])].reverse();
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border-l border-border w-full max-w-sm flex flex-col h-full shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Version History</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-0 overflow-y-auto flex-1 p-4">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions saved yet.</p>
          ) : (
            versions.map((v, i) => (
              <div
                key={v.version}
                className={`relative pl-5 pb-5 ${i < versions.length - 1 ? "border-l-2 border-border" : ""}`}
              >
                <div className="absolute left-[-5px] top-0 w-2.5 h-2.5 rounded-full bg-primary border-2 border-card" />
                <div className="bg-muted/30 border border-border rounded-lg p-3 flex flex-col gap-1.5 ml-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">v{v.version}</span>
                    <span className="text-[11px] text-muted-foreground">{formatRelative(v.saved_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{v.note || "No note"}</p>
                  <p className="text-[11px] text-muted-foreground">By {v.saved_by}</p>
                  {v.sql_snapshot && (
                    <button
                      onClick={() => onRestoreVersion(v)}
                      className="self-start flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 mt-1"
                    >
                      <Eye className="w-3 h-3" /> View SQL
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SavedReports({
  onLoad,
  pendingSave,
  onSaveDone,
  allowCreate = false,
  currentRows,
}: SavedReportsProps) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveVisibility, setSaveVisibility] = useState<"private" | "team">("team");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [editingReport, setEditingReport] = useState<SavedReport | null>(null);
  const [historyReport, setHistoryReport] = useState<SavedReport | null>(null);

  // Manual authoring
  const [manualMode, setManualMode] = useState(false);
  const [manualSql, setManualSql] = useState("");
  const [manualKpi, setManualKpi] = useState("custom");

  useDashboardPins();

  // Filter state
  const [search, setSearch] = useState("");
  const [filterKpi, setFilterKpi] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("created_date");
  const [showFilters, setShowFilters] = useState(false);

  const fetchReports = useCallback(async () => {
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

  useEffect(() => {
    if (pendingSave) { setSaveName(pendingSave.name); setShowSaveForm(true); }
  }, [pendingSave]);

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

  // ── Save form ──────────────────────────────────────────────────────────────
  async function handleSave() {
    const sql = manualMode ? manualSql.trim() : pendingSave?.sql ?? "";
    const kpi = manualMode ? (manualKpi.trim() || "custom") : pendingSave?.kpi ?? "custom";
    const prompt = manualMode ? "" : pendingSave?.prompt ?? "";
    if (!saveName.trim() || !sql) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim(),
          prompt, sql, kpi,
          tags: kpi && kpi !== "custom" ? [kpi] : [],
          visibility: saveVisibility,
          created_by: "analyst",
        }),
      });
      if (res.ok) {
        await fetchReports();
        setSaveName(""); setSaveDesc(""); setManualSql(""); setManualKpi("custom");
        setManualMode(false); setShowSaveForm(false); onSaveDone?.();
      }
    } finally { setSaving(false); }
  }

  function openManualForm() {
    setManualMode(true); setSaveName(""); setSaveDesc(""); setManualSql(""); setManualKpi("custom");
    setShowSaveForm(true);
  }

  function closeSaveForm() { setShowSaveForm(false); setManualMode(false); onSaveDone?.(); }

  // ── Pin/unpin ──────────────────────────────────────────────────────────────
  async function togglePin(r: SavedReport) {
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

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/reports/${id}`, { method: "DELETE" });
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (isItemPinned("report", id)) await unpinByRef("report", id);
    } finally { setDeletingId(null); }
  }

  // ── Edit metadata ──────────────────────────────────────────────────────────
  async function handleEditSave(patch: { name: string; description: string; tags: string[]; visibility: string; versionNote: string }) {
    if (!editingReport) return;
    const res = await fetch(`/api/reports/${editingReport.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) await fetchReports();
  }

  // ── Download ───────────────────────────────────────────────────────────────
  function handleDownloadReport(r: SavedReport, fmt: DownloadFormat) {
    // If we have live rows from the parent, use them; else generate a stub with SQL metadata
    if (currentRows && currentRows.length > 0) {
      downloadDataset(currentRows, r.name, fmt);
    } else {
      const stub = [{ report_name: r.name, sql: r.sql, kpi: r.kpi, tags: r.tags.join(","), created_date: r.created_date }];
      downloadDataset(stub as Record<string, unknown>[], r.name + "_definition", fmt);
    }
  }

  function clearFilters() { setSearch(""); setFilterKpi("all"); setFilterTag("all"); setFilterStatus("all"); setSortBy("created_date"); }

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Saved Reports</h3>
            <span className="text-[11px] text-muted-foreground">
              ({filtered.length}{filtered.length !== reports.length ? ` of ${reports.length}` : ""})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {allowCreate && (
              <button
                onClick={openManualForm}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-primary/40 text-primary bg-primary/8 hover:bg-primary/15 transition-colors font-medium"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                New Report
              </button>
            )}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors ${
                hasActiveFilters
                  ? "border-primary/40 text-primary bg-primary/8"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
            <button onClick={fetchReports} className="p-1.5 rounded hover:bg-muted transition-colors" title="Refresh">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Save form */}
        {showSaveForm && (pendingSave || manualMode) && (
          <div className="bg-muted/50 border border-border rounded-lg p-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-foreground">
              {manualMode ? "New report" : "Save current query"}
            </p>
            <input
              type="text" placeholder="Report name" value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="text" placeholder="Description (optional)" value={saveDesc}
              onChange={(e) => setSaveDesc(e.target.value)}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted-foreground">Visibility</label>
              <select
                value={saveVisibility}
                onChange={(e) => setSaveVisibility(e.target.value as "private" | "team")}
                className="bg-card border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="team">Team</option>
                <option value="private">Private</option>
              </select>
            </div>
            {manualMode && (
              <>
                <textarea
                  placeholder="SQL query"
                  value={manualSql}
                  onChange={(e) => setManualSql(e.target.value)}
                  rows={5} spellCheck={false}
                  className="bg-card border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground shrink-0">KPI category</label>
                  <input
                    type="text" placeholder="custom" value={manualKpi}
                    onChange={(e) => setManualKpi(e.target.value)}
                    className="bg-card border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary flex-1"
                  />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !saveName.trim() || (manualMode && !manualSql.trim())}
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 h-7 px-3 text-xs"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Save
              </Button>
              <button onClick={closeSaveForm} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-muted/30 border border-border rounded-lg p-3 flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text" placeholder="Search by name, KPI, or tag..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-card border border-border rounded-md pl-8 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
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
                    className="bg-card border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px] capitalize"
                  >
                    {options.map((o) => (
                      <option key={o} value={o} className="capitalize">{o === "all" ? `All ${label}s` : o}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sort by</label>
                <select
                  value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="bg-card border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[140px]"
                >
                  <option value="created_date">Date Created</option>
                  <option value="last_run_date">Last Run</option>
                  <option value="run_count">Most Run</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>
              {hasActiveFilters && (
                <div className="flex flex-col justify-end">
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded border border-border hover:border-primary/30"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Report list */}
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No saved reports yet. Run a query and save it to see it here.
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className="text-sm text-muted-foreground">No reports match your filters.</p>
            <button onClick={clearFilters} className="text-xs text-primary hover:text-primary/80 underline underline-offset-2">Clear filters</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((r) => {
              const pinned = isItemPinned("report", r.id);
              return (
                <div
                  key={r.id}
                  className="bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                        {r.version && r.version > 1 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                            v{r.version}
                          </span>
                        )}
                        {r.status && r.status !== "published" && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${
                            r.status === "draft" ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" : "bg-muted text-muted-foreground border-border"
                          }`}>
                            {r.status}
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>
                      )}
                      <div className="flex items-center flex-wrap gap-2 mt-2">
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${kpiColor(r.kpi)}`}>
                          {r.kpi}
                        </span>
                        {r.tags.filter((t) => t !== r.kpi).map((tag) => (
                          <button
                            key={tag}
                            onClick={() => { setFilterTag(tag); setShowFilters(true); }}
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border hover:bg-accent/50 transition-colors"
                          >
                            <Tag className="w-2 h-2" /> {tag}
                          </button>
                        ))}
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5" />
                          {r.last_run_date
                            ? `Last run ${formatRelative(r.last_run_date)}`
                            : `Created ${formatRelative(r.created_date)}`}
                        </span>
                        {r.run_count > 0 && (
                          <span className="text-[11px] text-muted-foreground">{r.run_count} run{r.run_count !== 1 ? "s" : ""}</span>
                        )}
                        {r.last_row_count !== null && (
                          <span className="text-[11px] text-muted-foreground">{r.last_row_count.toLocaleString()} rows</span>
                        )}
                        {r.visibility && r.visibility !== "team" && (
                          <span className="text-[10px] text-muted-foreground capitalize">· {r.visibility}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {/* Pin */}
                      <button
                        onClick={() => togglePin(r)}
                        className={`p-1.5 rounded border transition-colors ${
                          pinned
                            ? "border-chart-3/40 bg-chart-3/15 text-chart-3"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-chart-3/40"
                        }`}
                        title={pinned ? "Unpin from dashboard" : "Pin to dashboard"}
                        aria-pressed={pinned}
                      >
                        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>

                      {/* Download */}
                      <DownloadMenu
                        reportName={r.name}
                        currentRows={currentRows}
                        onDownloadReport={(fmt) => handleDownloadReport(r, fmt)}
                      />

                      {/* Load */}
                      <button
                        onClick={() => onLoad(r)}
                        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded border border-primary/30 hover:bg-primary/10"
                        title="Load and run this report"
                      >
                        <Play className="w-3 h-3" />
                        Load
                      </button>

                      {/* More actions */}
                      <ActionMenu
                        report={r}
                        onEdit={() => setEditingReport(r)}
                        onHistory={() => setHistoryReport(r)}
                        onDelete={() => handleDelete(r.id)}
                        deleting={deletingId === r.id}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit metadata modal */}
      {editingReport && (
        <MetadataModal
          report={editingReport}
          onSave={handleEditSave}
          onClose={() => setEditingReport(null)}
        />
      )}

      {/* Version history drawer */}
      {historyReport && (
        <VersionHistoryDrawer
          report={historyReport}
          onClose={() => setHistoryReport(null)}
          onRestoreVersion={(v) => {
            onLoad({ ...historyReport, sql: v.sql_snapshot });
            setHistoryReport(null);
          }}
        />
      )}
    </>
  );
}
