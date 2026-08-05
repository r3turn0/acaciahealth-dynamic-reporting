/**
 * kpiService — pure KPI computation + suggestion logic.
 *
 * Shared by the client (live chart previews) and the server (report runs).
 * No IO; operates on the dataset's sample rows.
 */

import type {
  DataRow,
  DatasetField,
  Filter,
  KpiReport,
  Metric,
} from "./types";
import { metricKey, metricLabel } from "./types";

// ── Filtering ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

function matches(row: DataRow, f: Filter): boolean {
  const raw = row[f.field];
  if (raw === null || raw === undefined) return false;

  switch (f.op) {
    case "equals":
      return String(raw).toLowerCase() === String(f.value).toLowerCase();
    case "not_equals":
      return String(raw).toLowerCase() !== String(f.value).toLowerCase();
    case "contains":
      return String(raw).toLowerCase().includes(String(f.value).toLowerCase());
    case "gt":
      return Number(raw) > Number(f.value);
    case "lt":
      return Number(raw) < Number(f.value);
    case "gte":
      return Number(raw) >= Number(f.value);
    case "lte":
      return Number(raw) <= Number(f.value);
    case "last_n_days": {
      const t = Date.parse(String(raw));
      if (Number.isNaN(t)) return false;
      return t >= daysAgo(Number(f.value));
    }
    default:
      return true;
  }
}

export function applyFilters(rows: DataRow[], filters: Filter[]): DataRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matches(row, f)));
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function aggregate(values: number[], agg: Metric["agg"]): number {
  if (agg === "count") return values.length;
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return 0;
  }
}

export interface AggregationResult {
  /** One object per group: { <dimension>: label, <metricKey>: number }. */
  data: Record<string, string | number>[];
  metricKeys: string[];
  dimensionKey: string | null;
}

/**
 * Group rows by the selected dimensions and compute each metric per group.
 * When no dimension is selected, returns a single total row.
 */
export function computeAggregation(
  rows: DataRow[],
  config: Pick<KpiReport, "metrics" | "dimensions" | "filters">
): AggregationResult {
  const filtered = applyFilters(rows, config.filters ?? []);
  const configuredMetrics = config.metrics.length
    ? config.metrics
    : ([{ agg: "count", field: null }] as Metric[]);
  // A report can contain duplicate metric definitions (for example, when two
  // existing metrics are both changed to Count). Since aggregation rows are
  // keyed by metricKey, duplicates represent the same series and must only be
  // computed and rendered once.
  const metrics = Array.from(
    new Map(configuredMetrics.map((metric) => [metricKey(metric), metric])).values()
  );
  const metricKeys = metrics.map(metricKey);
  const dims = config.dimensions ?? [];
  const dimensionKey = dims[0] ?? null;

  if (dims.length === 0) {
    const row: Record<string, string | number> = { group: "Total" };
    for (const m of metrics) {
      const vals = filtered
        .map((r) => Number(r[m.field ?? ""]))
        .filter((n) => !Number.isNaN(n));
      row[metricKey(m)] = round(aggregate(vals, m.agg));
    }
    return { data: [row], metricKeys, dimensionKey: "group" };
  }

  const groups = new Map<string, DataRow[]>();
  for (const r of filtered) {
    const key = dims.map((d) => String(r[d] ?? "—")).join(" · ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const data = Array.from(groups.entries()).map(([key, groupRows]) => {
    const row: Record<string, string | number> = { [dimensionKey!]: key };
    for (const m of metrics) {
      const vals = groupRows
        .map((r) => Number(r[m.field ?? ""]))
        .filter((n) => !Number.isNaN(n));
      row[metricKey(m)] = round(aggregate(vals, m.agg));
    }
    return row;
  });

  // Sort by first metric descending for readable charts.
  data.sort((a, b) => Number(b[metricKeys[0]]) - Number(a[metricKeys[0]]));

  return { data, metricKeys, dimensionKey };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Auto-suggestions ──────────────────────────────────────────────────────────

export interface KpiSuggestion {
  label: string;
  metrics: Metric[];
  dimensions: string[];
  chart: KpiReport["chart"];
}

/**
 * Suggest starter KPIs from a field list: numeric fields become metrics,
 * strings become dimensions, dates enable trend lines.
 */
export function suggestKpis(fields: DatasetField[]): KpiSuggestion[] {
  const numbers = fields.filter((f) => f.type === "number");
  const strings = fields.filter((f) => f.type === "string");
  const dates = fields.filter((f) => f.type === "date");
  const out: KpiSuggestion[] = [];

  const firstNum = numbers[0];
  const firstStr = strings[0];
  const firstDate = dates[0];

  if (firstNum && firstStr) {
    out.push({
      label: `Sum of ${firstNum.name} by ${firstStr.name}`,
      metrics: [{ agg: "sum", field: firstNum.name }],
      dimensions: [firstStr.name],
      chart: "bar",
    });
    out.push({
      label: `Avg of ${firstNum.name} by ${firstStr.name}`,
      metrics: [{ agg: "avg", field: firstNum.name }],
      dimensions: [firstStr.name],
      chart: "bar",
    });
  }
  if (firstNum && firstDate) {
    out.push({
      label: `${firstNum.name} trend over ${firstDate.name}`,
      metrics: [{ agg: "sum", field: firstNum.name }],
      dimensions: [firstDate.name],
      chart: "line",
    });
  }
  if (firstStr) {
    out.push({
      label: `Record count by ${firstStr.name}`,
      metrics: [{ agg: "count", field: null }],
      dimensions: [firstStr.name],
      chart: "pie",
    });
  }
  // Fallback: a raw total.
  if (out.length === 0 && firstNum) {
    out.push({
      label: `Total ${firstNum.name}`,
      metrics: [{ agg: "sum", field: firstNum.name }],
      dimensions: [],
      chart: "bar",
    });
  }

  return out;
}

/** Label used in the report list / chart legend. */
export { metricLabel };
