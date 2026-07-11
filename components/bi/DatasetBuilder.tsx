"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  History,
  Link2,
  Plus,
  Sliders,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFile } from "@/lib/bi/inference";
import type {
  DataRow,
  DatasetField,
  DatasetSchema,
  FieldType,
  Relationship,
} from "@/lib/bi/types";
import {
  createDataset,
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const editingExisting = draft.id !== null;

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
            <button
              key={ds.id}
              onClick={() => loadForEdit(ds)}
              className={cn(
                "flex flex-col gap-1 text-left p-3 rounded-lg border transition-colors",
                draft.id === ds.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">{ds.name}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{ds.fields.length} fields</span>
                <span>·</span>
                <span>v{ds.version}</span>
                <span>·</span>
                <span className="capitalize">{ds.source}</span>
              </div>
            </button>
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
          <div className="flex items-center gap-2 text-xs text-chart-3">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Loaded {draft.sampleData.length} sample rows — types inferred automatically.
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
          <div className="flex items-center gap-2">
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
