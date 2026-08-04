import "server-only";

import { createHash } from "node:crypto";
import { queryMultiple, isConfigured, type QueryResultSet } from "@/lib/db/readOnlyClient";
import { validateReadOnlySql } from "@/lib/services/queryGuard";
import { getLatestSnapshot, listReports, type SavedReport } from "@/lib/services/reportService";
import { resolveKpiDependencyGraph, type ResolvedKpiGraph } from "@/lib/config/kpiDependencyGraph";

const MAX_REPORTS = 5;
const MAX_ROWS_PER_SET = 12;
const MAX_FIELDS = 12;
const TIMEOUT_MS = 15_000;
const IDENTIFIER_PATTERN = /(^|_)(patient|episode|client|person|member)?_?(id|mrn|ssn|name|address|phone|email|dob)(_|$)/i;

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
  resultSets: CompactResultSet[];
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
      if (report.created_by === "system") { score += 20; reasons.push("system-owned canonical report"); }
      if (report.tags.includes("canonical")) { score += 15; reasons.push("canonical tag"); }
      const aliasSimilarity = Math.max(...node.aliases.map((alias) => overlap(alias, `${report.name} ${report.description} ${report.tags.join(" ")}`)));
      if (aliasSimilarity > 0) { score += aliasSimilarity * 25; reasons.push(`alias similarity ${(aliasSimilarity * 100).toFixed(0)}%`); }
      if (score >= 25) ranked.push({ report, nodeKey: node.key, score, reasons });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || b.report.version - a.report.version);
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

function snapshotMatches(snapshot: Awaited<ReturnType<typeof getLatestSnapshot>>, report: SavedReport, startDate: string, endDate: string): boolean {
  if (!snapshot || (snapshot.expires_at && Date.parse(snapshot.expires_at) <= Date.now())) return false;
  const definition = snapshot.query_definition;
  return definition.reportVersion === report.version && definition.startDate === startDate && definition.endDate === endDate;
}

async function executeSelection(selection: EvidenceReportSelection, startDate: string, endDate: string): Promise<KpiReportEvidence> {
  const started = Date.now();
  const base = { reportId: selection.report.id, reportName: selection.report.name, reportVersion: selection.report.version, nodeKey: selection.nodeKey, matchReasons: selection.reasons, dateRange: { startDate, endDate } };
  try {
    const guarded = validateReadOnlySql(selection.report.sql);
    if (!guarded.valid) throw new Error(guarded.errors.join("; "));
    const snapshot = await getLatestSnapshot(selection.report.id);
    if (snapshotMatches(snapshot, selection.report, startDate, endDate)) {
      const set = { columns: snapshot!.columns, rows: snapshot!.rows, rowCount: snapshot!.row_count };
      return { ...base, source: "cache", status: "success", executionMs: Date.now() - started, resultSets: [compactResultSet(set, `${selection.report.id}:1`)] };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Report evidence query timed out")), TIMEOUT_MS);
    try {
      const result = await queryMultiple(selection.report.sql, { StartDate: startDate, EndDate: endDate }, controller.signal);
      return { ...base, source: "live", status: "success", executionMs: Date.now() - started, resultSets: result.resultSets.map((set, index) => compactResultSet(set, `${selection.report.id}:${index + 1}`)) };
    } finally { clearTimeout(timeout); }
  } catch (error) {
    return { ...base, source: "live", status: "failed", executionMs: Date.now() - started, resultSets: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function collectKpiEvidence(kpiKey: string, startDate: string, endDate: string): Promise<KpiEvidenceBundle | null> {
  const graph = resolveKpiDependencyGraph(kpiKey);
  if (!graph) return null;
  const reports = await listReports();
  const selected = selectTopGovernedReports(rankSupportingReports(graph, reports));
  const covered = new Set(selected.map((item) => item.nodeKey));
  const uncoveredNodes = graph.nodes.filter((node) => !covered.has(node.key)).map((node) => node.key);
  if (!isConfigured() || selected.length === 0) return { graph, evidence: [], uncoveredNodes, failedNodes: [], coverage: 0, reportSuccessRate: 0, mode: "fallback", generatedAt: new Date().toISOString() };
  const evidence = await Promise.all(selected.map((item) => executeSelection(item, startDate, endDate)));
  const successful = evidence.filter((item) => item.status === "success");
  const failedNodes = evidence.filter((item) => item.status === "failed").map((item) => item.nodeKey);
  const required = new Set([graph.root.key, ...graph.requiredKeys]);
  const successfulNodes = new Set(successful.map((item) => item.nodeKey));
  const coverage = required.size ? [...required].filter((key) => successfulNodes.has(key)).length / required.size : 0;
  const sources = new Set(successful.map((item) => item.source));
  const mode = successful.length === 0 ? "fallback" : failedNodes.length || uncoveredNodes.some((node) => required.has(node)) ? "partial" : sources.size === 1 && sources.has("cache") ? "cached" : "live";
  return { graph, evidence, uncoveredNodes, failedNodes, coverage, reportSuccessRate: successful.length / evidence.length, mode, generatedAt: new Date().toISOString() };
}
