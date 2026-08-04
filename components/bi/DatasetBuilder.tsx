"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Link2,
  Lightbulb,
  Plus,
  Sliders,
  Table2,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFile, inferRelationships } from "@/lib/bi/inference";
import { downloadDataset } from "@/lib/utils/download";
import type {
  DataRow,
  DatasetField,
  DatasetSchema,
  FieldType,
  Relationship,
} from "@/lib/bi/types";
import {
  createDataset,
  createReport,
  deleteDataset,
  updateDataset,
  useBiStore,
} from "@/lib/hooks/useBiStore";

const FIELD_TYPES: FieldType[] = ["string", "number", "date", "boolean"];

const TYPE_BADGE: Record<FieldType, string> = {
  string: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  number: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  date: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  boolean: "bg-chart-5/15 text-chart-5 border-chart-5/30",
};

interface Draft {
  id: string | null;
  name: string;
  fields: DatasetField[];
  relationships: Relationship[];
  sampleData: DataRow[];
  source: DatasetSchema["source"];
}

const BLANK: Draft = {
  id: null,
  name: "",
  fields: [{ name: "", type: "string" }],
  relationships: [],
  sampleData: [],
  source: "manual",
};

interface Props {
  onOpenInExplorer: (datasetId: string) => void;
}

export function DatasetBuilder({ onOpenInExplorer }: Props) {
  const { datasets } = useBiStore();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);
  const [bumpVersion, setBumpVersion] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reportName, setReportName] = useState("");
  const [savingReport, setSavingReport] = useState(false);
  const [savedReportFlash, setSavedReportFlash] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const editingExisting = draft.id !== null;

  // ── Relationship inference ──────────────────────────────────────────────────
  const suggestedRelationships = useMemo(() => {
    const namedFields = draft.fields.filter((f) => f.name.trim());
    if (namedFields.length === 0) return [];
    const others = datasets
      .filter((ds) => ds.id !== draft.id)
      .map((ds) => ({ id: ds.id, name: ds.name, fields: ds.fields }));
    if (others.length === 0) return [];
    return inferRelationships(namedFields, others).filter((s) => {
      const key = `${s.fromField}→${s.toDataset}:${s.toField}`;
      if (dismissedSuggestions.has(key)) return false;
      // Don't suggest something already explicitly linked
      return !draft.relationships.some(
        (r) => r.fromField === s.fromField && r.toDataset === s.toDataset && r.toField === s.toField
      );
    });
  }, [draft.fields, draft.id, draft.relationships, datasets, dismissedSuggestions]);

  // ── Download ────────────────────────────────────────────────────────────────
  function downloadDraft(format: "csv" | "json") {
    if (draft.sampleData.length === 0) return;
    const name = draft.name.trim() || "dataset";
    downloadDataset(draft.sampleData as Record<string, unknown>[], name, format);
  }

  function downloadSaved(ds: DatasetSchema, format: "csv" | "json") {
    if (ds.sampleData.length === 0) return;
    downloadDataset(ds.sampleData as Record<string, unknown>[], ds.name, format);
  }

  // ── Suggestion accept / dismiss ─────────────────────────────────────────────
  function acceptSuggestion(fromField: string, toDataset: string, toField: string) {
    setDraft((d) => ({
      ...d,
      relationships: [...d.relationships, { fromField, toDataset, toField }],
    }));
  }

  function dismissSuggestion(fromField: string, toDataset: string, toField: string) {
    const key = `${fromField}→${toDataset}:${toField}`;
    setDismissedSuggestions((prev) => new Set(prev).add(key));
  }

  // ── Validation warnings ─────────────────────────────────────────────────────
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!draft.name.trim()) w.push("Dataset needs a name.");
    const named = draft.fields.filter((f) => f.name.trim());
    if (named.length === 0) w.push("Add at least one field.");
    const lower = named.map((f) => f.name.trim().toLowerCase());
    if (new Set(lower).size !== lower.length) w.push("Field names must be unique.");
    return w;
  }, [draft]);

  const canSave = warnings.length === 0 && !saving;

  // ── Field editing ────────────────────────────────────────────────────────────
  function setField(i: number, patch: Partial<DatasetField>) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    }));
  }
  function addField() {
    setDraft((d) => ({ ...d, fields: [...d.fields, { name: "", type: "string" }] }));
  }
  function removeField(i: number) {
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, idx) => idx !== i) }));
  }

  // ── Relationships ────────────────────────────────────────────────────────────
  function addRelationship() {
    const firstField = draft.fields[0]?.name ?? "";
    const otherDataset = datasets.find((ds) => ds.id !== draft.id);
    setDraft((d) => ({
      ...d,
      relationships: [
        ...d.relationships,
        { fromField: firstField, toDataset: otherDataset?.name ?? "", toField: "" },
      ],
    }));
  }
  function setRelationship(i: number, patch: Partial<Relationship>) {
    setDraft((d) => ({
      ...d,
      relationships: d.relationships.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  }
  function removeRelationship(i: number) {
    setDraft((d) => ({ ...d, relationships: d.relationships.filter((_, idx) => idx !== i) }));
  }

  // ── File inference ───────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setUploadError(null);
    try {
      const { sheets } = await parseFile(file);
      if (sheets.length === 0) {
        setUploadError("No tabular data found in that file.");
        return;
      }
      const sheet = sheets[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      setDraft((d) => ({
        ...d,
        name: d.name.trim() || file.name.replace(/\.[^.]+$/, ""),
        fields: sheet.fields,
        sampleData: sheet.rows.slice(0, 500),
        source: ext === "csv" ? "csv" : "excel",
      }));
      setShowAdvanced(true);
    } catch {
      setUploadError("Could not parse that file. Use a .csv or .xlsx file.");
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────────
  async function save(openAfter = false) {
    if (!canSave) return;
    setSaving(true);
    const cleanFields = draft.fields
      .filter((f) => f.name.trim())
      .map((f) => ({ name: f.name.trim(), type: f.type }));
    try {
      let result: DatasetSchema | null;
      if (editingExisting && draft.id) {
        result = await updateDataset(draft.id, {
          name: draft.name.trim(),
          fields: cleanFields,
          relationships: draft.relationships.filter((r) => r.fromField && r.toDataset),
          sampleData: draft.sampleData,
          bumpVersion,
          note: bumpVersion ? `Schema update v${(datasets.find((d) => d.id === draft.id)?.version ?? 1) + 1}` : undefined,
        });
      } else {
        result = await createDataset({
          name: draft.name.trim(),
          fields: cleanFields,
          relationships: draft.relationships.filter((r) => r.fromField && r.toDataset),
          sampleData: draft.sampleData,
          source: draft.source,
        });
      }
      if (result) {
        setDraft(toDraft(result));
        setBumpVersion(false);
        if (openAfter) onOpenInExplorer(result.id);
      }
    } finally {
      setSaving(false);
    }
  }

  function loadForEdit(ds: DatasetSchema) {
    setDraft(toDraft(ds));
    setBumpVersion(false);
    setUploadError(null);
    setShowAdvanced(true);
  }

  async function saveReport() {
    if (!draft.id || !reportName.trim()) return;
    setSavingReport(true);
    try {
      // Default to a count-all report; user can refine it in the KPI Explorer
      const numericFields = draft.fields.filter((f) => f.type === "number");
      const dateFields = draft.fields.filter((f) => f.type === "date");
      const r = await createReport({
        name: reportName.trim(),
        datasetId: draft.id,
        metrics: numericFields.length > 0
          ? [{ agg: "sum", field: numericFields[0].name }]
          : [{ agg: "count", field: null }],
        dimensions: dateFields.length > 0 ? [dateFields[0].name] : [],
        filters: [],
        chart: "bar",
      });
      if (r) {
        setSavedReportFlash(true);
        setReportName("");
        setTimeout(() => setSavedReportFlash(false), 2000);
      }
    } finally {
      setSavingReport(false);
    }
  }

  const activeVersion = editingExisting
    ? datasets.find((d) => d.id === draft.id)?.version ?? draft.fields.length
    : null;
  const historyCount = editingExisting
    ? datasets.find((d) => d.id === draft.id)?.history.length ?? 0
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      {/* ── Dataset list ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => {
            setDraft(BLANK);
            setUploadError(null);
            setShowAdvanced(false);
          }}
          className={cn(
            "flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors",
            !editingExisting
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
          )}
        >
          <Plus className="w-4 h-4" /> New dataset
        </button>

        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">
            Your datasets ({datasets.length})
          </p>
          {datasets.map((ds) => (
            <div
              key={ds.id}
              className={cn(
                "flex flex-col gap-1 text-left p-3 rounded-lg border transition-colors",
                draft.id === ds.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <button
                onClick={() => loadForEdit(ds)}
                className="flex items-center gap-2 w-full text-left"
              >
                <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">{ds.name}</span>
              </button>
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{ds.fields.length} fields</span>
                  <span>·</span>
                  <span>v{ds.version}</span>
                  {ds.sampleData.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{ds.sampleData.length} rows</span>
                    </>
                  )}
                </div>
                {ds.sampleData.length > 0 && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadSaved(ds, "csv"); }}
                      title="Download CSV"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadSaved(ds, "json"); }}
                      title="Download JSON"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <FileJson className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {datasets.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-4 text-center">
              No datasets yet. Create one to get started.
            </p>
          )}
        </div>
      </div>

      {/* ── Builder form ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 bg-card border border-border rounded-lg p-5 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {editingExisting ? "Edit dataset schema" : "Create a dataset"}
            </h2>
          </div>
          {editingExisting && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <History className="w-3 h-3" /> v{activeVersion} · {historyCount} versions
              </span>
              <button
                onClick={() => draft.id && deleteDataset(draft.id).then(() => setDraft(BLANK))}
                className="flex items-center gap-1 text-destructive/80 hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          )}
        </div>

        {/* Table name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Table name
          </label>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Sales Dataset"
            className="w-full px-3 py-2 rounded-md bg-muted/40 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        {/* Recommended: upload to auto-build the schema */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg border border-primary/40 bg-primary/8 hover:bg-primary/12 transition-colors"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/15 text-primary shrink-0">
            <Upload className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              Build fields from a CSV or Excel file
            </span>
            <span className="block text-xs text-muted-foreground">
              Recommended — columns and types are detected automatically
            </span>
          </span>
        </button>

        {uploadError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="w-3.5 h-3.5" /> {uploadError}
          </div>
        )}
        {draft.sampleData.length > 0 && (
          <div className="flex flex-col gap-2">
            {/* Row count + download bar */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-chart-3/10 border border-chart-3/25">
              <span className="flex items-center gap-2 text-xs text-chart-3 font-medium">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {draft.sampleData.length} sample rows loaded — types inferred automatically
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Table2 className="w-3 h-3" />
                  {showPreview ? "Hide" : "Preview"}
                </button>
                <button
                  onClick={() => downloadDraft("csv")}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Download as CSV"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  CSV
                </button>
                <button
                  onClick={() => downloadDraft("json")}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Download as JSON"
                >
                  <FileJson className="w-3 h-3" />
                  JSON
                </button>
              </div>
            </div>

            {/* Inline preview table (first 8 rows) */}
            {showPreview && (
              <div className="overflow-auto rounded-lg border border-border max-h-52">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-muted/60 sticky top-0">
                      {Object.keys(draft.sampleData[0]).map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap font-mono"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.sampleData.slice(0, 8).map((row, ri) => (
                      <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        {Object.keys(draft.sampleData[0]).map((col) => (
                          <td
                            key={col}
                            className="px-3 py-1.5 text-foreground border-b border-border/40 whitespace-nowrap max-w-[140px] truncate"
                          >
                            {row[col] === null || row[col] === undefined ? (
                              <span className="text-muted-foreground/50 italic">null</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Suggested relationships from inference engine */}
        {suggestedRelationships.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">
                Smart inference — suggested joins
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {suggestedRelationships.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestedRelationships.map((s) => {
                const confColor =
                  s.confidence === "high"
                    ? "text-chart-1 bg-chart-1/10 border-chart-1/25"
                    : s.confidence === "medium"
                    ? "text-chart-4 bg-chart-4/10 border-chart-4/25"
                    : "text-muted-foreground bg-muted border-border";
                return (
                  <div
                    key={`${s.fromField}→${s.toDataset}:${s.toField}`}
                    className="flex items-center gap-2 flex-wrap rounded-md bg-background border border-border px-3 py-2"
                  >
                    <code className="text-[11px] font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
                      {s.fromField}
                    </code>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{s.toDataset}</span>
                      {"."}
                      <code className="font-mono">{s.toField}</code>
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full border capitalize ml-auto shrink-0",
                        confColor
                      )}
                    >
                      {s.confidence}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 hidden sm:block max-w-[180px] truncate">
                      {s.reason}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => acceptSuggestion(s.fromField, s.toDataset, s.toField)}
                        className="flex items-center gap-0.5 px-2 py-1 rounded text-[11px] bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium"
                      >
                        <Check className="w-3 h-3" /> Add
                      </button>
                      <button
                        onClick={() => dismissSuggestion(s.fromField, s.toDataset, s.toField)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        aria-label="Dismiss suggestion"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Lightbulb className="w-3 h-3 shrink-0" />
              Inferred from field names, types, and FK naming patterns. Review before saving.
            </p>
          </div>
        )}

        {/* Advanced disclosure: manual field + relationship editing */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          {showAdvanced ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Sliders className="w-3.5 h-3.5" />
          Advanced — edit fields &amp; relationships manually
          {!showAdvanced && draft.fields.some((f) => f.name.trim()) && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {draft.fields.filter((f) => f.name.trim()).length} fields
            </span>
          )}
        </button>

        {showAdvanced && (
        <>
        {/* Fields */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Fields</label>
            <button
              onClick={addField}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
            >
              <Plus className="w-3 h-3" /> Add field
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {draft.fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={f.name}
                  onChange={(e) => setField(i, { name: e.target.value })}
                  placeholder="field_name"
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-md bg-muted/40 border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {FIELD_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setField(i, { type: t })}
                      className={cn(
                        "px-2 py-1 rounded border text-[10px] font-medium capitalize transition-colors",
                        f.type === t
                          ? TYPE_BADGE[t]
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => removeField(i)}
                  className="p-1.5 text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove field"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Relationships */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Link2 className="w-3.5 h-3.5" /> Relationships (optional)
            </label>
            <button
              onClick={addRelationship}
              disabled={datasets.filter((d) => d.id !== draft.id).length === 0}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" /> Add link
            </button>
          </div>
          {draft.relationships.map((r, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <select
                value={r.fromField}
                onChange={(e) => setRelationship(i, { fromField: e.target.value })}
                className="px-2 py-1.5 rounded-md bg-muted/40 border border-border text-xs text-foreground focus:outline-none focus:border-primary"
              >
                {draft.fields.filter((f) => f.name).map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <select
                value={r.toDataset}
                onChange={(e) => setRelationship(i, { toDataset: e.target.value })}
                className="px-2 py-1.5 rounded-md bg-muted/40 border border-border text-xs text-foreground focus:outline-none focus:border-primary"
              >
                {datasets.filter((d) => d.id !== draft.id).map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
              <input
                value={r.toField}
                onChange={(e) => setRelationship(i, { toField: e.target.value })}
                placeholder="foreign_field"
                className="px-2 py-1.5 rounded-md bg-muted/40 border border-border text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-32"
              />
              <button
                onClick={() => removeRelationship(i)}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove relationship"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        </>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-chart-5/30 bg-chart-5/10 p-3">
            {warnings.map((w) => (
              <p key={w} className="flex items-center gap-1.5 text-[11px] text-chart-5">
                <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {/* Save as Report — only shown once the dataset has been saved */}
        {editingExisting && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Save as Report</span>
              <span className="text-[10px] text-muted-foreground">
                Creates a starter report you can refine in the KPI Explorer
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder={`e.g. ${draft.name} Overview`}
                className="flex-1 min-w-0 px-3 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <button
                onClick={saveReport}
                disabled={!reportName.trim() || savingReport}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <BookMarked className="w-4 h-4" />
                {savedReportFlash ? "Saved!" : "Save Report"}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-border">
          {editingExisting ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={bumpVersion}
                onChange={(e) => setBumpVersion(e.target.checked)}
                className="accent-primary"
              />
              Save as new schema version
            </label>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Saved separately from your warehouse — nothing is written to the database.
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {draft.sampleData.length > 0 && (
              <div className="flex items-center gap-1 border border-border rounded-md overflow-hidden">
                <span className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
                  <Download className="w-3.5 h-3.5" /> Export
                </span>
                <button
                  onClick={() => downloadDraft("csv")}
                  className="px-2.5 py-2 text-[11px] font-medium text-foreground hover:bg-muted transition-colors border-l border-border"
                  title="Download sample data as CSV"
                >
                  CSV
                </button>
                <button
                  onClick={() => downloadDraft("json")}
                  className="px-2.5 py-2 text-[11px] font-medium text-foreground hover:bg-muted transition-colors border-l border-border"
                  title="Download sample data as JSON"
                >
                  JSON
                </button>
              </div>
            )}
            <button
              onClick={() => save(false)}
              disabled={!canSave}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" /> {editingExisting ? "Save changes" : "Save dataset"}
            </button>
            <button
              onClick={() => save(true)}
              disabled={!canSave}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Open in KPI Explorer <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toDraft(ds: DatasetSchema): Draft {
  return {
    id: ds.id,
    name: ds.name,
    fields: ds.fields.length ? ds.fields : [{ name: "", type: "string" }],
    relationships: ds.relationships,
    sampleData: ds.sampleData,
    source: ds.source,
  };
}
