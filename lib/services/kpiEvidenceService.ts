import "server-only";

import { createHash } from "node:crypto";
import { queryMultiple, isConfigured, type QueryResultSet } from "@/lib/db/readOnlyClient";
import { validateReadOnlySql } from "@/lib/services/queryGuard";
import { getLatestSnapshot, listReports, type DatasetSnapshot, type SavedReport } from "@/lib/services/reportService";
import { resolveKpiDependencyGraph, type ResolvedKpiGraph } from "@/lib/config/kpiDependencyGraph";

const MAX_REPORTS = 5;
const MAX_CONCURRENCY = 2;
const MAX_ROWS_PER_SET = 12;
const MAX_FIELDS = 12;
const TIMEOUT_MS = 15_000;
const IDENTIFIER_PATTERN = /(^|_)(patient|episode|client|person|member)?_?(id|mrn|ssn|name|address|phone|email|dob)(_|$)/i;

export type EvidenceFailureCategory = "unsafe-sql" | "timeout" | "execution" | "empty-result";
export type EvidenceWindow = "current" | "prior";

export interface EvidenceReportSelection {
  report: SavedReport;
  nodeKey: string;
  score: number;
  reasons: string[];
}

export interface CompactResultSet {
  citationId: string;
  columns: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  numericSummary: Record<string, { total: number; average: number; min: number; max: number; nonNull: number }>;
  completeness: number;
}

export interface KpiReportEvidence {
  reportId: string;
  reportName: string;
  reportVersion: number;
  nodeKey: string;
  source: "live" | "cache";
  status: "success" | "failed";
  matchReasons: string[];
  executionMs: number;
  dateRange: { startDate: string; endDate: string };
  window: EvidenceWindow;
  resultSets: CompactResultSet[];
  executedAt?: string;
  dataAgeMs?: number | null;
  validationStatus?: "virtual-certified" | "validated";
  fallbackReason?: string | null;
  failureCategory?: EvidenceFailureCategory;
  error?: string;
}

export interface KpiEvidenceBundle {
  graph: ResolvedKpiGraph;
  evidence: KpiReportEvidence[];
  uncoveredNodes: string[];
  failedNodes: string[];
  coverage: number;
  reportSuccessRate: number;
  mode: "live" | "cached" | "partial" | "fallback";
  generatedAt: string;
}

export interface KpiComparativeEvidence {
  current: KpiEvidenceBundle;
  prior: KpiEvidenceBundle;
  windows: {
    current: { startDate: string; endDate: string };
    prior: { startDate: string; endDate: string };
  };
}

interface EvidenceDependencies {
  listReports: typeof listReports;
  getLatestSnapshot: typeof getLatestSnapshot;
  queryMultiple: typeof queryMultiple;
  isConfigured: typeof isConfigured;
  now: () => number;
  timeoutMs: number;
  maxConcurrency: number;
}

const productionDependencies: EvidenceDependencies = {
  listReports,
  getLatestSnapshot,
  queryMultiple,
  isConfigured,
  now: Date.now,
  timeoutMs: TIMEOUT_MS,
  maxConcurrency: MAX_CONCURRENCY,
};

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((token) => token.length > 2));
}

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.max(a.size, b.size);
}

