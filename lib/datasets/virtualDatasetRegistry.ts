import { compareDatasetDefinitions, computeHealth, normalizeSelectedTables, type HealthBreakdown, type SelectedTable } from "./datasetGovernance";

export type RelType = "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
export type RelStatus = "Suggested" | "Accepted" | "Rejected";
export type DatasetStatus = "Draft" | "Pending Approval" | "Published" | "Deprecated";
export type PublicationTarget = "Report Studio" | "Discover Data" | "BI Studio" | "KPI Intelligence" | "Table Explorer" | "Schema Hub";

export interface Relationship {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: RelType;
  confidence: number;
  status: RelStatus;
  reasons: string[];
  createdBy: string;
  createdDate: string;
  kpiCount?: number;
  reportCount?: number;
  datasetCount?: number;
}

export interface DatasetSnapshot {
  version: string;
  savedAt: string;
  savedBy: string;
  reason: string;
  definition: Omit<SemanticDataset, "history">;
}

export interface SemanticDataset {
  datasetId: string;
  datasetName: string;
  description: string;
  tables: string[];
  selectedTables: SelectedTable[];
  relationships: string[];
  dimensions: string[];
  measures: string[];
  glossaryMappings: string[];
  businessRules: string[];
  owner: string;
  version: string;
  status: DatasetStatus;
  createdDate: string;
  updatedDate: string;
  publishedDate?: string;
  createdBy: string;
  health?: number;
  healthBreakdown?: HealthBreakdown;
  changeSummary?: string;
  restoredFromVersion?: string;
  publicationTargets: PublicationTarget[];
  sourceTraceability: string[];
  virtual: true;
  authoritative: false;
  cacheScope: "process";
  rehydrationSource: "static-seed" | "session-definition";
  history: DatasetSnapshot[];
}

interface RegistryState {
  datasets: Map<string, SemanticDataset>;
  relationships: Map<string, Relationship>;
  draftParents: Map<string, string>;
  datasetSequence: number;
  relationshipSequence: number;
}

const allTargets: PublicationTarget[] = ["Report Studio", "Discover Data", "BI Studio", "KPI Intelligence", "Table Explorer", "Schema Hub"];
const isoNow = () => new Date().toISOString();
const day = (value = isoNow()) => value.slice(0, 10);
const clone = <T>(value: T): T => structuredClone(value);

