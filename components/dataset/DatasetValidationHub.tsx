"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, ShieldCheck, RefreshCw, Activity } from "lucide-react";
import type { DatasetValidation } from "@/lib/validation/datasetValidation";
import { cn } from "@/lib/utils";
import { cancelScope, orchestrate } from "@/lib/orchestration/requestRegistry";

type TableInput = { name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPk: boolean }> };
export function DatasetValidationHub({ datasetId, tables, relationshipCount }: { datasetId: string; tables: TableInput[]; relationshipCount: number }) {
  const [result, setResult] = useState<DatasetValidation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastValidatedAt, setLastValidatedAt] = useState<number | null>(null);
  const intentRef = useRef(0);
  const tableSignature = useMemo(() => JSON.stringify(tables.map((table) => ({ name: table.name, columns: table.columns.map((column) => [column.name, column.type, column.nullable, column.isPk]) }))), [tables]);
  async function run() {
    const intent = ++intentRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await orchestrate({ scope: `dataset-validation:${datasetId}`, operation: "validate", resource: datasetId, params: { tables, relationshipCount }, policy: "latest", timeoutMs: 30_000 }, async (signal) => {
        const response = await fetch("/api/datasets/validate", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ datasetId, tables, relationshipCount }) });
        const payload = await response.json() as { validation?: DatasetValidation; error?: string };
        if (!response.ok || !payload.validation) throw new Error(payload.error ?? "Validation did not return a result");
        return payload.validation;
      });
      if (intent === intentRef.current) { setResult(data); setLastValidatedAt(Date.now()); }
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "StaleRequestError")) return;
      if (intent === intentRef.current) setError(cause instanceof Error ? cause.message : "Validation failed");
    } finally {
      if (intent === intentRef.current) setLoading(false);
    }
  }
  useEffect(() => { void run(); }, [datasetId, relationshipCount, tableSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  const categoryScores = result ? [...new Set(result.checks.map((check) => check.category))].map((category) => { const checks = result.checks.filter((check) => check.category === category); return { category, score: Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length) }; }) : [];
  return <div className="flex flex-col gap-5">
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><h3 className="text-base font-semibold text-foreground">Dataset Validation Hub</h3><p className="mt-1 text-xs text-muted-foreground">Validate schema, mappings, relationships, KPI readiness, and data quality before publishing.</p>{lastValidatedAt && <p className="mt-2 text-[10px] text-muted-foreground">Fresh as of {new Date(lastValidatedAt).toLocaleTimeString()} · changes automatically replace stale validation runs</p>}</div><div className="flex items-center gap-2">{loading && <button type="button" onClick={() => cancelScope(`dataset-validation:${datasetId}`)} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>}<button type="button" onClick={() => void run()} disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{result ? "Run again" : "Run validation"}</button></div></div>
    {loading && !result && <div className="rounded-xl border border-border bg-muted/20 p-8 text-center"><Loader2 className="mx-auto size-8 animate-spin text-primary" /><p className="mt-3 text-sm font-medium">Validating {tables.length} source tables</p><p className="mt-1 text-xs text-muted-foreground">Checking schema, relationships, business mappings, KPI readiness, and quality rules.</p></div>}
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    {!result && !loading && !error && <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center"><ShieldCheck className="mx-auto size-8 text-primary" /><p className="mt-3 text-sm font-medium">Ready to validate {tables.length} source tables</p><p className="mt-1 text-xs text-muted-foreground">The run also triggers KPI detection and creates intelligence alerts for missing inputs.</p></div>}
    {result && <><div className="grid gap-3 md:grid-cols-5"><div className="rounded-xl border border-primary/30 bg-primary/5 p-4 md:col-span-1"><span className="text-xs text-muted-foreground">Validation score</span><div className="mt-2 text-3xl font-semibold text-primary">{result.score}<span className="text-sm text-muted-foreground"> / 100</span></div><span className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">{result.status}</span></div><div className="grid grid-cols-2 gap-2 md:col-span-4 md:grid-cols-4">{categoryScores.map((item) => <div key={item.category} className="rounded-xl border border-border bg-card p-3"><span className="text-[10px] text-muted-foreground">{item.category}</span><div className="mt-2 text-xl font-semibold">{item.score}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.score}%` }} /></div></div>)}</div></div>
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]"><div className="rounded-xl border border-border"><div className="border-b border-border px-4 py-3 text-xs font-semibold">Validation checks</div><div className="divide-y divide-border">{result.checks.map((check) => { const Icon = check.status === "pass" ? CheckCircle2 : check.status === "fail" ? XCircle : AlertTriangle; return <div key={check.id} className="flex items-start gap-3 p-3"><Icon className={cn("mt-0.5 size-4 shrink-0", check.status === "pass" ? "text-primary" : check.status === "fail" ? "text-destructive" : "text-chart-5")} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="text-xs font-medium">{check.label}</span><span className="font-mono text-[10px] text-muted-foreground">{check.score}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{check.detail}</p></div></div>})}</div></div><div className="flex flex-col gap-3"><div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 text-xs font-semibold"><Activity className="size-4 text-primary" />KPI readiness</div><p className="mt-3 text-[10px] uppercase text-muted-foreground">Detected</p><div className="mt-2 flex flex-wrap gap-1">{result.detectedKpis.map((kpi) => <span key={kpi} className="rounded bg-primary/10 px-2 py-1 text-[10px] text-primary">{kpi}</span>)}</div><p className="mt-4 text-[10px] uppercase text-muted-foreground">Missing inputs</p><div className="mt-2 flex flex-col gap-1">{result.missingInputs.map((input) => <span key={input} className="text-xs text-chart-5">{input}</span>)}</div></div><div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">Validation profile <span className="font-mono text-foreground">{result.validationId.slice(0, 8)}</span> was sent to KPI Intelligence and Alert Center.</div></div></div></>}
  </div>;
}

export function DatasetLineagePanel({ tables, relationshipCount }: { tables: Array<{ name: string; schema?: string }>; relationshipCount: number }) {
  const nodes = [
    { id: "sources", label: `${tables.length} source tables`, detail: tables.map((table) => table.name).slice(0, 3).join(", ") },
    { id: "relationships", label: `${relationshipCount} relationships`, detail: "Accepted join paths" },
    { id: "validation", label: "Validation profile", detail: "Schema and business rules" },
    { id: "kpi-detection", label: "KPI detection", detail: "ADC, Census, Admissions" },
    { id: "reports-alerts", label: "Reports & alerts", detail: "Impact monitoring" },
  ];
  return <div className="flex flex-col gap-5"><div><h3 className="text-base font-semibold">Dataset Lineage</h3><p className="mt-1 text-xs text-muted-foreground">Trace source tables through validation, KPI detection, reports, and downstream alerts.</p></div><div className="flex flex-col items-stretch gap-2 overflow-x-auto md:flex-row md:items-center">{nodes.map((node, index) => <div key={node.id} className="flex min-w-0 flex-1 items-center gap-2"><div className="min-h-24 min-w-40 flex-1 rounded-xl border border-border bg-card p-3"><span className="text-xs font-semibold text-foreground">{node.label}</span><p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{node.detail || "Awaiting source selection"}</p></div>{index < nodes.length - 1 && <span className="hidden text-primary md:block">→</span>}</div>)}</div><div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground"><strong className="text-foreground">Impact-aware lineage:</strong> schema changes can now be traced into validation failures, missing KPI inputs, dependent metrics, and affected reports.</div></div>;
}
