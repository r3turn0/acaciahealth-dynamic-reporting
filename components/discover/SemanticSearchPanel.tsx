"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Search, X, Sparkles, Database, FileText, Gauge, Bot, BookOpen, ShieldCheck, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetType } from "@/lib/discovery/catalog";
import { orchestrate } from "@/lib/orchestration/requestRegistry";

type Result = { id: string; type: AssetType; kind: "physical" | "virtual"; name: string; description: string; tags: string[]; location: string; related: string[]; score: number; matchedTerms: string[]; owner: string; governanceState: string; certified: boolean; source: string; lineage: string[]; virtualNotice: string | null };
const filters: Array<{ type: AssetType | "all"; label: string }> = [{ type: "all", label: "All" }, { type: "dataset", label: "Datasets" }, { type: "table", label: "Tables" }, { type: "column", label: "Columns" }, { type: "kpi", label: "KPIs" }, { type: "report", label: "Reports" }, { type: "validation", label: "Rules" }, { type: "agent", label: "Agents" }];
const suggestions = ["Admissions KPI", "Revenue by branch", "Where is ADC calculated?", "Show me recert report", "Reports using PatientDays"];
const icons: Partial<Record<AssetType, typeof Database>> = { dataset: Database, table: Database, report: FileText, kpi: Gauge, scorecard: Gauge, agent: Bot, glossary: BookOpen, validation: ShieldCheck };

export interface SemanticSearchPanelProps { onSelectTable?: (tableId: string) => void; initialQuery?: string }
export function SemanticSearchPanel({ onSelectTable, initialQuery = "" }: SemanticSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeType, setActiveType] = useState<AssetType | "all">("all");
  const [results, setResults] = useState<Result[]>([]);
  const [backend, setBackend] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentRef = useRef(0);

  async function search(nextQuery = query, type = activeType) {
    if (!nextQuery.trim()) return;
    const intent = ++intentRef.current;
    setLoading(true); setError(null); setSearched(true);
    try {
      const data = await orchestrate({ scope: "catalog-search", operation: "search", resource: type, params: { query: nextQuery, type }, policy: "latest", timeoutMs: 20_000 }, async (signal) => {
        const response = await fetch("/api/discover/search", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ query: nextQuery, types: type === "all" ? undefined : [type], topK: 20 }) });
        const text = await response.text();
        if (!response.ok || !text) throw new Error("Search service is temporarily unavailable");
        return JSON.parse(text) as { results: Result[]; backend: string };
      });
      if (intent === intentRef.current) { setResults(data.results ?? []); setBackend(data.backend); }
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "StaleRequestError")) return;
      if (intent === intentRef.current) { setError(cause instanceof Error ? cause.message : "Search failed"); setResults([]); }
    } finally { if (intent === intentRef.current) setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void search(); }
  function selectType(type: AssetType | "all") { setActiveType(type); if (searched) void search(query, type); }
  useEffect(() => {
    if (!searched || query.trim().length < 3) return;
    const timer = setTimeout(() => { void search(query, activeType); }, 400);
    return () => clearTimeout(timer);
  // search intentionally follows the latest query/filter intent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeType]);

  return <div className="flex flex-col gap-4">
    <form onSubmit={submit} className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search datasets, KPIs, reports, columns, or ask "Where is ADC calculated?"' className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-24 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" aria-label="Search the data catalog" />
      {query && <button type="button" onClick={() => { setQuery(""); setResults([]); setSearched(false); }} className="absolute right-16 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="size-4" /></button>}
      <button type="submit" disabled={loading || !query.trim()} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{loading ? <Loader2 className="size-4 animate-spin" /> : "Search"}</button>
    </form>
    <div className="flex flex-wrap gap-2" aria-label="Asset type filters">{filters.map(({ type, label }) => <button key={type} type="button" onClick={() => selectType(type)} className={cn("rounded-full border px-3 py-1 text-xs transition", activeType === type ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>{label}</button>)}</div>
    {!searched && <div className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />Ask in business language</div><div className="flex flex-wrap gap-2">{suggestions.map((item) => <button key={item} type="button" onClick={() => { setQuery(item); void search(item); }} className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div></div>}
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {searched && !loading && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{results.length} matching assets</span><span>{backend === "virtual-catalog" ? "Virtual catalog relevance ranking" : "Catalog ranking"}</span></div>}
    <div className="grid gap-2">{results.map((result) => { const Icon = icons[result.type] ?? FileText; return <button type="button" key={result.id} onClick={() => result.type === "table" && onSelectTable?.(result.id)} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-accent/30"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-foreground">{result.name}</strong><span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{result.type === "dataset" && result.kind === "virtual" ? "Semantic Dataset" : result.type}</span>{result.certified && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Certified</span>}<span className="ml-auto font-mono text-[10px] text-primary">{Math.round(result.score * 100)}%</span></span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{result.description}</span><span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>{result.location}</span><span>Owner: {result.owner}</span><span>{result.governanceState}</span></span><span className="mt-1 block text-[10px] text-muted-foreground">Source: {result.source}{result.lineage.length ? ` · Lineage: ${result.lineage.slice(0, 3).join(" → ")}` : ""}</span>{result.virtualNotice && <span className="mt-1 block text-[10px] text-primary">Virtual, non-authoritative cache asset</span>}</span><ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" /></button> })}</div>
    {searched && !loading && results.length === 0 && !error && <div className="rounded-xl border border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">No matching catalog assets. Try a broader business term such as Census, Admissions, Revenue, or Recertification.</div>}
  </div>;
}
