import type { AnalysisResultSet, AnalysisSource } from "@/lib/services/kpiAnalysisTypes";
import type { QueryResultSet } from "@/lib/db/readOnlyClient";

const MAX_ROWS = 20;
const MAX_COLUMNS = 20;
const IDENTIFIER_PATTERN = /(^|_)(patient|episode|client|person|member)?_?(id|mrn|ssn|name|address|phone|email|dob)(_|$)/i;
const DIMENSION_PATTERNS: Array<[string, RegExp]> = [
  ["date", /(^|_)(date|day|week|month|quarter|year)(_|$)/i],
  ["branch", /(^|_)(branch|location|office|agency)(_|$)/i],
  ["service-line", /(^|_)(service|service_line|care_type|program)(_|$)/i],
  ["region", /(^|_)(region|market|territory)(_|$)/i],
];

function safeColumns(columns: string[]): string[] {
  return columns.filter((column) => !IDENTIFIER_PATTERN.test(column)).slice(0, MAX_COLUMNS);
}

function numericSummary(rows: Record<string, unknown>[], columns: string[]): AnalysisResultSet["numericSummary"] {
  return Object.fromEntries(columns.flatMap((column) => {
    const values = rows.map((row) => row[column]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length ? [[column, {
      total: values.reduce((sum, value) => sum + value, 0),
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values), max: Math.max(...values), nonNull: values.length,
    }]] : [];
  }));
}

function inferGrain(columns: string[]): string[] {
  return DIMENSION_PATTERNS.filter(([, pattern]) => columns.some((column) => pattern.test(column))).map(([grain]) => grain);
}

export function normalizeResultSet(resultSet: QueryResultSet, citationId: string, name: string): AnalysisResultSet {
  const columns = safeColumns(resultSet.columns);
  const rows = resultSet.rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  const populated = rows.reduce((count, row) => count + columns.filter((column) => row[column] !== null && row[column] !== undefined).length, 0);
  return {
    citationId,
    name,
    columns,
    rowCount: resultSet.rowCount,
    sampleRows: rows.slice(0, MAX_ROWS),
    numericSummary: numericSummary(rows, columns),
    completeness: rows.length && columns.length ? populated / (rows.length * columns.length) : 0,
    grain: inferGrain(columns),
    notes: columns.length < resultSet.columns.length ? ["Likely identifier columns were excluded from AI context."] : [],
  };
}

export function sourceLineage(source: AnalysisSource): string {
  const age = source.dataAgeMs === null ? "age unavailable" : `${Math.max(0, Math.round(source.dataAgeMs / 60_000))} minutes old`;
  return `${source.name} (${source.executionMode}, ${source.validationStatus}, ${source.resultSetCount} result set${source.resultSetCount === 1 ? "" : "s"}, ${age})`;
}

export function compatibleGrain(left: AnalysisResultSet, right: AnalysisResultSet): boolean {
  if (!left.grain.length || !right.grain.length) return false;
  return left.grain.some((dimension) => right.grain.includes(dimension));
}
