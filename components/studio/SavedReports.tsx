"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bookmark,
  Play,
  Trash2,
  Clock,
  Tag,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SavedReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
  created_by: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
}

interface SavedReportsProps {
  onLoad: (report: SavedReport) => void;
  pendingSave?: { name: string; sql: string; prompt: string; kpi: string } | null;
  onSaveDone?: () => void;
}

export function SavedReports({ onLoad, pendingSave, onSaveDone }: SavedReportsProps) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      const json = await res.json();
      setReports(json.reports ?? []);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    if (pendingSave) {
      setSaveName(pendingSave.name);
      setShowSaveForm(true);
    }
  }, [pendingSave]);

  async function saveReport() {
    if (!pendingSave || !saveName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim(),
          prompt: pendingSave.prompt,
          sql: pendingSave.sql,
          kpi: pendingSave.kpi,
          tags: pendingSave.kpi ? [pendingSave.kpi] : [],
          created_by: "analyst",
        }),
      });
      if (res.ok) {
        await fetchReports();
        setSaveName("");
        setSaveDesc("");
        setShowSaveForm(false);
        onSaveDone?.();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteReport(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/reports/${id}`, { method: "DELETE" });
      setReports((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  function formatRelative(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "< 1 hour ago";
    if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d !== 1 ? "s" : ""} ago`;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Saved Reports</h3>
          <span className="text-[11px] text-muted-foreground">({reports.length})</span>
        </div>
        <button
          onClick={fetchReports}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Save form */}
      {showSaveForm && pendingSave && (
        <div className="bg-muted/50 border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-foreground">Save current query</p>
          <input
            type="text"
            placeholder="Report name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={saveDesc}
            onChange={(e) => setSaveDesc(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={saveReport}
              disabled={saving || !saveName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 h-7 px-3 text-xs"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Save
            </Button>
            <button
              onClick={() => {
                setShowSaveForm(false);
                onSaveDone?.();
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Report list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No saved reports yet. Run a query and save it to see it here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((r) => (
            <div
              key={r.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>
                  )}

                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    {/* Tags */}
                    {r.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20"
                      >
                        <Tag className="w-2 h-2" />
                        {tag}
                      </span>
                    ))}

                    {/* Metadata */}
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="w-2.5 h-2.5" />
                      {r.last_run_date
                        ? `Last run ${formatRelative(r.last_run_date)}`
                        : `Created ${formatRelative(r.created_date)}`}
                    </span>

                    {r.run_count > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {r.run_count} run{r.run_count !== 1 ? "s" : ""}
                      </span>
                    )}

                    {r.last_row_count !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        {r.last_row_count.toLocaleString()} rows
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onLoad(r)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-2.5 py-1.5 rounded border border-primary/30 hover:bg-primary/10"
                    title="Load and run this report"
                  >
                    <Play className="w-3 h-3" />
                    Load
                  </button>
                  <button
                    onClick={() => deleteReport(r.id)}
                    disabled={deletingId === r.id}
                    className="p-1.5 rounded hover:bg-destructive/15 transition-colors"
                    title="Delete report"
                  >
                    {deletingId === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
