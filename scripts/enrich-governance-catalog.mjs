import fs from "node:fs";

const url = new URL("../lib/config/governanceCatalog.json", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(url, "utf8"));
const vocabulary = [
  ["episode", /(episode|epi_)/i], ["patient", /(patient|client)/i], ["census", /census/i],
  ["admission", /(admission|socdate)/i], ["discharge", /discharge/i], ["visit", /(visit|cev_)/i],
  ["service-line", /(service.?line|slid)/i], ["branch", /branch/i], ["region", /(region|county|state|city)/i],
  ["finance", /(revenue|invoice|billing|amount|claim|payor)/i], ["workforce", /(worker|employee|staff|discipline)/i],
  ["quality", /(quality|compliance|audit|incident|note)/i], ["date", /(date|time)/i],
  ["identifier", /(^|_)(id|code|key)($|_)/i], ["status", /(status|flag|active|deleted)/i],
];
const keywords = (value) => vocabulary.filter(([, pattern]) => pattern.test(value)).map(([keyword]) => keyword);

catalog.metadataAudit = {
  auditedAt: new Date().toISOString(),
  scope: "governed reporting schemas",
  immutableSource: true,
  notes: "Columns and declared primary/foreign keys retained from source metadata; semantic keywords are deterministic search annotations.",
};
catalog.tables = catalog.tables.map((table) => {
  const primaryKeys = table.primaryKeys ?? [];
  const foreignKeys = table.foreignKeys ?? [];
  const primaryText = JSON.stringify(primaryKeys);
  const foreignText = JSON.stringify(foreignKeys);
  const columns = (table.columns ?? []).filter((column) => typeof column.name === "string" && column.name.length > 0).map((column) => ({
    ...column,
    primaryKey: column.primaryKey ?? primaryText.toLowerCase().includes(`\"${column.name.toLowerCase()}\"`),
    foreignKey: column.foreignKey ?? foreignText.toLowerCase().includes(`\"${column.name.toLowerCase()}\"`),
    semanticKeywords: [...new Set([...(column.semanticKeywords ?? []), ...keywords(`${table.schema}.${table.name}.${column.name} ${column.description ?? ""}`)])],
  }));
  return {
    ...table,
    columns,
    columnNames: columns.map((column) => column.name),
    semanticKeywords: [...new Set([...(table.semanticKeywords ?? []), ...keywords(`${table.schema}.${table.name} ${columns.map((column) => column.name).join(" ")}`)])],
    relationshipKeywords: [...new Set([...(table.relationshipKeywords ?? []), ...keywords(foreignText)])],
  };
});

fs.writeFileSync(url, `${JSON.stringify(catalog, null, 2)}\n`);
