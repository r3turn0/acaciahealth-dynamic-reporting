"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Download, FileJson, Filter as FilterIcon, Loader2, Play, ShieldCheck, Sparkles, Target, TrendingUp, Upload, Wand2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, ReferenceDot, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ChartRenderer } from "./ChartRenderer";
import { computeAggregation } from "@/lib/bi/kpiService";
import { createDataset } from "@/lib/hooks/useBiStore";
import { buildPowerBiExport, buildTimeSeries, profileDataset, suggestDashboard, validateKpiDefinition, type DefinitionValidation, type PortableKpiDefinition } from "@/lib/bi/intelligence";
import { metricKey, metricLabel, type ChartType, type DataRow, type DatasetField, type DatasetSchema, type Filter, type Metric } from "@/lib/bi/types";
import { cn } from "@/lib/utils";

const forecastConfig = { value: { label: "Actual", color: "var(--chart-1)" }, forecast: { label: "Forecast", color: "var(--chart-2)" }, range: { label: "Confidence range", color: "var(--chart-3)" } } satisfies ChartConfig;

export function KpiIntelligenceWorkspace({ dataset, onDatasetCreated }: { dataset: DatasetSchema | null; onDatasetCreated: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [definitions, setDefinitions] = useState<PortableKpiDefinition[]>([]);
  const [validation, setValidation] = useState<DefinitionValidation | null>(null);
  const [approved, setApproved] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [chart, setChart] = useState<ChartType>("bar");
  const [dimension, setDimension] = useState("");
  const [metricField, setMetricField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [drillValue, setDrillValue] = useState<string | null>(null);

  const profile = useMemo(() => dataset ? profileDataset(dataset) : null, [dataset]);
  const suggestion = useMemo(() => dataset ? suggestDashboard(dataset) : null, [dataset]);
  const selectedMetric = metricField || profile?.numericFields[0] || "";
  const selectedDimension = dimension || profile?.dimensionFields[0] || profile?.dateFields[0] || "";
  const metrics = useMemo<Metric[]>(() => selectedMetric ? [{ agg: "sum", field: selectedMetric }] : [{ agg: "count", field: null }], [selectedMetric]);
  const filters = useMemo<Filter[]>(() => filterValue && selectedDimension ? [{ field: selectedDimension, op: "contains", value: filterValue }] : [], [filterValue, selectedDimension]);
  const result = useMemo(() => dataset ? computeAggregation(dataset.sampleData, { metrics, dimensions: selectedDimension ? [selectedDimension] : [], filters }) : null, [dataset, filters, metrics, selectedDimension]);
  const labels = useMemo(() => Object.fromEntries(metrics.map((metric) => [metricKey(metric), metricLabel(metric)])), [metrics]);
  const series = useMemo(() => dataset && profile?.dateFields[0] && selectedMetric ? buildTimeSeries(dataset.sampleData, profile.dateFields[0], selectedMetric) : [], [dataset, profile?.dateFields, selectedMetric]);
  const anomalies = series.filter((point) => point.anomaly);

  async function upload(file?: File) {
    if (!file) return;
    setApproved(false);
    setExecutionError(null);
    try {
      const parsed = JSON.parse(await file.text());
      const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed.kpis) ? parsed.kpis : [parsed];
      const checks: DefinitionValidation[] = candidates.map((candidate: unknown) => validateKpiDefinition(candidate));
      const invalid = checks.find((check) => !check.valid);
      if (invalid) return setValidation(invalid);
      const validDefinitions = checks.flatMap((check) => check.definition ? [check.definition] : []);
      setDefinitions(validDefinitions);
      setValidation({ valid: true, definition: validDefinitions[0], errors: [], warnings: checks.flatMap((check) => check.warnings) });
    } catch {
      setValidation({ valid: false, errors: ["The selected file is not valid JSON."], warnings: [] });
    }
  }

  async function executeDefinition() {
    const definition = validation?.definition;
    if (!definition || !approved) return;
    setExecuting(true);
    setExecutionError(null);
    try {
      const res = await fetch("/api/datasets/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: definition.formulaSql, startDate: definition.dateParameters?.startDate ?? "2026-01-01", endDate: definition.dateParameters?.endDate ?? "2026-12-31" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Query execution failed");
      const rows = (json.rows ?? []) as DataRow[];
      const fields: DatasetField[] = (json.columns ?? Object.keys(rows[0] ?? {})).map((column: string) => ({ name: column, type: inferType(rows.map((row) => row[column])) }));
      if (!fields.length) throw new Error("The approved query returned no columns.");
      const created = await createDataset({ name: `${definition.name} result`, fields, sampleData: rows.slice(0, 5000), source: "manual" });
      if (created) onDatasetCreated(created.id);
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : "Query execution failed");
    } finally { setExecuting(false); }
  }

  function download(name: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!dataset) return <EmptyState inputRef={inputRef} upload={upload} />;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" /></div>
            <div><h2 className="text-base font-semibold text-foreground">KPI Intelligence Layer</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Profile, explain, forecast, and operationalize governed metrics without sending source rows to AI.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={inputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
            <button onClick={() => inputRef.current?.click()} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"><Upload className="h-3.5 w-3.5" />Import KPI JSON</button>
            <button onClick={() => download("kpi-intelligence-model.json", { dataset: { ...dataset, sampleData: undefined }, definitions, profile, dashboard: suggestion })} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"><Download className="h-3.5 w-3.5" />Export model</button>
            <button onClick={() => download("power-bi-portable-model.json", buildPowerBiExport(dataset, [], definitions))} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"><BarChart3 className="h-3.5 w-3.5" />Power BI package</button>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-4 md:divide-y-0">
          <Stat label="Session rows" value={profile!.rowCount.toLocaleString()} detail="not persisted" />
          <Stat label="Data quality" value={`${profile!.qualityScore}%`} detail="average completeness" />
          <Stat label="Detected metrics" value={String(profile!.numericFields.length)} detail="numeric measures" />
          <Stat label="Anomalies" value={String(anomalies.length)} detail="2σ deterministic rule" alert={anomalies.length > 0} />
        </div>
      </section>

      {validation && <DefinitionReview validation={validation} definitions={definitions} approved={approved} setApproved={setApproved} executing={executing} execute={executeDefinition} error={executionError} />}

      <section className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
            <div><p className="text-sm font-semibold text-foreground">Adaptive dashboard</p><p className="mt-1 text-xs text-muted-foreground">Cross-filter the visualization, then select a point to drill into its source slice.</p></div>
            <div className="flex flex-wrap gap-2">
              <select value={selectedMetric} onChange={(e) => setMetricField(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">{profile!.numericFields.map((field) => <option key={field}>{field}</option>)}</select>
              <select value={selectedDimension} onChange={(e) => setDimension(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">{[...profile!.dimensionFields, ...profile!.dateFields].map((field) => <option key={field}>{field}</option>)}</select>
              <select value={chart} onChange={(e) => setChart(e.target.value as ChartType)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option><option value="table">Table</option></select>
            </div>
          </div>
          <div className="mt-4 min-h-72">{result && <ChartRenderer result={result} chart={chart} labels={labels} />}</div>
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
            <FilterIcon className="h-4 w-4 text-muted-foreground" /><input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder={`Cross-filter ${selectedDimension}`} className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground outline-none focus:border-primary" />
            <button onClick={() => setDrillValue(result?.data[0] && selectedDimension ? String(result.data[0][selectedDimension]) : null)} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted">Drill first segment<ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          {drillValue && <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Drill-down:</span> {selectedDimension} = {drillValue}. {dataset.sampleData.filter((row) => String(row[selectedDimension]) === drillValue).length} session rows contribute to this segment.</div>}
        </div>

        <aside className="flex flex-col gap-4">
          <InsightCard icon={Wand2} title="Executive narrative" text={suggestion!.narrative} />
          <InsightCard icon={Target} title="Recommended view" text={`${suggestion!.headline} grouped by ${selectedDimension || "record"}. ${profile!.dateFields.length ? "Time grain supports forecasting." : "Add a date field to enable forecasting."}`} />
          <InsightCard icon={ShieldCheck} title="Privacy boundary" text="Only schema, aggregates, and KPI metadata may be sent to Copilot. Source rows remain in this session." />
        </aside>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4"><div><p className="flex items-center gap-2 text-sm font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-primary" />Forecast & anomaly monitor</p><p className="mt-1 text-xs text-muted-foreground">Moving-average projection with widening confidence bounds; directional, not clinical or financial advice.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Deterministic</span></div>
        {series.length ? <ChartContainer config={forecastConfig} className="mt-5 min-h-72 w-full"><AreaChart data={series}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={30} /><YAxis tickLine={false} axisLine={false} width={48} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="upper" stroke="none" fill="var(--color-range)" fillOpacity={0.12} /><Area dataKey="lower" stroke="none" fill="var(--background)" /><Line dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} connectNulls={false} /><Line dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />{series.filter((point) => point.anomaly).map((point) => <ReferenceDot key={point.label} x={point.label} y={point.value} r={5} fill="var(--destructive)" stroke="var(--background)" />)}</AreaChart></ChartContainer> : <div className="mt-5 flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">A date and numeric field are required for forecasting.</div>}
      </section>
    </div>
  );
}

function Stat({ label, value, detail, alert }: { label: string; value: string; detail: string; alert?: boolean }) { return <div className="p-4"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p><p className={cn("mt-1 text-xl font-semibold tabular-nums", alert ? "text-destructive" : "text-foreground")}>{value}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p></div>; }
function InsightCard({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) { return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Icon className="h-4 w-4 text-primary" />{title}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{text}</p></div>; }
function EmptyState({ inputRef, upload }: { inputRef: React.RefObject<HTMLInputElement | null>; upload: (file?: File) => void }) { return <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center"><FileJson className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-sm font-semibold text-foreground">Create or select a dataset</h2><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">The Intelligence Layer profiles an active BI dataset. You can also import a governed KPI JSON definition now.</p><input ref={inputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} /><button onClick={() => inputRef.current?.click()} className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">Import KPI JSON</button></div>; }
function DefinitionReview({ validation, definitions, approved, setApproved, executing, execute, error }: { validation: DefinitionValidation; definitions: PortableKpiDefinition[]; approved: boolean; setApproved: (value: boolean) => void; executing: boolean; execute: () => void; error: string | null }) { return <section className="rounded-xl border border-border bg-card p-5"><div className="flex items-start gap-3">{validation.valid ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />}<div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{validation.valid ? `${definitions.length} KPI definition${definitions.length === 1 ? "" : "s"} validated` : "Definition requires correction"}</p>{validation.errors.map((item) => <p key={item} className="mt-1 text-xs text-destructive">{item}</p>)}{validation.warnings.map((item) => <p key={item} className="mt-1 text-xs text-muted-foreground">Warning: {item}</p>)}{validation.definition && <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-foreground">{validation.definition.formulaSql}</pre>}<label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} disabled={!validation.valid} className="mt-0.5" /><span>I reviewed this read-only SQL and approve one bounded execution through the governed query gateway.</span></label>{error && <p className="mt-2 text-xs text-destructive">{error}</p>}</div><button onClick={execute} disabled={!validation.valid || !approved || executing} className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40">{executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Execute</button></div></section>; }
function inferType(values: unknown[]): DatasetField["type"] { const sample = values.find((value) => value !== null && value !== undefined); if (typeof sample === "number") return "number"; if (typeof sample === "boolean") return "boolean"; if (sample && !Number.isNaN(Date.parse(String(sample))) && /[-/:T]/.test(String(sample))) return "date"; return "string"; }