export function rankSupportingReports(graph: ResolvedKpiGraph, reports: SavedReport[]): EvidenceReportSelection[] {
  const ranked: EvidenceReportSelection[] = [];
  for (const node of graph.nodes) {
    for (const report of reports) {
      if (report.status !== "published" || !report.sql.trim()) continue;
      const reasons: string[] = [];
      let score = 0;
      if (node.reportKpis.includes(report.kpi)) { score += 100; reasons.push(`exact governed KPI: ${report.kpi}`); }
      if (report.kpi === node.key) { score += 80; reasons.push("exact dependency KPI"); }
      if (report.created_by === "system" || report.tags.includes("canonical")) { score += 40; reasons.push("virtually KPI-certified published report"); }
      if (report.created_by === "system") { score += 20; reasons.push("system-owned canonical report"); }
      if (report.tags.includes("canonical")) { score += 15; reasons.push("canonical tag"); }
      const searchable = `${report.name} ${report.description} ${report.prompt} ${report.tags.join(" ")}`;
      const aliasSimilarity = Math.max(...node.aliases.map((alias) => overlap(alias, searchable)));
      if (aliasSimilarity > 0) { score += aliasSimilarity * 25; reasons.push(`alias similarity ${(aliasSimilarity * 100).toFixed(0)}%`); }
      const formulaSimilarity = overlap(node.formula, searchable);
      if (formulaSimilarity > 0) { score += formulaSimilarity * 10; reasons.push("formula component match"); }
      if (report.last_run_date) { score += 3; reasons.push("previously executed"); }
      if (score >= 25) ranked.push({ report, nodeKey: node.key, score, reasons });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || b.report.version - a.report.version || a.report.id.localeCompare(b.report.id));
}

export function selectTopGovernedReports(ranked: EvidenceReportSelection[], maxReports = MAX_REPORTS): EvidenceReportSelection[] {
  const selected: EvidenceReportSelection[] = [];
  const covered = new Set<string>();
  const sqlHashes = new Set<string>();
  for (const candidate of ranked) {
    const hash = createHash("sha256").update(candidate.report.sql).digest("hex");
    if (covered.has(candidate.nodeKey) || sqlHashes.has(hash)) continue;
    selected.push(candidate);
    covered.add(candidate.nodeKey);
    sqlHashes.add(hash);
    if (selected.length >= maxReports) break;
  }
  return selected;
}

function safeCell(column: string, value: unknown): unknown {
  if (IDENTIFIER_PATTERN.test(column)) return "[redacted]";
  if (typeof value === "string") return value.slice(0, 120);
  return value;
}

export function compactResultSet(resultSet: QueryResultSet, citationId: string): CompactResultSet {
  const safeColumns = resultSet.columns.filter((column) => !IDENTIFIER_PATTERN.test(column)).slice(0, MAX_FIELDS);
  const sampleRows = resultSet.rows.slice(0, MAX_ROWS_PER_SET).map((row) => Object.fromEntries(
    safeColumns.map((column) => [column, safeCell(column, row[column])])
  ));
  const numericSummary: CompactResultSet["numericSummary"] = {};
  let populated = 0;
  let totalCells = 0;
  for (const column of safeColumns) {
    const values = resultSet.rows.map((row) => row[column]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    totalCells += resultSet.rows.length;
    populated += resultSet.rows.filter((row) => row[column] !== null && row[column] !== undefined).length;
    if (values.length) numericSummary[column] = {
      total: values.reduce((sum, value) => sum + value, 0),
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values), max: Math.max(...values), nonNull: values.length,
    };
  }
  return { citationId, columns: safeColumns, rowCount: resultSet.rowCount, sampleRows, numericSummary, completeness: totalCells ? populated / totalCells : 0 };
}

function snapshotMatches(snapshot: DatasetSnapshot | null, report: SavedReport, startDate: string, endDate: string): boolean {
  if (!snapshot || (snapshot.expires_at && Date.parse(snapshot.expires_at) <= Date.now())) return false;
  const definition = snapshot.query_definition;
  return definition.reportVersion === report.version && definition.startDate === startDate && definition.endDate === endDate;
}

function classifyFailure(error: unknown): EvidenceFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/read.?only|unsafe|rejected sql|\b(delete|update|insert|drop|alter|truncate|exec)\b/i.test(message)) return "unsafe-sql";
  if (/abort|timeout|timed out/i.test(message)) return "timeout";
  return "execution";
}

