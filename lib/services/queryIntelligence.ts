import semanticLayer from "@/lib/config/semanticLayer.json";
import type { QueryMemory } from "@/lib/services/queryHistoryStore";
import { validateQuery } from "@/lib/services/queryGuard";

export type IntelligenceSource = "saved_report" | "dataset" | "query_memory" | "generated";

export interface IntelligenceCandidate {
  id: string;
  source: Exclude<IntelligenceSource, "generated">;
  name: string;
  description: string;
  sql: string | null;
  tags: string[];
  kpi?: string;
  version: number;
  successRate: number;
  avgExecutionMs: number;
  updatedAt: string;
}

export interface IntelligenceMatch {
  source: IntelligenceSource;
  candidate: IntelligenceCandidate | null;
  sql: string | null;
  similarity: number;
  reusable: boolean;
  rationale: string[];
}

export const HEALTHCARE_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(semanticLayer.terminology).map(([canonical, definition]) => [canonical, definition.aliases])
);

const STOP_WORDS = new Set(["a", "an", "and", "by", "for", "from", "in", "me", "of", "on", "please", "show", "the", "to", "with"]);

export function normalizeIntelligenceRequest(value: string): string {
  let normalized = value.toLowerCase();
  for (const [canonical, aliases] of Object.entries(HEALTHCARE_ALIASES)) {
    for (const alias of aliases.sort((a, b) => b.length - a.length)) {
      normalized = normalized.replace(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), canonical);
    }
  }
  return normalized.replace(/[^a-z0-9_]+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeIntelligenceRequest(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

export function requestSimilarity(request: string, candidateText: string): number {
  const left = tokens(request);
  const right = tokens(candidateText);
  if (left.size === 0 || right.size === 0) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const coverage = overlap / left.size;
  const jaccard = overlap / union;
  return Math.min(1, coverage * 0.7 + jaccard * 0.3);
}

function memoryCandidate(memory: QueryMemory): IntelligenceCandidate {
  return {
    id: memory.id,
    source: "query_memory",
    name: memory.normalized_request,
    description: `Successful query memory with ${memory.versions.length} version(s)`,
    sql: memory.final_success_query,
    tags: [...memory.semantic_keywords, ...memory.source_tables],
    version: memory.versions.length,
    successRate: memory.success_rate,
    avgExecutionMs: memory.avg_execution_ms,
    updatedAt: memory.last_used_at,
  };
}

export async function loadIntelligenceCandidates(): Promise<IntelligenceCandidate[]> {
  const [{ listReports }, { listDatasets }, { getQueryMemories }] = await Promise.all([
    import("@/lib/services/reportService"),
    import("@/lib/bi/datasetService"),
    import("@/lib/services/queryHistoryStore"),
  ]);
  const [reports, memories] = await Promise.all([listReports(), getQueryMemories()]);
  const reportCandidates: IntelligenceCandidate[] = reports
    .filter((report) => report.status === "published")
    .map((report) => ({
      id: report.id,
      source: "saved_report",
      name: report.name,
      description: `${report.description} ${report.prompt}`.trim(),
      sql: report.sql,
      tags: report.tags,
      kpi: report.kpi,
      version: report.version,
      successRate: report.run_count > 0 ? 1 : 0.8,
      avgExecutionMs: 0,
      updatedAt: report.last_run_date ?? report.created_date,
    }));
  const datasetCandidates: IntelligenceCandidate[] = listDatasets().map((dataset) => ({
    id: dataset.id,
    source: "dataset",
    name: dataset.name,
    description: `Dataset fields: ${dataset.fields.map((field) => field.name).join(", ")}`,
    sql: null,
    tags: dataset.fields.map((field) => field.name),
    version: dataset.version,
    successRate: 1,
    avgExecutionMs: 0,
    updatedAt: dataset.updatedDate,
  }));
  return [...reportCandidates, ...datasetCandidates, ...memories.map(memoryCandidate)];
}

const SOURCE_PRIORITY: Record<IntelligenceCandidate["source"], number> = {
  saved_report: 0.08,
  dataset: 0.03,
  query_memory: 0.05,
};

export async function resolveQueryIntelligence(
  request: string,
  options: { candidates?: IntelligenceCandidate[]; threshold?: number } = {}
): Promise<IntelligenceMatch> {
  const candidates = options.candidates ?? await loadIntelligenceCandidates();
  const threshold = options.threshold ?? 0.72;
  const ranked = candidates.map((candidate) => {
    const text = [candidate.name, candidate.description, candidate.kpi, ...candidate.tags].filter(Boolean).join(" ");
    const semantic = requestSimilarity(request, text);
    const reliability = Math.min(1, Math.max(0, candidate.successRate));
    const score = Math.min(1, semantic * 0.84 + reliability * 0.08 + SOURCE_PRIORITY[candidate.source]);
    return { candidate, semantic, score };
  }).sort((a, b) => b.score - a.score || SOURCE_PRIORITY[b.candidate.source] - SOURCE_PRIORITY[a.candidate.source]);

  const best = ranked[0];
  if (!best) {
    return { source: "generated", candidate: null, sql: null, similarity: 0, reusable: false, rationale: ["No report, dataset, or query-memory candidates were available"] };
  }

  const guard = best.candidate.sql ? validateQuery(best.candidate.sql) : { valid: false, errors: ["Candidate defines a dataset but not executable SQL"] };
  const reusable = best.score >= threshold && Boolean(best.candidate.sql) && guard.valid;
  return {
    source: reusable ? best.candidate.source : "generated",
    candidate: best.candidate,
    sql: reusable ? best.candidate.sql : null,
    similarity: Number(best.score.toFixed(4)),
    reusable,
    rationale: [
      `${best.candidate.source} ranked first from ${candidates.length} candidate(s)`,
      `semantic similarity ${best.semantic.toFixed(3)}; confidence ${best.score.toFixed(3)}; threshold ${threshold.toFixed(2)}`,
      ...(guard.valid ? ["SQL passed the governed read-only query guard"] : guard.errors),
    ],
  };
}
