"use client";

/**
 * SemanticSearchPanel
 *
 * Full hybrid search UI for Discover Data.  Features:
 *   - Hybrid scoring: exact_match (1.0) + synonym_match (0.85) + semantic TF-IDF (0.75)
 *   - Query expansion with healthcare synonym display
 *   - Confidence score badge per result
 *   - Term highlighting in table name and description
 *   - Relationship-aware results (shows linked tables)
 *   - Tag-category filter chips (incremental, as-you-type)
 *   - Zero-result guidance with suggested queries
 *   - Observability logging on every search + result selection
 *
 * Accepted queries (spec):
 *   census, adc, average daily census, occupancy, occupied beds,
 *   admissions, discharge trends, facility census by month,
 *   demographic analysis, …
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  ChevronRight,
  Share2,
  Sparkles,
  AlertCircle,
  Tag,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hybridSearch,
  getOrBuildIndex,
  expandQuery,
  highlightText,
  type SearchResult,
  type HighlightSegment,
} from "@/lib/agents/tfidfEngine";
import { getCachedModel } from "@/lib/schema/engine";
import { logSearch }      from "@/lib/services/observabilityStore";
import { recordQuery }    from "@/lib/agents/queryLearner";
import thesaurus          from "@/lib/config/healthcareThesaurus.json";

// ── Suggested starter queries ─────────────────────────────────────────────────

const SUGGESTED_QUERIES: string[] = [
  "census",
  "adc",
  "average daily census",
  "occupied beds",
  "admissions",
  "discharge trends",
  "facility census by month",
  "demographic analysis",
  "resident demographics",
  "monthly occupancy trends",
];

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const cls  = pct >= 80
    ? "bg-chart-3/15 text-chart-3 border-chart-3/30"
    : pct >= 50
    ? "bg-chart-5/15 text-chart-5 border-chart-5/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border shrink-0", cls)}>
      {pct}%
    </span>
  );
}

// ── Score breakdown bar ───────────────────────────────────────────────────────

function ScoreBar({ label, value, max = 1, color }: {
  label: string;
  value: number;
  max?:  number;
  color: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-mono text-muted-foreground">{pct}</span>
    </div>
  );
}

// ── Highlighted text renderer ─────────────────────────────────────────────────

function HighlightedText({ segments }: { segments: HighlightSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight
          ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

// ── Tag chip ──────────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  admissions:   "bg-blue-500/10   text-blue-600   border-blue-500/30",
  service_lines:"bg-purple-500/10 text-purple-600 border-purple-500/30",
  kpi:          "bg-chart-3/15   text-chart-3    border-chart-3/30",
  care_types:   "bg-orange-500/10 text-orange-600 border-orange-500/30",
  patient_notes:"bg-teal-500/10   text-teal-600   border-teal-500/30",
  billing:      "bg-yellow-500/10 text-yellow-700  border-yellow-500/30",
  clinical:     "bg-red-500/10    text-red-600    border-red-500/30",
  quality:      "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  referrals:    "bg-pink-500/10   text-pink-600   border-pink-500/30",
  staff:        "bg-cyan-500/10   text-cyan-600   border-cyan-500/30",
  pharmacy:     "bg-amber-500/10  text-amber-700  border-amber-500/30",
  compliance:   "bg-slate-500/10  text-slate-600  border-slate-500/30",
};

function TagChip({ tagId, active, onClick }: {
  tagId:   string;
  active:  boolean;
  onClick: () => void;
}) {
  const tags = thesaurus.tags as Record<string, { label: string }>;
  const label = tags[tagId]?.label ?? tagId;
  const base  = TAG_COLORS[tagId] ?? "bg-muted text-muted-foreground border-border";
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[10px] font-medium px-2 py-0.5 rounded border transition-all",
        active ? base + " ring-1 ring-current" : "border-border text-muted-foreground bg-transparent hover:bg-accent/40"
      )}
    >
      {label}
    </button>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({
  result,
  tableName,
  tableDescription,
  relatedTableNames,
  queryTokens,
  onSelect,
}: {
  result:             SearchResult;
  tableName:          string;
  tableDescription?:  string;
  relatedTableNames:  string[];
  queryTokens:        string[];
  onSelect:           (id: string) => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const nameSeg  = highlightText(tableName,          queryTokens);
  const descSeg  = tableDescription
    ? highlightText(tableDescription.slice(0, 140), queryTokens)
    : null;

  return (
    <div
      className="flex flex-col gap-2 bg-card border border-border rounded-lg px-3 py-2.5 hover:border-primary/40 transition-colors cursor-pointer group"
      onClick={() => onSelect(result.tableId)}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground font-mono truncate">
              <HighlightedText segments={nameSeg} />
            </span>
            <ConfidenceBadge score={result.confidenceScore} />
          </div>
          {descSeg && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
              <HighlightedText segments={descSeg} />
            </p>
          )}
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
      </div>

      {/* Tag chips */}
      {result.matchedTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
          {result.matchedTags.slice(0, 4).map((t) => (
            <TagChip key={t} tagId={t} active={false} onClick={(e) => { (e as unknown as Event).stopPropagation?.(); }} />
          ))}
        </div>
      )}

      {/* Synonym expansion display */}
      {result.matchedSynonyms.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap">
          <Sparkles className="w-3 h-3 text-primary/60 shrink-0" />
          <span className="text-primary/70 font-medium">Synonym match:</span>
          {result.matchedSynonyms.slice(0, 5).map((s, i) => (
            <span key={i} className="bg-primary/5 border border-primary/20 rounded px-1">{s}</span>
          ))}
        </div>
      )}

      {/* Relationship-aware related tables */}
      {relatedTableNames.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap">
          <Share2 className="w-3 h-3 shrink-0" />
          <span className="font-medium">Related:</span>
          {relatedTableNames.slice(0, 3).map((n, i) => (
            <span key={i} className="font-mono">{n}{i < Math.min(2, relatedTableNames.length - 1) ? "," : ""}</span>
          ))}
        </div>
      )}

      {/* Score breakdown (expandable) */}
      <button
        className="text-[10px] text-muted-foreground hover:text-foreground text-left"
        onClick={(e) => { e.stopPropagation(); setShowBreakdown((o) => !o); }}
      >
        {showBreakdown ? "Hide" : "Show"} score breakdown
      </button>
      {showBreakdown && (
        <div className="flex flex-col gap-1 bg-muted/30 rounded-lg p-2 border border-border/60">
          <ScoreBar label="Exact match"  value={result.scoreBreakdown.exactMatch}         color="bg-chart-3" />
          <ScoreBar label="Synonym"      value={result.scoreBreakdown.synonymMatch}        color="bg-chart-5" />
          <ScoreBar label="Semantic"     value={result.scoreBreakdown.semanticSimilarity}  color="bg-primary" />
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface SemanticSearchPanelProps {
  onSelectTable?: (tableId: string) => void;
  /** If provided, panel uses this model instead of the cached model */
  initialQuery?:  string;
}

export function SemanticSearchPanel({ onSelectTable, initialQuery = "" }: SemanticSearchPanelProps) {
  const [query,         setQuery]         = useState(initialQuery);
  const [results,       setResults]       = useState<SearchResult[]>([]);
  const [expansion,     setExpansion]     = useState<ReturnType<typeof expandQuery> | null>(null);
  const [activeTag,     setActiveTag]     = useState<string | null>(null);
  const [searched,      setSearched]      = useState(false);
  const [durationMs,    setDurationMs]    = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback((q: string) => {
    const model = getCachedModel();
    if (!model || !q.trim()) {
      setResults([]);
      setExpansion(null);
      setSearched(false);
      return;
    }

    const t0     = performance.now();
    const index  = getOrBuildIndex(model);
    const hits   = hybridSearch(q, index, model, 30);
    const dur    = Math.round(performance.now() - t0);
    const exp    = expandQuery(q);

    setResults(hits);
    setExpansion(exp);
    setDurationMs(dur);
    setSearched(true);

    // Observability log
    logSearch({
      query,
      resultCount:     hits.length,
      zeroResults:     hits.length === 0,
      topTableId:      hits[0]?.tableId,
      confidenceScore: hits[0]?.confidenceScore,
      durationMs:      dur,
      synonymsUsed:    exp.matchedSynonymGroups.map((g) => g.canonical),
    });
  }, [query]);

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => runSearch(query), 220);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  // Run on mount if initialQuery provided
  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered results by active tag
  const visibleResults = activeTag
    ? results.filter((r) => r.matchedTags.includes(activeTag))
    : results;

  // All unique tags across results
  const allTags = Array.from(new Set(results.flatMap((r) => r.matchedTags)));

  const model = getCachedModel();

  function handleSelect(tableId: string) {
    const table = model?.tables[tableId];
    if (table) {
      recordQuery(query, [tableId], results.find((r) => r.tableId === tableId)?.matchedTags ?? []);
    }
    onSelectTable?.(tableId);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Try "census", "adc", "admissions by facility"…'
          className="w-full pl-9 pr-8 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setSearched(false); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Synonym expansion display */}
      {expansion && expansion.matchedSynonymGroups.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
          <Sparkles className="w-3 h-3 text-primary shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-primary">Query expanded with healthcare synonyms</span>
            {expansion.matchedSynonymGroups.slice(0, 3).map((g, i) => (
              <div key={i} className="flex items-center gap-1 flex-wrap">
                <span className="text-foreground font-mono">{g.canonical}</span>
                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                {g.synonyms.slice(0, 5).map((s, j) => (
                  <span key={j} className="bg-primary/10 rounded px-1">{s}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tag filter chips */}
      {allTags.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Filter:</span>
          {allTags.map((t) => (
            <TagChip
              key={t}
              tagId={t}
              active={activeTag === t}
              onClick={() => setActiveTag((cur) => cur === t ? null : t)}
            />
          ))}
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="flex flex-col gap-2">
          {/* Result count + timing */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {visibleResults.length === 0
                ? "No results"
                : `${visibleResults.length} result${visibleResults.length !== 1 ? "s" : ""}`}
              {activeTag && ` in "${(thesaurus.tags as Record<string, { label: string }>)[activeTag]?.label ?? activeTag}"`}
            </span>
            <span>{durationMs}ms</span>
          </div>

          {/* Zero-result guidance */}
          {visibleResults.length === 0 && (
            <div className="flex flex-col gap-3 bg-muted/30 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>No tables matched <span className="font-mono text-foreground">&ldquo;{query}&rdquo;</span>. Try one of these:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuery(q)}
                    className="text-[11px] px-2 py-1 rounded border border-border bg-background hover:bg-accent/40 hover:border-primary/30 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Result cards */}
          {visibleResults.map((r) => {
            const table    = model?.tables[r.tableId];
            const related  = r.relatedTableIds
              .map((id) => model?.tables[id]?.name ?? id.split(".").pop() ?? id)
              .filter(Boolean)
              .slice(0, 3);
            return (
              <ResultCard
                key={r.tableId}
                result={r}
                tableName={table?.name ?? r.tableId.split(".").pop() ?? r.tableId}
                tableDescription={table?.description}
                relatedTableNames={related}
                queryTokens={expansion?.originalTokens ?? []}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}

      {/* Starter suggestions (before any search) */}
      {!searched && !query && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">Suggested searches:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="text-[11px] px-2.5 py-1 rounded border border-border bg-background hover:bg-accent/40 hover:border-primary/30 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
