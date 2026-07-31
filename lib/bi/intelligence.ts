import { z } from "zod";
import type { DataRow, DatasetField, DatasetSchema, Metric } from "./types";

const sqlSchema = z.string().min(8).refine((sql) => /^\s*(select|with)\b/i.test(sql), "SQL must start with SELECT or WITH");

export const kpiDefinitionSchema = z.object({
  schemaVersion: z.string().default("1.0"),
  name: z.string().min(2),
  description: z.string().default(""),
  formulaSql: sqlSchema,
  dimensions: z.array(z.string()).default([]),
  filters: z.array(z.string()).default([]),
  datasetId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dateParameters: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }).optional(),
  target: z.number().optional(),
  unit: z.string().optional(),
});

export type PortableKpiDefinition = z.infer<typeof kpiDefinitionSchema>;

export type DefinitionValidation = {
  valid: boolean;
  definition?: PortableKpiDefinition;
  errors: string[];
  warnings: string[];
};

const BLOCKED_SQL = /\b(insert|update|delete|drop|alter|truncate|merge|exec(?:ute)?|grant|revoke|create|openrowset|opendatasource|xp_|sp_)\b|;\s*\S/i;

export function validateKpiDefinition(input: unknown): DefinitionValidation {
  const parsed = kpiDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "definition"}: ${issue.message}`), warnings: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (BLOCKED_SQL.test(parsed.data.formulaSql)) errors.push("SQL contains a blocked statement or multiple statements.");
  if (/select\s+\*/i.test(parsed.data.formulaSql)) errors.push("SELECT * is not permitted; list explicit aggregate or dimension columns.");
  if (!/\bwhere\b/i.test(parsed.data.formulaSql)) warnings.push("No WHERE clause detected. Add a bounded date filter before execution.");
  if (!/@StartDate|:startDate|\$startDate/i.test(parsed.data.formulaSql)) warnings.push("No parameterized start date detected.");
  if (!/@EndDate|:endDate|\$endDate/i.test(parsed.data.formulaSql)) warnings.push("No parameterized end date detected.");
  return { valid: errors.length === 0, definition: parsed.data, errors, warnings };
}

export type FieldProfile = {
  field: string;
  type: DatasetField["type"];
  completeness: number;
  distinct: number;
  min?: number;
  max?: number;
  mean?: number;
};

export type DatasetProfile = {
  rowCount: number;
  qualityScore: number;
  fields: FieldProfile[];
  numericFields: string[];
  dateFields: string[];
  dimensionFields: string[];
};

export function profileDataset(dataset: DatasetSchema): DatasetProfile {
  const rows = dataset.sampleData;
  const fields = dataset.fields.map((field) => {
    const values = rows.map((row) => row[field.name]).filter((value) => value !== null && value !== "" && value !== undefined);
    const numeric = values.map(Number).filter(Number.isFinite);
    return {
      field: field.name,
      type: field.type,
      completeness: rows.length ? Math.round((values.length / rows.length) * 100) : 0,
      distinct: new Set(values.map(String)).size,
      ...(numeric.length ? { min: Math.min(...numeric), max: Math.max(...numeric), mean: numeric.reduce((a, b) => a + b, 0) / numeric.length } : {}),
    };
  });
  const completeness = fields.length ? fields.reduce((sum, field) => sum + field.completeness, 0) / fields.length : 0;
  return {
    rowCount: rows.length,
    qualityScore: Math.round(completeness),
    fields,
    numericFields: dataset.fields.filter((field) => field.type === "number").map((field) => field.name),
    dateFields: dataset.fields.filter((field) => field.type === "date").map((field) => field.name),
    dimensionFields: dataset.fields.filter((field) => field.type === "string" || field.type === "boolean").map((field) => field.name),
  };
}

export type SeriesPoint = { label: string; value: number; forecast?: number; lower?: number; upper?: number; anomaly?: boolean };

export function buildTimeSeries(rows: DataRow[], dateField: string, valueField: string): SeriesPoint[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const rawDate = row[dateField];
    const value = Number(row[valueField]);
    if (!rawDate || !Number.isFinite(value)) continue;
    const label = String(rawDate).slice(0, 10);
    grouped.set(label, (grouped.get(label) ?? 0) + value);
  }
  const points = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
  if (points.length < 2) return points;
  const values = points.map((point) => point.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1;
  const withAnomalies = points.map((point) => ({ ...point, anomaly: Math.abs(point.value - mean) > sd * 2 }));
  const lookback = values.slice(-Math.min(4, values.length));
  const avg = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  const trend = lookback.length > 1 ? (lookback.at(-1)! - lookback[0]) / (lookback.length - 1) : 0;
  const lastDate = new Date(points.at(-1)!.label);
  const horizon = Math.min(6, Math.max(3, Math.round(points.length / 4)));
  const forecasts = Array.from({ length: horizon }, (_, index) => {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() + index + 1);
    const forecast = Math.max(0, avg + trend * (index + 1));
    const uncertainty = sd * (1 + index * 0.15);
    return { label: date.toISOString().slice(0, 10), value: Number.NaN, forecast, lower: Math.max(0, forecast - uncertainty), upper: forecast + uncertainty };
  });
  return [...withAnomalies, ...forecasts];
}

export function suggestDashboard(dataset: DatasetSchema) {
  const profile = profileDataset(dataset);
  const primaryMetric = profile.numericFields[0];
  const secondaryMetric = profile.numericFields[1];
  const dimension = profile.dimensionFields[0] ?? profile.dateFields[0];
  const date = profile.dateFields[0];
  const metrics: Metric[] = primaryMetric ? [{ agg: "sum", field: primaryMetric }] : [{ agg: "count", field: null }];
  return {
    headline: primaryMetric ? `Total ${primaryMetric}` : "Record count",
    metrics,
    dimensions: dimension ? [dimension] : [],
    chart: date ? ("line" as const) : ("bar" as const),
    secondaryMetric,
    date,
    narrative: `${dataset.name} contains ${profile.rowCount.toLocaleString()} session rows across ${dataset.fields.length} fields with ${profile.qualityScore}% average completeness.`,
  };
}

export function buildPowerBiExport(dataset: DatasetSchema, reports: unknown[], definitions: PortableKpiDefinition[]) {
  return {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/reportDefinition/1.0.0/schema.json",
    format: "Acacia KPI portable model",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    semanticModel: { name: dataset.name, fields: dataset.fields, relationships: dataset.relationships },
    measures: definitions.map((definition) => ({ name: definition.name, description: definition.description, expression: definition.formulaSql, formatString: definition.unit ?? "General" })),
    reports,
    note: "Portable semantic metadata for Power BI/Fabric adaptation; no source rows are included.",
  };
}
