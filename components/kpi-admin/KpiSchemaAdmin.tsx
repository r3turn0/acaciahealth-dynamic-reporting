"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Plus,
  Search,
  Copy,
  Edit3,
  Archive,
  CheckCircle2,
  Send,
  Rocket,
  RotateCcw,
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  X,
  AlertCircle,
  Clock,
  GitBranch,
  Layers,
  Settings2,
  History,
  FileCode2,
  ShieldCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type KpiStatus = "Draft" | "Validated" | "Approved" | "Published" | "Archived";

interface KpiDef {
  id: string;
  label: string;
  category: string;
  version: string;
  status: KpiStatus;
  formula: string;
  source: string;
  dimensions: string[];
  parameters: Record<string, unknown>;
  filters: Record<string, unknown>;
  location_key: string;
  service_line_field: string;
  active_service_lines: string[];
  description: string;
  owner?: string;
  steward?: string;
  grain?: string;
  sourceColumns?: string[];
  dependencies?: string[];
  aliases?: string[];
  discoveryState?: "Configured" | "Discovered";
  provenance?: Record<string, unknown>;
  validation?: { status: "validated" | "partial" | "unverified"; confidence: number; variance: number | null; reason: string; lastRun?: string };
  _meta?: {
    createdBy?: string;
    createdDate?: string;
    approvedBy?: string;
    approvedDate?: string;
    changeLog?: string[];
  };
}

interface RegistryMeta {
  schemaVersion: string;
  effectiveDate: string;
  status: string;
  totalKpis: number;
  domains: { domain: string; count: number }[];
  discovery?: {
    correlationId: string;
    sourceFile: string;
    worksheetCount: number;
    candidateCount: number;
    discoveredCount: number;
    generatedAt: string;
  };
  deploymentHistory: {
    deploymentId: string;
    schemaVersion: string;
    deployedBy: string;
    deployedDate: string;
    target: string;
    status: string;
    kpiCount: number;
  }[];
}

type AdminTab = "catalog" | "editor" | "registry" | "parameters" | "diff" | "history";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<KpiStatus, { label: string; className: string }> = {
  Draft:     { label: "Draft",     className: "bg-muted text-muted-foreground border-border" },
  Validated: { label: "Validated", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  Approved:  { label: "Approved",  className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  Published: { label: "Published", className: "bg-teal/10 text-teal border-teal/20" },
  Archived:  { label: "Archived",  className: "bg-destructive/10 text-destructive border-destructive/20" },
};

const LIFECYCLE_ACTIONS: Record<KpiStatus, { action: string; label: string; icon: React.ElementType; apiAction: string } | null> = {
  Draft:     { action: "validate",   label: "Validate",   icon: CheckCircle2, apiAction: "validate"  },
  Validated: { action: "approve",    label: "Approve",    icon: ShieldCheck,  apiAction: "approve"   },
  Approved:  { action: "publish",    label: "Publish",    icon: Send,         apiAction: "publish"   },
  Published: { action: "deactivate", label: "Archive",    icon: Archive,      apiAction: "deactivate"},
  Archived:  null,
};

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: "catalog",    label: "KPI Catalog",    icon: BarChart3   },
  { id: "editor",     label: "KPI Editor",     icon: Edit3       },
  { id: "registry",   label: "Schema Registry",icon: Layers      },
  { id: "parameters", label: "Parameters",     icon: Settings2   },
  { id: "diff",       label: "Schema Diff",    icon: GitBranch   },
  { id: "history",    label: "Deploy History", icon: History     },
];

const ENTERPRISE_DIMENSIONS = [
  "Service Line","Branch Code","Branch Name","Region","City","State",
  "Care Type","Payor","Referral Date","Admission Date","Discharge Date",
  "Census Date","As Of Date","Discharge Class","Non Admit Reason",
  "Recert Status","QA Status","Worker","Productivity Status",
];

const VALID_SOURCES = [
  "CLIENT_EPISODES_ALL",
  "CLIENT_EPISODE_VISIT_NOTES",
  "CLIENT_EPISODE_VISITS_ALL",
  "PDGM_PERIOD",
  "Billing.LINE_ITEMS",
  "WORKER_BASE",
];

// ── Main Component ─────────────────────────────────────────────────────────────

