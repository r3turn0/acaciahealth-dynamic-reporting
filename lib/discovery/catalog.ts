import { listDatasets } from "@/lib/bi/datasetService";
import { listSemanticDatasets } from "@/lib/datasets/virtualDatasetRegistry";
import { intelligenceStore } from "@/lib/intelligence/store";
import { buildStaticCatalog } from "@/lib/services/metadataRegistry";
import { listReports } from "@/lib/services/reportService";

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
const TYPE_WEIGHT: Record<AssetType, number> = {
  dataset: 0.1, table: 0.09, column: 0.04, measure: 0.06, kpi: 0.12,
  report: 0.08, dashboard: 0.04, query: 0.02, template: 0.02,
  validation: 0.03, scorecard: 0.04, agent: 0.01, glossary: 0.07,
  relationship: 0.03,
};

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
      tags: [table.schema, table.name, ...table.sources],
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
        tags: [column.type, column.isPk ? "primary key" : "", column.isFk ? "foreign key" : ""].filter(Boolean),
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
    tags: [...report.tags, report.kpi],
    location: "Saved Reports",
    related: [],
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
    version: dataset.version,
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
    tags: [...kpi.aliases, kpi.businessCategory],
    location: `KPI Catalog / ${kpi.businessCategory}`,
    related: [],
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

const SYNONYMS: Record<string, string[]> = {
  adc: ["average daily census", "occupancy", "patient days"],
  admissions: ["start of care", "soc", "new admissions"],
  recert: ["recertification", "cert period"],
  revenue: ["billing", "charges", "payments", "rppd"],
  clinician: ["worker", "discipline", "staff"],
  branch: ["location", "region", "office"],
  ntuc: ["not taken under care", "non admit"],
};

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 1);
}

function expandTerms(query: string): Set<string> {
  const normalized = query.toLowerCase().trim();
  const terms = new Set(tokenize(normalized));
  for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
    if (normalized.includes(canonical) || aliases.some((alias) => normalized.includes(alias))) {
      terms.add(canonical);
      for (const alias of aliases) for (const token of tokenize(alias)) terms.add(token);
    }
  }
  return terms;
}

function fuzzyTokenMatch(term: string, candidate: string): boolean {
  if (candidate.includes(term) || term.includes(candidate)) return true;
  if (term.length < 4 || candidate.length < 4) return false;
  let mismatches = Math.abs(term.length - candidate.length);
  if (mismatches > 1) return false;
  for (let index = 0; index < Math.min(term.length, candidate.length); index += 1) {
    if (term[index] !== candidate[index]) mismatches += 1;
  }
  return mismatches <= 1;
}

export async function searchCatalog(query: string, types?: AssetType[], limit = 20): Promise<CatalogSearchResult[]> {
  const assets = await buildCatalog();
  const raw = query.toLowerCase().trim();
  const expanded = expandTerms(raw);
  return assets
    .filter((asset) => !types?.length || types.includes(asset.type))
    .map((asset) => {
      const text = [asset.name, asset.description, asset.location, asset.source, asset.owner, ...asset.tags, ...asset.lineage].join(" ").toLowerCase();
      const candidateTokens = tokenize(text);
      const matchedTerms = [...expanded].filter((term) => candidateTokens.some((candidate) => fuzzyTokenMatch(term, candidate)));
      const coverage = matchedTerms.length / Math.max(expanded.size, 1);
      const phrase = raw.length > 1 && text.includes(raw) ? 0.42 : 0;
      const nameBoost = asset.name.toLowerCase().includes(raw) ? 0.16 : 0;
      const governanceBoost = asset.certified ? 0.04 : 0;
      return { ...asset, score: Math.min(0.99, phrase + nameBoost + coverage * 0.48 + TYPE_WEIGHT[asset.type] + governanceBoost), matchedTerms };
    })
    .filter((asset) => asset.matchedTerms.length > 0 || asset.score >= 0.5)
    .sort((left, right) => right.score - left.score || right.certified.toString().localeCompare(left.certified.toString()))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

/** Backward-compatible lexical search name; the unified catalog is async. */
export const lexicalCatalogSearch = searchCatalog;

export async function getCatalogIndexHealth(): Promise<CatalogIndexHealth> {
  const assets = await buildCatalog();
  const countsByType: Partial<Record<AssetType, number>> = {};
  for (const asset of assets) countsByType[asset.type] = (countsByType[asset.type] ?? 0) + 1;
  return {
    scope: "process",
    authoritative: false,
    builtAt: new Date().toISOString(),
    assetCount: assets.length,
    countsByType,
    status: assets.length > 0 ? "healthy" : "empty",
    notice: VIRTUAL_NOTICE,
  };
}
