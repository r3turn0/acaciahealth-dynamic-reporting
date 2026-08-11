import { listDatasets } from "@/lib/bi/datasetService";
import { listSemanticDatasets } from "@/lib/datasets/virtualDatasetRegistry";
import { intelligenceStore } from "@/lib/intelligence/store";
import { buildStaticCatalog } from "@/lib/services/metadataRegistry";
import { listReports } from "@/lib/services/reportService";
import { getSearchIndexHealth, searchIndex, type IndexedCatalogSearchResult, type SearchExecution } from "@/lib/discovery/searchIndex";

export const ASSET_TYPES = ["dataset", "table", "column", "measure", "kpi", "report", "dashboard", "query", "template", "validation", "scorecard", "agent", "glossary", "relationship"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetKind = "physical" | "virtual";
export type GovernanceState = "governed" | "draft" | "published" | "certified" | "deprecated";

export interface CatalogAsset {
  id: string;
  type: AssetType;
  kind: AssetKind;
  name: string;
  description: string;
  tags: string[];
  location: string;
  related: string[];
  owner: string;
  governanceState: GovernanceState;
  certified: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  source: string;
  lineage: string[];
  exportable: boolean;
  virtualNotice: string | null;
}

export interface CatalogSearchResult extends CatalogAsset {
  score: number;
  matchedTerms: string[];
}

export interface CatalogIndexHealth {
  scope: "process";
  authoritative: false;
  builtAt: string;
  assetCount: number;
  countsByType: Partial<Record<AssetType, number>>;
  status: "healthy" | "empty";
  notice: string;
}

const VIRTUAL_NOTICE = "Virtual cache metadata only; rehydrated from governed definitions and never written to a database.";
const STATIC_DATE = "2026-07-31T00:00:00.000Z";
const supplementalAssets: CatalogAsset[] = [
  virtualAsset("validation-adc", "validation", "ADC Must Not Be Negative", "Data quality rule requiring calculated ADC to be zero or greater.", ["adc", "quality", "negative"], "Validation Rules / Census", ["kpi-adc"], "Data Governance", "certified"),
  virtualAsset("agent-kpi", "agent", "KPI Detection Agent", "Classifies healthcare metrics, identifies thresholds, and registers virtual KPI opportunities.", ["agent", "kpi", "classification"], "Agent Registry", [], "Platform", "governed"),
  virtualAsset("glossary-ntuc", "glossary", "NTUC", "Not Taken Under Care: referrals not converted into an admission.", ["ntuc", "referrals", "non-admit"], "Business Glossary", [], "Clinical Operations", "certified"),
  virtualAsset("dashboard-executive", "dashboard", "Executive Census & Growth", "Census, ADC, admissions, referral conversion, and revenue trends.", ["executive", "census", "growth", "revenue"], "Dashboards / Executive", [], "Analytics", "published"),
  virtualAsset("scorecard-bp1", "scorecard", "BP1 Compliance Scorecard", "Operational compliance scorecard by branch and reporting period.", ["bp1", "compliance", "branch"], "Scorecards / Quality", [], "Quality", "published"),
  virtualAsset("template-variance", "template", "KPI Variance Investigation", "Read-only SQL template for actual-versus-expected KPI variance analysis.", ["sql", "variance", "kpi"], "SQL Templates", [], "Analytics", "governed"),
];

function virtualAsset(
  id: string,
  type: AssetType,
  name: string,
  description: string,
  tags: string[],
  location: string,
  related: string[],
  owner: string,
  governanceState: GovernanceState,
): CatalogAsset {
  return {
    id, type, kind: "virtual", name, description, tags, location, related, owner,
    governanceState, certified: governanceState === "certified", version: 1,
    createdAt: STATIC_DATE, updatedAt: STATIC_DATE, source: location,
    lineage: [location, name], exportable: true, virtualNotice: VIRTUAL_NOTICE,
  };
}

function tokenizeSqlIdentifiers(sql: string): string[] {
  const identifiers = sql.match(/\b(?:from|join)\s+([\[\]\w.]+)/gi) ?? [];
  return [...new Set(identifiers.map((match) => match.replace(/^\s*(?:from|join)\s+/i, "").replace(/[\[\]]/g, "")).filter(Boolean))].slice(0, 40);
}

function semanticKeywords(...values: string[]): string[] {
  const text = values.join(" ").toLowerCase();
  const vocabulary: Array<[string, RegExp]> = [
    ["census", /census/], ["average-daily-census", /\badc\b|average.daily.census/],
    ["patient-days", /patient.days/], ["episode", /episode|epi_/], ["admission", /admission|socdate/],
    ["discharge", /discharge/], ["visit", /visit|cev_/], ["referral", /referral|ntuc|nonadmit/],
    ["service-line", /service.line|slid/], ["branch", /branch/], ["region", /region|county|state/],
    ["finance", /revenue|invoice|billing|claim|receivable|payor/], ["workforce", /worker|employee|staff|productivity/],
    ["quality", /quality|compliance|audit|incident|note/], ["trend", /daily|rolling|trend|month.to.date/],
    ["primary-key", /primary.key|\bpk\b/], ["foreign-key", /foreign.key|relationship.key|\bfk\b/],
  ];
  return vocabulary.filter(([, pattern]) => pattern.test(text)).map(([keyword]) => keyword);
}

function physicalAssets(): CatalogAsset[] {
  const assets: CatalogAsset[] = [];
  for (const table of buildStaticCatalog().values()) {
    const tableId = `table-${table.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    assets.push({
      id: tableId,
      type: "table",
      kind: "physical",
      name: table.name,
      description: `Governed read-only ${table.schema}.${table.name} table with ${table.columns.length} registered column(s).`,
      tags: [table.schema, table.name, ...table.sources, ...semanticKeywords(table.id, ...table.columns.map((column) => column.name))],
      location: table.id,
      related: table.columns.map((column) => `${tableId}-column-${column.name.toLowerCase()}`),
      owner: "Source Data Governance",
      governanceState: "governed",
      certified: true,
      version: 1,
      createdAt: null,
      updatedAt: null,
      source: table.sources.join(", "),
      lineage: ["AcaciaHealth MSSQL", table.id],
      exportable: true,
      virtualNotice: null,
    });
    for (const column of table.columns) {
      assets.push({
        id: `${tableId}-column-${column.name.toLowerCase()}`,
        type: "column",
        kind: "physical",
        name: column.name,
        description: `${column.type} column on ${table.id}${column.isPk ? "; primary key" : ""}${column.isFk ? "; relationship key" : ""}.`,
        tags: [column.type, column.isPk ? "primary key" : "", column.isFk ? "foreign key" : "", ...semanticKeywords(table.id, column.name)].filter(Boolean),
        location: `${table.id}.${column.name}`,
        related: [tableId],
        owner: "Source Data Governance",
        governanceState: "governed",
        certified: true,
        version: 1,
        createdAt: null,
        updatedAt: null,
        source: table.id,
        lineage: ["AcaciaHealth MSSQL", table.id, column.name],
        exportable: true,
        virtualNotice: null,
      });
    }
  }
  return assets;
}

export async function buildCatalog(): Promise<CatalogAsset[]> {
  const [reports, datasets, governedDatasets] = await Promise.all([listReports(), Promise.resolve(listDatasets()), Promise.resolve(listSemanticDatasets())]);
  const reportAssets = reports.map<CatalogAsset>((report) => ({
    id: `report-${report.id}`,
    type: "report",
    kind: "virtual",
    name: report.name,
    description: report.description || report.prompt,
    tags: [...new Set([...report.tags, report.kpi, ...tokenizeSqlIdentifiers(report.sql), ...semanticKeywords(report.name, report.description, report.prompt, report.sql)])],
    location: "Saved Reports",
    related: tokenizeSqlIdentifiers(report.sql),
    owner: report.created_by,
    governanceState: report.status === "published" ? "published" : "draft",
    certified: report.status === "published" && report.created_by === "system",
    version: report.version,
    createdAt: report.created_date,
    updatedAt: report.last_run_date ?? report.created_date,
    source: report.created_by === "system" ? "Canonical report definitions" : "Process-local analyst cache",
    lineage: [report.kpi, ...report.tags],
    exportable: true,
    virtualNotice: VIRTUAL_NOTICE,
  }));
  const datasetAssets = datasets.map<CatalogAsset>((dataset) => ({
    id: `dataset-${dataset.id}`,
    type: "dataset",
    kind: "virtual",
    name: dataset.name,
    description: `Semantic dataset with ${dataset.fields.length} field(s) and ${dataset.relationships.length} relationship(s).`,
    tags: dataset.fields.map((field) => field.name),
    location: "Dataset Studio / Semantic Datasets",
    related: dataset.relationships.flatMap((relationship) => [relationship.fromField, relationship.toField]),
    owner: "Analytics",
    governanceState: "published",
    certified: dataset.source !== "manual",
    version: dataset.version,
    createdAt: dataset.createdDate,
    updatedAt: dataset.updatedDate,
    source: `${dataset.source} virtual definition`,
    lineage: [dataset.source, ...dataset.fields.map((field) => field.name)],
    exportable: true,
    virtualNotice: VIRTUAL_NOTICE,
  }));
  const governedDatasetAssets = governedDatasets.map<CatalogAsset>((dataset) => ({
    id: `semantic-dataset-${dataset.datasetId}`,
    type: "dataset",
    kind: "virtual",
    name: dataset.datasetName,
    description: dataset.description,
    tags: [...dataset.dimensions, ...dataset.measures, ...dataset.glossaryMappings],
    location: "Dataset Studio / Governed Semantic Datasets",
    related: [...dataset.tables, ...dataset.relationships],
    owner: dataset.owner,
    governanceState: dataset.status === "Published" ? "certified" : dataset.status === "Deprecated" ? "deprecated" : "draft",
    certified: dataset.status === "Published",
    version: dataset.history.length,
    createdAt: dataset.createdDate,
    updatedAt: dataset.updatedDate,
    source: dataset.sourceTraceability.join("; "),
    lineage: [...dataset.tables, ...dataset.relationships],
    exportable: true,
    virtualNotice: VIRTUAL_NOTICE,
  }));
  const kpiAssets = intelligenceStore.snapshot().kpis.map<CatalogAsset>((kpi) => ({
    id: `kpi-${kpi.id}`,
    type: "kpi",
    kind: "virtual",
    name: kpi.name,
    description: kpi.description,
    tags: [...new Set([...kpi.aliases, kpi.businessCategory, ...kpi.formula.split(/[^a-zA-Z0-9_]+/).filter((term) => term.length > 2), ...semanticKeywords(kpi.name, kpi.description, kpi.businessCategory, kpi.formula, ...kpi.lineage)])],
    location: `KPI Catalog / ${kpi.businessCategory}`,
    related: [...kpi.lineage],
    owner: "KPI Governance",
    governanceState: kpi.status === "active" ? "certified" : "draft",
    certified: kpi.status === "active",
    version: 1,
    createdAt: kpi.createdAt,
    updatedAt: kpi.createdAt,
    source: "KPI intelligence registry",
    lineage: kpi.lineage,
    exportable: true,
    virtualNotice: VIRTUAL_NOTICE,
  }));

  const byId = new Map<string, CatalogAsset>();
  for (const asset of [...physicalAssets(), ...datasetAssets, ...governedDatasetAssets, ...kpiAssets, ...reportAssets, ...supplementalAssets]) byId.set(asset.id, asset);
  return [...byId.values()];
}

export async function executeCatalogSearch(query: string, types?: AssetType[], limit = 20): Promise<SearchExecution> {
  return searchIndex(query, types, limit, buildCatalog);
}

export async function searchCatalog(query: string, types?: AssetType[], limit = 20): Promise<IndexedCatalogSearchResult[]> {
  return (await executeCatalogSearch(query, types, limit)).results;
}

/** Backward-compatible lexical search name; the unified catalog is async. */
export const lexicalCatalogSearch = searchCatalog;

export async function getCatalogIndexHealth(): Promise<CatalogIndexHealth> {
  return getSearchIndexHealth(buildCatalog);
}