export function KpiSchemaAdmin({ userRole = "Admin" }: { userRole?: "Admin" | "Analyst" | "Viewer" }) {
  const [tab, setTab] = useState<AdminTab>("catalog");
  const [kpis, setKpis] = useState<KpiDef[]>([]);
  const [registry, setRegistry] = useState<RegistryMeta | null>(null);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter]   = useState<string>("All");
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedKpi, setSelectedKpi] = useState<KpiDef | null>(null);
  const [editorKpi, setEditorKpi] = useState<KpiDef | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [diffData, setDiffData] = useState<{ from: string; to: string; added: { id: string; label: string; category: string; version: string }[] } | null>(null);

  const canEdit    = userRole === "Admin" || userRole === "Analyst";
  const canApprove = userRole === "Admin";
  const canDeploy  = userRole === "Admin";

  // ── Fetch helpers ────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, regRes, paramRes, catRes] = await Promise.all([
        fetch("/api/kpi-admin"),
        fetch("/api/kpi-admin?action=registry"),
        fetch("/api/kpi-admin?action=parameters"),
        fetch("/api/kpi-admin?action=categories"),
      ]);
      const kpiJson  = await kpiRes.json();
      const regJson  = await regRes.json();
      const paramJson = await paramRes.json();
      const catJson   = await catRes.json();
      setKpis(kpiJson.kpis ?? []);
      setRegistry(regJson);
      setParameters(paramJson);
      setCategories(["All", ...catJson]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDiff = useCallback(async () => {
    const res  = await fetch("/api/kpi-admin?action=diff&from=5.0");
    const json = await res.json();
    setDiffData(json);
  }, []);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);
  useEffect(() => { if (tab === "diff") fetchDiff(); }, [tab, fetchDiff]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function runLifecycle(kpi: KpiDef, apiAction: string) {
    const res  = await fetch("/api/kpi-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: apiAction, id: kpi.id, deployedBy: "Admin" }),
    });
    const json = await res.json();
    if (json.success || json.valid === true) {
      showToast(`${kpi.label} → ${json.status ?? "processed"}`);
      setValidationErrors([]);
      fetchCatalog();
    } else {
      showToast(json.error ?? (json.errors?.[0]) ?? "Action failed", false);
      if (json.errors) setValidationErrors(json.errors);
    }
  }

  async function handleClone(kpi: KpiDef) {
    const newId = `${kpi.id}_copy_${Date.now()}`;
    const res   = await fetch("/api/kpi-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clone", kpiId: kpi.id, id: newId }),
    });
    const json = await res.json();
    if (json.success) { showToast(`Cloned as ${newId}`); fetchCatalog(); }
    else showToast(json.error ?? "Clone failed", false);
  }

  async function handleSaveEditor() {
    if (!editorKpi) return;
    const isNew = !kpis.find((k) => k.id === editorKpi.id);
    const method = isNew ? "POST" : "PATCH";
    const body   = isNew
      ? { action: "create", id: editorKpi.id, data: editorKpi }
      : { id: editorKpi.id, data: editorKpi, versionBump: true };
    const res  = await fetch("/api/kpi-admin", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) {
      showToast(isNew ? "KPI created" : "KPI updated");
      setValidationErrors([]);
      fetchCatalog();
      setTab("catalog");
    } else {
      showToast(json.error ?? (json.errors?.[0]) ?? "Save failed", false);
      if (json.errors) setValidationErrors(json.errors);
    }
  }

  async function handleDeploy(target: string) {
    const res  = await fetch("/api/kpi-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deploy", target, deployedBy: "Admin" }),
    });
    const json = await res.json();
    if (json.success) { showToast(`Deployed to ${target}`); fetchCatalog(); }
    else showToast(json.error ?? "Deploy failed", false);
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify({ kpis: Object.fromEntries(kpis.map((k) => [k.id, k])) }, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = `kpi-schema-${registry?.schemaVersion ?? "export"}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast("Schema exported");
  }

  function openEditor(kpi?: KpiDef) {
    setEditorKpi(kpi ? { ...kpi } : {
      id: "", label: "", category: "", version: "1.0.0", status: "Draft",
      formula: "", source: "CLIENT_EPISODES_ALL", dimensions: [],
      parameters: {}, filters: {}, location_key: "epi_branchcode",
      service_line_field: "epi_slid", active_service_lines: [],
      description: "",
    });
    setValidationErrors([]);
    setTab("editor");
  }

  // ── Filtered list ─────────────────────────────────────────────────────────────

  const filtered = kpis.filter((k) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || k.label.toLowerCase().includes(q) || k.id.toLowerCase().includes(q) || k.category.toLowerCase().includes(q);
    const matchesCat    = categoryFilter === "All" || k.category === categoryFilter;
    const matchesStatus = statusFilter === "All" || k.status === statusFilter;
    return matchesSearch && matchesCat && matchesStatus;
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 font-sans">

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border text-xs font-medium shadow-xl transition-all",
          toast.ok
            ? "bg-card border-teal/30 text-teal"
            : "bg-card border-destructive/30 text-destructive"
        )}>
          {toast.msg}
        </div>
      )}

      {/* Header stats */}
      {registry && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Schema Version",  value: `v${registry.schemaVersion}`, sub: registry.status },
            { label: "Total KPIs",      value: registry.totalKpis,           sub: "enterprise catalog" },
            { label: "Published",       value: kpis.filter((k) => k.status === "Published").length, sub: "in production" },
            { label: "Domains",         value: registry.domains.length,      sub: "reporting domains" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
              <div className="text-xl font-semibold text-foreground leading-none">{value}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto pb-px">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md border-b-2 whitespace-nowrap transition-colors",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── CATALOG TAB ──────────────────────────────────────────────────────── */}
      {tab === "catalog" && (
        <div className="flex flex-col gap-3">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search KPIs..."
                className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-muted border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            >
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-muted border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            >
              {["All", "Draft", "Validated", "Approved", "Published", "Archived"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <div className="flex gap-2">
              {canEdit && (
                <button
                  onClick={() => openEditor()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New KPI
                </button>
              )}
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted border border-border text-xs text-foreground rounded-md hover:bg-surface-raised transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
          </div>

          {/* KPI count */}
          <div className="text-[11px] text-muted-foreground">
            Showing {filtered.length} of {kpis.length} KPIs
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">Loading catalog...</div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["KPI Name", "Category", "Source", "Version", "Status", "Actions"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((kpi) => {
                    const lifecycle = LIFECYCLE_ACTIONS[kpi.status];
                    return (
                      <tr
                        key={kpi.id}
                        className={cn(
                          "border-b border-border/50 last:border-0 transition-colors",
                          selectedKpi?.id === kpi.id ? "bg-primary/5" : "hover:bg-muted/30"
                        )}
                      >
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setSelectedKpi(selectedKpi?.id === kpi.id ? null : kpi)}
                            className="text-left"
                          >
                            <div className="font-medium text-foreground">{kpi.label}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{kpi.id}</div>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{kpi.category}</td>
                        <td className="px-3 py-2">
                          <code className="text-[10px] text-primary/80 font-mono">{kpi.source}</code>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono">{kpi.version}</td>
                        <td className="px-3 py-2">
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border", STATUS_CONFIG[kpi.status].className)}>
                            {kpi.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <>
                                <button
                                  onClick={() => openEditor(kpi)}
                                  title="Edit"
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleClone(kpi)}
                                  title="Clone"
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            {canApprove && lifecycle && (
                              <button
                                onClick={() => runLifecycle(kpi, lifecycle.apiAction)}
                                title={lifecycle.label}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[10px] font-medium transition-colors"
                              >
                                <lifecycle.icon className="w-3 h-3" />
                                {lifecycle.label}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Detail panel */}
          {selectedKpi && (
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{selectedKpi.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedKpi.description}</p>
                </div>
                <button onClick={() => setSelectedKpi(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {[
                  ["Source",       selectedKpi.source],
                  ["Location Key", selectedKpi.location_key],
                  ["Service Line", selectedKpi.service_line_field],
                  ["Version",      selectedKpi.version],
                  ["Category",     selectedKpi.category],
                  ["Status",       selectedKpi.status],
                ].map(([k, v]) => (
                  <div key={k} className="bg-muted/50 rounded px-2.5 py-2">
                    <div className="text-[10px] text-muted-foreground">{k}</div>
                    <div className="text-foreground font-medium mt-0.5 font-mono">{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1.5">Formula</div>
                <pre className="text-[11px] font-mono text-foreground/80 bg-muted rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap">{selectedKpi.formula}</pre>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedKpi.dimensions.map((d) => (
                  <span key={d} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] border border-primary/20">{d}</span>
                ))}
              </div>
              {selectedKpi._meta?.changeLog?.length ? (
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Changelog: </span>
                  {selectedKpi._meta.changeLog.join(" · ")}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── EDITOR TAB ───────────────────────────────────────────────────────── */}
      {tab === "editor" && editorKpi && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {kpis.find((k) => k.id === editorKpi.id) ? "Edit KPI" : "New KPI"}
            </h3>
            <button onClick={() => { setTab("catalog"); setEditorKpi(null); }} className="p-1 rounded hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {validationErrors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex flex-col gap-1">
              {validationErrors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {e}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* ID */}
            <EditorField label="KPI ID" required>
              <input
                value={editorKpi.id}
                onChange={(e) => setEditorKpi({ ...editorKpi, id: e.target.value })}
                placeholder="e.g. my_kpi_name"
                className={inputCls}
              />
            </EditorField>
            {/* Label */}
            <EditorField label="Label" required>
              <input
                value={editorKpi.label}
                onChange={(e) => setEditorKpi({ ...editorKpi, label: e.target.value })}
                placeholder="Human-readable name"
                className={inputCls}
              />
            </EditorField>
            {/* Category */}
            <EditorField label="Category" required>
              <input
                value={editorKpi.category}
                onChange={(e) => setEditorKpi({ ...editorKpi, category: e.target.value })}
                placeholder="e.g. Operations"
                className={inputCls}
                list="categories-list"
              />
              <datalist id="categories-list">
                {categories.filter((c) => c !== "All").map((c) => <option key={c} value={c} />)}
              </datalist>
            </EditorField>
            {/* Source */}
            <EditorField label="Source Table" required>
              <select
                value={editorKpi.source}
                onChange={(e) => setEditorKpi({ ...editorKpi, source: e.target.value })}
                className={inputCls}
              >
                <option value="">Select source...</option>
                {VALID_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </EditorField>
            {/* Version */}
            <EditorField label="Version">
              <input value={editorKpi.version} readOnly className={cn(inputCls, "opacity-60 cursor-not-allowed")} />
            </EditorField>
            {/* Location key — locked */}
            <EditorField label="Location Key">
              <input value="epi_branchcode" readOnly className={cn(inputCls, "opacity-60 cursor-not-allowed")} />
            </EditorField>
          </div>

          {/* Description */}
          <EditorField label="Description">
            <textarea
              value={editorKpi.description}
              onChange={(e) => setEditorKpi({ ...editorKpi, description: e.target.value })}
              rows={2}
              placeholder="Describe what this KPI measures and how it is used"
              className={cn(inputCls, "resize-none")}
            />
          </EditorField>

          {/* Formula */}
          <EditorField label="Formula / SQL Expression" required>
            <textarea
              value={editorKpi.formula}
              onChange={(e) => setEditorKpi({ ...editorKpi, formula: e.target.value })}
              rows={3}
              placeholder="COUNT(DISTINCT epi.epi_id) WHERE ..."
              className={cn(inputCls, "resize-none font-mono text-[11px]")}
            />
          </EditorField>

          {/* Dimensions */}
          <EditorField label="Dimensions">
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted border border-border rounded-md min-h-[40px]">
              {editorKpi.dimensions.map((d) => (
                <span key={d} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] border border-primary/20">
                  {d}
                  <button onClick={() => setEditorKpi({ ...editorKpi, dimensions: editorKpi.dimensions.filter((x) => x !== d) })}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1 mt-1.5">
              {ENTERPRISE_DIMENSIONS.filter((d) => !editorKpi.dimensions.includes(d)).map((d) => (
                <button
                  key={d}
                  onClick={() => setEditorKpi({ ...editorKpi, dimensions: [...editorKpi.dimensions, d] })}
                  className="text-left px-2 py-1 rounded bg-muted/50 border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  + {d}
                </button>
              ))}
            </div>
          </EditorField>

          {/* Service lines */}
          <EditorField label="Active Service Lines">
            <div className="flex flex-wrap gap-2">
              {["HOME HEALTH", "HOSPICE", "PRIVATE DUTY"].map((sl) => (
                <label key={sl} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editorKpi.active_service_lines.includes(sl)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...editorKpi.active_service_lines, sl]
                        : editorKpi.active_service_lines.filter((x) => x !== sl);
                      setEditorKpi({ ...editorKpi, active_service_lines: next });
                    }}
                    className="accent-primary"
                  />
                  <span className="text-xs text-foreground">{sl}</span>
                </label>
              ))}
            </div>
          </EditorField>

          {/* Save / Cancel */}
          {canEdit && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSaveEditor}
                className="px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors"
              >
                Save KPI
              </button>
              <button
                onClick={() => { setTab("catalog"); setEditorKpi(null); setValidationErrors([]); }}
                className="px-4 py-2 bg-muted border border-border text-xs text-foreground rounded-md hover:bg-surface-raised transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "editor" && !editorKpi && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Edit3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-foreground font-medium">No KPI selected for editing</p>
            <p className="text-xs text-muted-foreground mt-1">Click &quot;Edit&quot; on a catalog row or create a new KPI</p>
          </div>
          <button
            onClick={() => openEditor()}
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1" /> New KPI
          </button>
        </div>
      )}

      {/* ── REGISTRY TAB ───────────────────────────���─────────────────────────── */}
      {tab === "registry" && registry && (
        <div className="flex flex-col gap-4">
          {registry.discovery && (
            <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" aria-label="Scorecard discovery provenance">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{registry.discovery.discoveredCount} governed KPI candidates discovered</p>
                  <p className="text-[11px] text-muted-foreground">{registry.discovery.worksheetCount} worksheets analyzed from {registry.discovery.sourceFile}; discoveries remain Draft until validated.</p>
                </div>
              </div>
              <code className="rounded border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">{registry.discovery.correlationId}</code>
            </aside>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Schema info */}
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Schema Registry</h3>
              {[
                ["Entity",       "KPI_SCHEMA_REGISTRY"],
                ["Version",      `v${registry.schemaVersion}`],
                ["Effective",    registry.effectiveDate],
                ["Status",       registry.status],
                ["Total KPIs",   registry.totalKpis],
                ["Dimension Model", "Acacia Branch Enterprise Model"],
                ["Primary Key",  "epi_branchcode"],
                ["SL Key",       "epi_slid"],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between text-xs border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-foreground font-mono font-medium">{String(v)}</span>
                </div>
              ))}
            </div>

            {/* Domain breakdown */}
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1">Domain Distribution</h3>
              {registry.domains.sort((a, b) => b.count - a.count).map(({ domain, count }) => {
                const pct = Math.round((count / registry.totalKpis) * 100);
                return (
                  <div key={domain} className="flex items-center gap-2">
                    <div className="w-28 text-[11px] text-muted-foreground truncate shrink-0">{domain}</div>
                    <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[11px] text-muted-foreground w-6 text-right">{count}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Deploy targets */}
          {canDeploy && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">Deployment Targets</h3>
              <div className="flex flex-wrap gap-2">
                {["Development", "Test", "Production"].map((target) => (
                  <button
                    key={target}
                    onClick={() => handleDeploy(target)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary text-xs font-medium rounded-md hover:bg-primary/20 transition-colors"
                  >
                    <Rocket className="w-3.5 h-3.5" /> Deploy to {target}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PARAMETERS TAB ───────────────────────────────────────────────────── */}
      {tab === "parameters" && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">Shared KPI Parameters</h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            These parameters are globally available to all KPI formulas via <code className="font-mono text-primary">@PARAM_NAME</code> substitution. Parameters marked as locked are enforced by the enterprise reporting standard.
          </p>
          {Object.entries(parameters).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
              <div>
                <code className="text-xs font-mono text-primary">@{k}</code>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {k.includes("KEY") || k.includes("FIELD") ? "Locked — enterprise standard" : "Configurable parameter"}
                </div>
              </div>
              <div className="text-xs font-mono text-foreground bg-muted px-2 py-1 rounded border border-border">
                {Array.isArray(v) ? v.join(", ") : String(v)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DIFF TAB ─────────────────────────────────────────────────────────── */}
      {tab === "diff" && (
        <div className="flex flex-col gap-3">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-semibold text-foreground">Schema Diff</h3>
              {diffData && (
                <span className="text-[11px] text-muted-foreground">v{diffData.from} → v{diffData.to}</span>
              )}
            </div>
            {diffData ? (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] text-teal font-medium mb-1">+ {diffData.added.length} KPIs in catalog</div>
                {diffData.added.map(({ id, label, category, version }) => (
                  <div key={id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-teal text-[10px] font-mono w-3">+</span>
                    <span className="text-xs text-foreground font-medium w-48 truncate">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{category}</span>
                    <span className="text-[10px] font-mono text-muted-foreground ml-auto">{version}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Loading diff...</div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────────── */}
      {tab === "history" && registry && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Deployment History</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Deployment ID", "Schema Version", "Target", "KPI Count", "Deployed By", "Date", "Status"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registry.deploymentHistory.map((d) => (
                <tr key={d.deploymentId} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{d.deploymentId}</td>
                  <td className="px-3 py-2 font-mono text-foreground">v{d.schemaVersion}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.target}</td>
                  <td className="px-3 py-2 text-foreground">{d.kpiCount}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.deployedBy}</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(d.deployedDate).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                      d.status === "Success"
                        ? "bg-teal/10 text-teal border-teal/20"
                        : "bg-destructive/10 text-destructive border-destructive/20"
                    )}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

const inputCls = "w-full bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground";

function EditorField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