async function executeSelection(selection: EvidenceReportSelection, startDate: string, endDate: string, window: EvidenceWindow, deps: EvidenceDependencies): Promise<KpiReportEvidence> {
  const started = deps.now();
  const executedAt = new Date(started).toISOString();
  const validationStatus = selection.report.status === "published" && (selection.report.created_by === "system" || selection.report.tags.includes("canonical"))
    ? "virtual-certified" as const
    : "validated" as const;
  const base = { reportId: selection.report.id, reportName: selection.report.name, reportVersion: selection.report.version, nodeKey: selection.nodeKey, matchReasons: selection.reasons, dateRange: { startDate, endDate }, window, executedAt, validationStatus };
  try {
    const guarded = validateReadOnlySql(selection.report.sql);
    if (!guarded.valid) throw new Error(`Unsafe SQL: ${guarded.errors.join("; ")}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Report evidence query timed out")), deps.timeoutMs);
    try {
      const result = await deps.queryMultiple(selection.report.sql, { StartDate: startDate, EndDate: endDate }, controller.signal);
      const populated = result.resultSets.filter((set) => set.rowCount > 0);
      if (populated.length === 0) throw new Error("Empty result set");
      return { ...base, source: "live", status: "success", executionMs: deps.now() - started, dataAgeMs: 0, fallbackReason: null, resultSets: populated.map((set, index) => compactResultSet(set, `${window}:${selection.report.id}:${index + 1}`)) };
    } finally { clearTimeout(timeout); }
  } catch (liveError) {
    const liveMessage = liveError instanceof Error ? liveError.message : String(liveError);
    const snapshot = await deps.getLatestSnapshot(selection.report.id).catch(() => null);
    if (snapshotMatches(snapshot, selection.report, startDate, endDate) && snapshot!.row_count > 0) {
      const set = { columns: snapshot!.columns, rows: snapshot!.rows, rowCount: snapshot!.row_count };
      return {
        ...base, source: "cache", status: "success", executionMs: deps.now() - started,
        executedAt: snapshot!.created_at, dataAgeMs: Math.max(0, deps.now() - Date.parse(snapshot!.created_at)),
        fallbackReason: `Live execution failed: ${liveMessage.slice(0, 160)}`,
        resultSets: [compactResultSet(set, `${window}:${selection.report.id}:1`)],
      };
    }
    return { ...base, source: "live", status: "failed", executionMs: deps.now() - started, dataAgeMs: null, fallbackReason: null, resultSets: [], failureCategory: /empty result/i.test(liveMessage) ? "empty-result" : classifyFailure(liveError), error: liveMessage.slice(0, 240) };
  }
}

async function mapBounded<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

function buildBundle(graph: ResolvedKpiGraph, selected: EvidenceReportSelection[], evidence: KpiReportEvidence[], now: number): KpiEvidenceBundle {
  const selectedNodes = new Set(selected.map((item) => item.nodeKey));
  const uncoveredNodes = graph.nodes.filter((node) => !selectedNodes.has(node.key)).map((node) => node.key);
  const successful = evidence.filter((item) => item.status === "success");
  const failedNodes = [...new Set(evidence.filter((item) => item.status === "failed").map((item) => item.nodeKey))];
  const required = new Set([graph.root.key, ...graph.requiredKeys]);
  const successfulNodes = new Set(successful.map((item) => item.nodeKey));
  const coverage = required.size ? [...required].filter((key) => successfulNodes.has(key)).length / required.size : 0;
  const sources = new Set(successful.map((item) => item.source));
  const mode = successful.length === 0 ? "fallback" : failedNodes.length || uncoveredNodes.some((node) => required.has(node)) ? "partial" : sources.size === 1 && sources.has("cache") ? "cached" : "live";
  return { graph, evidence, uncoveredNodes, failedNodes, coverage, reportSuccessRate: evidence.length ? successful.length / evidence.length : 0, mode, generatedAt: new Date(now).toISOString() };
}

function priorPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const priorEnd = new Date(start.getTime() - 86_400_000);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86_400_000);
  return { startDate: priorStart.toISOString().slice(0, 10), endDate: priorEnd.toISOString().slice(0, 10) };
}

async function collectWindow(graph: ResolvedKpiGraph, selected: EvidenceReportSelection[], range: { startDate: string; endDate: string }, window: EvidenceWindow, deps: EvidenceDependencies): Promise<KpiEvidenceBundle> {
  if (!deps.isConfigured() || selected.length === 0) return buildBundle(graph, selected, [], deps.now());
  const evidence = await mapBounded(selected, deps.maxConcurrency, (selection) => executeSelection(selection, range.startDate, range.endDate, window, deps));
  return buildBundle(graph, selected, evidence, deps.now());
}

export async function collectKpiEvidence(kpiKey: string, startDate: string, endDate: string, overrides: Partial<EvidenceDependencies> = {}): Promise<KpiEvidenceBundle | null> {
  const graph = resolveKpiDependencyGraph(kpiKey);
  if (!graph) return null;
  const deps = { ...productionDependencies, ...overrides };
  const selected = selectTopGovernedReports(rankSupportingReports(graph, await deps.listReports()));
  return collectWindow(graph, selected, { startDate, endDate }, "current", deps);
}

export async function collectComparativeKpiEvidence(kpiKey: string, startDate: string, endDate: string, overrides: Partial<EvidenceDependencies> = {}): Promise<KpiComparativeEvidence | null> {
  const graph = resolveKpiDependencyGraph(kpiKey);
  if (!graph) return null;
  const deps = { ...productionDependencies, ...overrides };
  const selected = selectTopGovernedReports(rankSupportingReports(graph, await deps.listReports()));
  const currentRange = { startDate, endDate };
  const priorRange = priorPeriod(startDate, endDate);
  const [current, prior] = await Promise.all([
    collectWindow(graph, selected, currentRange, "current", deps),
    collectWindow(graph, selected, priorRange, "prior", deps),
  ]);
  return { current, prior, windows: { current: currentRange, prior: priorRange } };
}
