import fs from "node:fs";

const source = JSON.parse(fs.readFileSync(new URL("../data/source-metadata.json", import.meta.url), "utf8"));
const domainPatterns = [
  ["Clinical", /(episode|patient|client|visit|admission|discharge|census|referral|oasis|hospice|home.?health|service.?line)/i],
  ["Finance", /(revenue|invoice|claim|billing|accounts?|receivable|payable|payment|deposit|adjustment|margin)/i],
  ["Workforce", /(worker|employee|staff|payroll|salary|hire|job|fte|position)/i],
  ["Quality", /(quality|incident|complaint|infection|fall|injury|grievance|compliance|audit)/i],
];
const rolePattern = /(date|time|amount|total|count|days|rate|percent|status|branch|service|type|code|id)$/i;
const tables = source.tables
  .map((table) => {
    const haystack = `${table.schema}.${table.table} ${table.columns.map((column) => column.name).join(" ")}`;
    const domain = domainPatterns.find(([, pattern]) => pattern.test(haystack))?.[0];
    if (!domain) return null;
    const columns = table.columns
      .filter((column) => rolePattern.test(column.name) || column.is_identity || column.is_computed || column.description)
      .slice(0, 30)
      .map((column) => ({
        name: column.name,
        dataType: column.data_type,
        nullable: column.nullable,
        identity: column.is_identity,
        computed: column.is_computed,
        description: column.description ?? null,
      }));
    return {
      schema: table.schema,
      name: table.table,
      domain,
      entityType: /view/i.test(table.temporal_type ?? "") ? "view" : "table",
      columns,
      primaryKeys: table.primary_keys ?? [],
      foreignKeys: table.foreign_keys ?? [],
      indexes: (table.indexes ?? []).slice(0, 10),
      sourceObjectId: table.object_id,
    };
  })
  .filter(Boolean)
  .filter((table) => table.columns.length > 0)
  .sort((a, b) => b.columns.length - a.columns.length)
  .slice(0, 450);

const artifact = {
  correlationId: "acacia-reporting-enhancement-v1",
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: source.generated_at,
  sourceFile: "metadata-mqHu1.json",
  sourceTableCount: source.tables.length,
  selectedTableCount: tables.length,
  selectedColumnCount: tables.reduce((total, table) => total + table.columns.length, 0),
  domains: [...new Set(tables.map((table) => table.domain))],
  tables,
};
fs.writeFileSync(new URL("../lib/config/governanceCatalog.json", import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
