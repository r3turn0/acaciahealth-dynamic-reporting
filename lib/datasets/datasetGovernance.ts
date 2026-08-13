export type SelectedColumn = {
  name: string;
  type: string;
  nullable: boolean;
  isPk: boolean;
  isFk?: boolean;
  description?: string;
};

export type SelectedTable = {
  name: string;
  schema: string;
  description?: string;
  recordCount?: number;
  columns: SelectedColumn[];
};

export type HealthBreakdown = {
  relationships: number;
  joins: number;
  metadata: number;
  measures: number;
  documentation: number;
};

export type DatasetDefinitionLike = {
  datasetName: string;
  description?: string;
  owner?: string;
  tables: string[];
  selectedTables?: SelectedTable[];
  relationships: string[];
  dimensions: string[];
  measures: string[];
};

export function normalizeSelectedTables(
  tables: string[],
  selectedTables: SelectedTable[] | undefined,
): SelectedTable[] {
  const byName = new Map((selectedTables ?? []).map((table) => [table.name.toLowerCase(), table]));
  return tables.map((name) => {
    const selected = byName.get(name.toLowerCase());
    return selected ? structuredClone(selected) : { name, schema: name.includes(".") ? name.split(".")[0] : "dbo", columns: [] };
  });
}

export function computeHealth(input: DatasetDefinitionLike): { score: number; breakdown: HealthBreakdown } {
  const tables = normalizeSelectedTables(input.tables, input.selectedTables);
  const columnCount = tables.reduce((sum, table) => sum + table.columns.length, 0);
  const describedColumns = tables.reduce((sum, table) => sum + table.columns.filter((column) => column.description?.trim()).length, 0);
  const relationships = input.tables.length <= 1 ? 100 : Math.min(100, Math.round((input.relationships.length / (input.tables.length - 1)) * 100));
  const joins = input.tables.length <= 1 ? 100 : input.relationships.length >= input.tables.length - 1 ? 100 : 30;
  const metadataSignals = [input.datasetName.trim(), input.description?.trim(), input.owner?.trim()].filter(Boolean).length;
  const metadata = Math.round((metadataSignals / 3) * 100);
  const measures = input.measures.length > 0 ? 100 : columnCount > 0 && tables.some((table) => table.columns.some((column) => /int|decimal|number|float|money/i.test(column.type))) ? 70 : 25;
  const documentation = columnCount ? Math.round((describedColumns / columnCount) * 100) : 25;
  const breakdown = { relationships, joins, metadata, measures, documentation };
  const score = Math.round(relationships * 0.25 + joins * 0.25 + metadata * 0.2 + measures * 0.15 + documentation * 0.15);
  return { score, breakdown };
}

export type DatasetDiff = { added: string[]; removed: string[]; modified: string[] };

export function compareDatasetDefinitions(previous: DatasetDefinitionLike, current: DatasetDefinitionLike): DatasetDiff {
  const flatten = (definition: DatasetDefinitionLike) => {
    const tables = normalizeSelectedTables(definition.tables, definition.selectedTables);
    return new Set([
      ...definition.tables.map((value) => `Table: ${value}`),
      ...tables.flatMap((table) => table.columns.map((column) => `Column: ${table.name}.${column.name} (${column.type})`)),
      ...definition.relationships.map((value) => `Relationship: ${value}`),
      ...definition.dimensions.map((value) => `Dimension: ${value}`),
      ...definition.measures.map((value) => `Measure: ${value}`),
    ]);
  };
  const before = flatten(previous);
  const after = flatten(current);
  const modified = ["datasetName", "description", "owner"].flatMap((key) => {
    const oldValue = String(previous[key as keyof DatasetDefinitionLike] ?? "");
    const newValue = String(current[key as keyof DatasetDefinitionLike] ?? "");
    return oldValue !== newValue ? [`${key}: ${oldValue || "—"} → ${newValue || "—"}`] : [];
  });
  return {
    added: [...after].filter((item) => !before.has(item)),
    removed: [...before].filter((item) => !after.has(item)),
    modified,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildDatasetExport(dataset: DatasetDefinitionLike & { datasetId: string; version: string }, format: "json" | "yaml" | "dictionary" | "lineage" | "graph") {
  const selectedTables = normalizeSelectedTables(dataset.tables, dataset.selectedTables);
  const canonical = { ...dataset, selectedTables, virtual: true, authoritative: false, exportedAt: new Date().toISOString() };
  if (format === "json") return { mime: "application/json", extension: "json", content: JSON.stringify(canonical, null, 2) };
  if (format === "yaml") {
    const lines = [`datasetId: ${dataset.datasetId}`, `name: ${JSON.stringify(dataset.datasetName)}`, `version: ${dataset.version}`, "virtual: true", "authoritative: false", "tables:"];
    for (const table of selectedTables) {
      lines.push(`  - name: ${table.name}`, `    schema: ${table.schema}`, "    columns:");
      for (const column of table.columns) lines.push(`      - name: ${column.name}`, `        type: ${column.type}`, `        nullable: ${column.nullable}`);
    }
    return { mime: "application/yaml", extension: "yaml", content: lines.join("\n") };
  }
  if (format === "dictionary") {
    const rows = [["table", "schema", "column", "type", "nullable", "primary_key", "foreign_key", "description"], ...selectedTables.flatMap((table) => table.columns.map((column) => [table.name, table.schema, column.name, column.type, column.nullable, column.isPk, Boolean(column.isFk), column.description ?? ""]))];
    return { mime: "text/csv", extension: "csv", content: rows.map((row) => row.map(csvCell).join(",")).join("\n") };
  }
  if (format === "lineage") {
    const rows = [["dataset_id", "version", "source_table", "source_column", "semantic_asset"], ...selectedTables.flatMap((table) => table.columns.map((column) => [dataset.datasetId, dataset.version, `${table.schema}.${table.name}`, column.name, dataset.datasetName]))];
    return { mime: "text/csv", extension: "csv", content: rows.map((row) => row.map(csvCell).join(",")).join("\n") };
  }
  return { mime: "application/json", extension: "json", content: JSON.stringify({ datasetId: dataset.datasetId, nodes: selectedTables.map((table) => ({ id: table.name, columns: table.columns.map((column) => column.name) })), edges: dataset.relationships.map((id) => ({ id })) }, null, 2) };
}
