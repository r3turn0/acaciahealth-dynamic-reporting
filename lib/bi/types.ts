/**
 * Shared BI Studio types.
 *
 * A "Dataset" is a user-defined schema (manually built or inferred from an
 * uploaded CSV/Excel file). A "KPI Report" is a saved analysis configuration
 * (metrics + dimensions + filters + chart type) bound to a dataset.
 *
 * Everything is JSON-serialisable so it can round-trip through the API routes
 * and the in-memory services (upgradeable to a real DB later).
 */

export type FieldType = "string" | "number" | "date" | "boolean";

export interface DatasetField {
  name: string;
  type: FieldType;
}

/** Optional relationship from a field in this dataset to another dataset. */
export interface Relationship {
  fromField: string;
  toDataset: string;
  toField: string;
}

/** A row of sample data — column name → primitive value. */
export type DataRow = Record<string, string | number | boolean | null>;

/** A point-in-time snapshot of a schema, kept for versioning. */
export interface SchemaVersion {
  version: number;
  fields: DatasetField[];
  relationships: Relationship[];
  savedDate: string;
  note: string;
}

export interface DatasetSchema {
  id: string;
  name: string;
  fields: DatasetField[];
  relationships: Relationship[];
  /** Small sample used to power live chart previews and KPI suggestions. */
  sampleData: DataRow[];
  version: number;
  history: SchemaVersion[];
  source: "manual" | "csv" | "excel";
  createdDate: string;
  updatedDate: string;
}

// ── KPI report configuration ──────────────────────────────────────────────────

export type MetricAgg = "sum" | "avg" | "count" | "min" | "max";

export interface Metric {
  agg: MetricAgg;
  /** Field to aggregate. Ignored (and optional) when agg === "count". */
  field: string | null;
}

export type FilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "last_n_days";

export interface Filter {
  field: string;
  op: FilterOp;
  value: string | number;
}

export type ChartType = "bar" | "line" | "pie" | "table";

export interface KpiReport {
  id: string;
  name: string;
  datasetId: string;
  metrics: Metric[];
  dimensions: string[];
  filters: Filter[];
  chart: ChartType;
  createdBy: string;
  createdDate: string;
  updatedDate: string;
}

// ── Helpers shared across UI + services ────────────────────────────────────────

/** Stable machine key for a metric, e.g. `sum_revenue` or `count`. */
export function metricKey(m: Metric): string {
  return m.agg === "count" || !m.field ? "count" : `${m.agg}_${m.field}`;
}

/** Human label for a metric, e.g. "Sum of revenue" or "Count". */
export function metricLabel(m: Metric): string {
  if (m.agg === "count" || !m.field) return "Count";
  const verb = { sum: "Sum", avg: "Avg", min: "Min", max: "Max" }[m.agg];
  return `${verb} of ${m.field}`;
}