function seededState(): RegistryState {
  const relationships = new Map<string, Relationship>([
    ["REL-001", { id: "REL-001", sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_branchcode", targetTable: "BRANCHES", targetColumn: "branch_code", relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted", reasons: ["Matching data types", "95% value overlap", "Used by governed KPI definitions"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 49, reportCount: 72, datasetCount: 12 }],
    ["REL-002", { id: "REL-002", sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_slid", targetTable: "SERVICE_LINES", targetColumn: "service_line_id", relationshipType: "ManyToOne", confidence: 0.96, status: "Accepted", reasons: ["Exact identifier pattern", "Existing read-only join evidence"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 38, reportCount: 55, datasetCount: 8 }],
    ["REL-003", { id: "REL-003", sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "epi_id", targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id", relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted", reasons: ["Exact column match", "Governed FK metadata"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 22, reportCount: 31, datasetCount: 5 }],
    ["REL-004", { id: "REL-004", sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "worker_id", targetTable: "WORKER_BASE", targetColumn: "worker_id", relationshipType: "ManyToOne", confidence: 0.97, status: "Accepted", reasons: ["Exact column match", "Productivity query evidence"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 12, reportCount: 18, datasetCount: 3 }],
    ["REL-005", { id: "REL-005", sourceTable: "Billing.LINE_ITEMS", sourceColumn: "epi_id", targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id", relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted", reasons: ["Governed FK metadata", "Revenue KPI dependency"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 18, reportCount: 24, datasetCount: 6 }],
    ["REL-006", { id: "REL-006", sourceTable: "PDGM_PERIOD", sourceColumn: "epi_id", targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id", relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted", reasons: ["PDGM child-to-episode relationship", "LUPA KPI dependency"], createdBy: "system", createdDate: "2026-07-20", kpiCount: 9, reportCount: 14, datasetCount: 3 }],
    ["REL-007", { id: "REL-007", sourceTable: "WORKER_BASE", sourceColumn: "branch_code", targetTable: "BRANCHES", targetColumn: "branch_code", relationshipType: "ManyToOne", confidence: 0.95, status: "Suggested", reasons: ["Exact column match", "Naming convention"], createdBy: "inference", createdDate: "2026-07-20", kpiCount: 6, reportCount: 9, datasetCount: 2 }],
    ["REL-008", { id: "REL-008", sourceTable: "CLIENT_EPISODE_VISIT_NOTES", sourceColumn: "visit_id", targetTable: "CLIENT_EPISODE_VISITS_ALL", targetColumn: "visit_id", relationshipType: "ManyToOne", confidence: 0.97, status: "Suggested", reasons: ["Exact column match", "Child-to-parent pattern"], createdBy: "inference", createdDate: "2026-07-20", kpiCount: 4, reportCount: 6, datasetCount: 1 }],
  ]);

  const selected = (name: string, columns: Array<[string, string, boolean?, boolean?]>): SelectedTable => ({
    name,
    schema: name.includes(".") ? name.split(".")[0] : "dbo",
    columns: columns.map(([columnName, type, isPk = false, isFk = false]) => ({ name: columnName, type, nullable: !isPk, isPk, isFk })),
  });
  const base = (dataset: Omit<SemanticDataset, "history" | "selectedTables"> & { selectedTables?: SelectedTable[] }): SemanticDataset => ({
    ...dataset,
    selectedTables: normalizeSelectedTables(dataset.tables, dataset.selectedTables),
    history: [],
  });
  const datasets = new Map<string, SemanticDataset>();
  for (const dataset of [
    base({ datasetId: "DS-001", datasetName: "Acacia Enterprise Reporting", description: "Core enterprise semantic definition for episodes, branches, service lines, workers, and billing.", tables: ["CLIENT_EPISODES_ALL", "BRANCHES", "SERVICE_LINES", "WORKER_BASE", "Billing.LINE_ITEMS"], selectedTables: [selected("CLIENT_EPISODES_ALL", [["epi_id", "int", true], ["epi_branchcode", "varchar", false, true], ["epi_slid", "int", false, true], ["epi_SocDate", "date"], ["epi_DischargeDate", "date"], ["epi_payor", "varchar"]]), selected("BRANCHES", [["branch_code", "varchar", true], ["branch_name", "varchar"], ["region", "varchar"]]), selected("SERVICE_LINES", [["sl_id", "int", true], ["sl_name", "varchar"]]), selected("WORKER_BASE", [["worker_id", "int", true], ["branch_code", "varchar", false, true], ["discipline", "varchar"]]), selected("Billing.LINE_ITEMS", [["episode_id", "int", false, true], ["amount", "decimal"], ["service_date", "date"]])], relationships: ["REL-001", "REL-002", "REL-004", "REL-005"], dimensions: ["Branch", "Service Line", "Care Type", "Region", "Payor"], measures: ["Census", "Admissions", "Discharges", "Revenue", "Patient Days"], glossaryMappings: ["Census", "ADC", "Start of Care"], businessRules: ["Active episodes follow governed census semantics"], owner: "Analytics Team", version: "2.4.1", status: "Published", createdDate: "2026-01-15", updatedDate: "2026-07-20", publishedDate: "2026-02-01", createdBy: "admin", health: 98, publicationTargets: allTargets, sourceTraceability: ["Governed MSSQL metadata", "Canonical KPI registry"], virtual: true, authoritative: false, cacheScope: "process", rehydrationSource: "static-seed" }),
    base({ datasetId: "DS-002", datasetName: "PDGM & LUPA Analytics", description: "PDGM period-level semantic definition for LUPA rate analysis and reimbursement modeling.", tables: ["CLIENT_EPISODES_ALL", "PDGM_PERIOD", "BRANCHES"], selectedTables: [selected("CLIENT_EPISODES_ALL", [["epi_id", "int", true], ["epi_branchcode", "varchar", false, true], ["epi_SocDate", "date"]]), selected("PDGM_PERIOD", [["period_id", "int", true], ["epi_id", "int", false, true], ["hipps_code", "varchar"], ["period_number", "int"], ["reimbursement", "decimal"]]), selected("BRANCHES", [["branch_code", "varchar", true], ["branch_name", "varchar"]])], relationships: ["REL-001", "REL-006"], dimensions: ["Branch", "Period Number", "HIPPS Code", "Reimbursement Type"], measures: ["LUPA Rate", "Avg Visits per Period", "Revenue per Period"], glossaryMappings: ["LUPA", "PDGM"], businessRules: ["Periods are related to episodes by epi_id"], owner: "Revenue Cycle", version: "1.2.0", status: "Published", createdDate: "2026-03-10", updatedDate: "2026-07-20", publishedDate: "2026-03-20", createdBy: "admin", health: 94, publicationTargets: ["Report Studio", "Discover Data", "BI Studio", "KPI Intelligence"], sourceTraceability: ["Governed MSSQL metadata", "PDGM semantic rules"], virtual: true, authoritative: false, cacheScope: "process", rehydrationSource: "static-seed" }),
    base({ datasetId: "DS-003", datasetName: "Worker Productivity Dataset", description: "Visit and point productivity semantic definition for clinician performance reporting.", tables: ["WORKER_BASE", "CLIENT_EPISODE_VISITS_ALL", "BRANCHES"], relationships: ["REL-004", "REL-007"], dimensions: ["Worker", "Branch", "Discipline", "Visit Type"], measures: ["Total Points", "Achievement %", "Visits per Day"], glossaryMappings: ["Productivity", "Visit Points"], businessRules: [], owner: "Operations", version: "1.0.3", status: "Draft", createdDate: "2026-05-20", updatedDate: "2026-07-20", createdBy: "analyst", health: 82, publicationTargets: [], sourceTraceability: ["Governed MSSQL metadata"], virtual: true, authoritative: false, cacheScope: "process", rehydrationSource: "static-seed" }),
  ]) datasets.set(dataset.datasetId, dataset);

  return { datasets, relationships, draftParents: new Map(), datasetSequence: 4, relationshipSequence: 9 };
}

const globalRegistry = globalThis as typeof globalThis & { __virtualDatasetRegistry?: RegistryState };
const state = globalRegistry.__virtualDatasetRegistry ?? seededState();
globalRegistry.__virtualDatasetRegistry = state;

function nextId(kind: "dataset" | "relationship") {
  if (kind === "dataset") return `DS-${String(state.datasetSequence++).padStart(3, "0")}`;
  return `REL-${String(state.relationshipSequence++).padStart(3, "0")}`;
}

function bumpVersion(version: string, type: "minor" | "patch") {
  const [major = 1, minor = 0, patch = 0] = version.split(".").map(Number);
  return type === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

function snapshot(dataset: SemanticDataset, reason: string, savedBy: string): DatasetSnapshot {
  const { history: _history, ...definition } = clone(dataset);
  return { version: dataset.version, savedAt: isoNow(), savedBy, reason, definition };
}

export function listSemanticDatasets() { return [...state.datasets.values()].map(clone); }
export function getSemanticDataset(id: string) { const value = state.datasets.get(id); return value ? clone(value) : null; }
export function listRelationships() { return [...state.relationships.values()].map(clone); }
export function getRelationship(id: string) { const value = state.relationships.get(id); return value ? clone(value) : null; }

export function setRelationshipStatus(id: string, status: RelStatus) {
  const relationship = state.relationships.get(id);
  if (!relationship) return null;
  relationship.status = status;
  return clone(relationship);
}

export function createRelationship(input: Omit<Relationship, "id" | "createdDate">) {
  const relationship: Relationship = { ...input, id: nextId("relationship"), createdDate: day() };
  state.relationships.set(relationship.id, relationship);
  return clone(relationship);
}

export function createSemanticDataset(input: Partial<SemanticDataset>) {
  const datasetId = input.datasetId || nextId("dataset");
  if (state.datasets.has(datasetId)) return null;
  const now = isoNow();
  const dataset: SemanticDataset = {
    datasetId,
    datasetName: input.datasetName || "Untitled Dataset",
    description: input.description || "",
    tables: clone(input.tables || []),
    selectedTables: normalizeSelectedTables(input.tables || [], input.selectedTables),
    relationships: clone(input.relationships || []),
    dimensions: clone(input.dimensions || []),
    measures: clone(input.measures || []),
    glossaryMappings: clone(input.glossaryMappings || []),
    businessRules: clone(input.businessRules || []),
    owner: input.owner || "analyst",
    version: "1.0.0",
    status: "Draft",
    createdDate: day(now),
    updatedDate: now,
    createdBy: input.createdBy || "analyst",
    health: 50,
    publicationTargets: [],
    sourceTraceability: clone(input.sourceTraceability || ["Governed MSSQL metadata"]),
    virtual: true,
    authoritative: false,
    cacheScope: "process",
    rehydrationSource: "session-definition",
    history: [],
  };
  const health = computeHealth(dataset);
  dataset.health = health.score;
  dataset.healthBreakdown = health.breakdown;
  dataset.changeSummary = "Initial governed draft created";
  state.datasets.set(datasetId, dataset);
  return clone(dataset);
}

export function updateSemanticDataset(id: string, patch: Partial<SemanticDataset>, actor = "analyst") {
  const dataset = state.datasets.get(id);
  if (!dataset) return null;
  if (dataset.status === "Published") {
    const existingDraftId = state.draftParents.get(id);
    const existingDraft = existingDraftId ? state.datasets.get(existingDraftId) : null;
    if (existingDraft) return clone(existingDraft);
    const draftId = nextId("dataset");
    const now = isoNow();
    const draft = clone(dataset);
    draft.datasetId = draftId;
    draft.datasetName = String(patch.datasetName ?? dataset.datasetName);
    draft.status = "Draft";
    draft.version = bumpVersion(dataset.version, "patch");
    draft.updatedDate = now;
    draft.publishedDate = undefined;
    draft.publicationTargets = [];
    draft.rehydrationSource = "session-definition";
    draft.history = [snapshot(dataset, `Draft revision created from ${dataset.datasetId}`, actor)];
    for (const key of ["description", "tables", "selectedTables", "relationships", "dimensions", "measures", "glossaryMappings", "businessRules", "owner", "sourceTraceability"] as const) {
      const value = patch[key];
      if (value !== undefined) Object.assign(draft, { [key]: clone(value) });
    }
    draft.selectedTables = normalizeSelectedTables(draft.tables, draft.selectedTables);
    const health = computeHealth(draft);
    draft.health = health.score;
    draft.healthBreakdown = health.breakdown;
    draft.changeSummary = `Draft revision created from ${dataset.version}`;
    state.datasets.set(draftId, draft);
    state.draftParents.set(id, draftId);
    return clone(draft);
  }
  dataset.history = [...dataset.history, snapshot(dataset, "Definition updated", actor)].slice(-25);
  for (const key of ["datasetName", "description", "tables", "selectedTables", "relationships", "dimensions", "measures", "glossaryMappings", "businessRules", "owner", "sourceTraceability"] as const) {
    const value = patch[key];
    if (value !== undefined) Object.assign(dataset, { [key]: clone(value) });
  }
  dataset.selectedTables = normalizeSelectedTables(dataset.tables, dataset.selectedTables);
  const health = computeHealth(dataset);
  dataset.health = health.score;
  dataset.healthBreakdown = health.breakdown;
  dataset.changeSummary = patch.changeSummary || "Governed definition updated";
  dataset.status = "Draft";
  dataset.publicationTargets = [];
  dataset.version = bumpVersion(dataset.version, "patch");
  dataset.updatedDate = isoNow();
  return clone(dataset);
}

export function canRequestDatasetApproval(dataset: Pick<SemanticDataset, "status" | "health">) {
  return dataset.status === "Draft" && (dataset.health ?? 0) >= 70;
}

export function requestApproval(id: string, actor = "analyst") {
  const dataset = state.datasets.get(id);
  if (!dataset || !canRequestDatasetApproval(dataset)) return null;
  dataset.history = [...dataset.history, snapshot(dataset, "Submitted for approval", actor)].slice(-25);
  dataset.status = "Pending Approval";
  dataset.updatedDate = isoNow();
  return clone(dataset);
}

export function publishSemanticDataset(id: string, targets: PublicationTarget[], actor = "approver") {
  const dataset = state.datasets.get(id);
  if (!dataset || dataset.status === "Deprecated") return null;
  dataset.history = [...dataset.history, snapshot(dataset, "Certified virtual publication", actor)].slice(-25);
  dataset.status = "Published";
  dataset.version = bumpVersion(dataset.version, "minor");
  dataset.publishedDate = day();
  dataset.updatedDate = isoNow();
  dataset.health = Math.min(100, (dataset.health || 80) + 5);
  dataset.publicationTargets = [...new Set(targets.length ? targets : allTargets)];
  return clone(dataset);
}

export function deprecateSemanticDataset(id: string, actor = "approver") {
  const dataset = state.datasets.get(id);
  if (!dataset) return null;
  dataset.history = [...dataset.history, snapshot(dataset, "Dataset deprecated", actor)].slice(-25);
  dataset.status = "Deprecated";
  dataset.publicationTargets = [];
  dataset.updatedDate = isoNow();
  return clone(dataset);
}

export function compareSemanticDatasetVersion(id: string, version: string) {
  const dataset = state.datasets.get(id);
  const historical = dataset?.history.find((entry) => entry.version === version);
  if (!dataset || !historical) return null;
  return compareDatasetDefinitions(historical.definition, dataset);
}

export function restoreSemanticDatasetVersion(id: string, version: string, actor = "analyst") {
  const dataset = state.datasets.get(id);
  const historical = dataset?.history.find((entry) => entry.version === version);
  if (!dataset || !historical) return null;
  const draftId = nextId("dataset");
  const restored = clone(historical.definition) as SemanticDataset;
  restored.datasetId = draftId;
  restored.datasetName = `${dataset.datasetName} · restored draft`;
  restored.version = bumpVersion(dataset.version, "patch");
  restored.status = "Draft";
  restored.updatedDate = isoNow();
  restored.publishedDate = undefined;
  restored.publicationTargets = [];
  restored.rehydrationSource = "session-definition";
  restored.restoredFromVersion = version;
  restored.changeSummary = `Restored from immutable version ${version}`;
  restored.selectedTables = normalizeSelectedTables(restored.tables, restored.selectedTables);
  const health = computeHealth(restored);
  restored.health = health.score;
  restored.healthBreakdown = health.breakdown;
  restored.history = [...dataset.history, snapshot(dataset, `Restore requested from ${version}`, actor)].slice(-25);
  state.datasets.set(draftId, restored);
  state.draftParents.set(id, draftId);
  return clone(restored);
}

export function deleteSemanticDataset(id: string) {
  const dataset = state.datasets.get(id);
  if (!dataset || dataset.status === "Published") return false;
  return state.datasets.delete(id);
}

export function deleteRelationship(id: string) { return state.relationships.delete(id); }
export function getRegistryScope() { return { tables: 125, columns: 3421, relationships: state.relationships.size, datasets: state.datasets.size, kpis: 49, reports: 72, lastRefresh: isoNow(), cacheScope: "process", authoritative: false }; }
export function getPublicationTargets() { return [...allTargets]; }
