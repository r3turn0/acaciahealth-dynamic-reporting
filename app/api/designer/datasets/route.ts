export const runtime = "nodejs";

/**
 * /api/designer/datasets
 *
 * In-memory Dataset Designer registry.
 * Persists semantic datasets, relationships, and inferred relationship actions
 * for the lifetime of the server process.
 *
 * GET  /api/designer/datasets            — list all datasets
 * GET  /api/designer/datasets?id=DS-001  — get single dataset
 * POST /api/designer/datasets            — create/update dataset  { action, ... }
 * DELETE /api/designer/datasets?id=...   — delete dataset
 *
 * POST actions:
 *   create_dataset  — create a new semantic dataset
 *   update_dataset  — update fields of an existing dataset
 *   publish_dataset — set status → Published + bump version
 *   accept_rel      — accept an inferred relationship
 *   reject_rel      — reject an inferred relationship
 *   infer           — run smart inference for a column pair (returns suggestion)
 */

import { NextRequest, NextResponse } from "next/server";
import { getDatasetValidation } from "@/lib/validation/datasetValidationRegistry";

// ── Types ──────────────────────────────────────────────────────────────────────

type RelType   = "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany";
type RelStatus = "Suggested" | "Accepted" | "Rejected";
type DatasetStatus = "Draft" | "Published" | "Deprecated";

interface Relationship {
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

interface SemanticDataset {
  datasetId: string;
  datasetName: string;
  description: string;
  tables: string[];
  relationships: string[];
  dimensions: string[];
  measures: string[];
  owner: string;
  version: string;
  status: DatasetStatus;
  createdDate: string;
  publishedDate?: string;
  createdBy: string;
  health?: number;
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const relationships: Map<string, Relationship> = new Map([
  ["REL-001", {
    id: "REL-001", sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_branchcode",
    targetTable: "BRANCHES", targetColumn: "branch_code",
    relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted",
    reasons: ["Matching data types (varchar)", "95% value overlap", "Used in 42 existing SQL joins", "Referenced by 49 KPI definitions"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 49, reportCount: 72, datasetCount: 12,
  }],
  ["REL-002", {
    id: "REL-002", sourceTable: "CLIENT_EPISODES_ALL", sourceColumn: "epi_slid",
    targetTable: "SERVICE_LINES", targetColumn: "service_line_id",
    relationshipType: "ManyToOne", confidence: 0.96, status: "Accepted",
    reasons: ["Exact _id suffix pattern", "100% value overlap", "Used in 38 existing SQL joins"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 38, reportCount: 55, datasetCount: 8,
  }],
  ["REL-003", {
    id: "REL-003", sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted",
    reasons: ["Exact column name match", "FK metadata declaration", "100% referential integrity"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 22, reportCount: 31, datasetCount: 5,
  }],
  ["REL-004", {
    id: "REL-004", sourceTable: "CLIENT_EPISODE_VISITS_ALL", sourceColumn: "worker_id",
    targetTable: "WORKER_BASE", targetColumn: "worker_id",
    relationshipType: "ManyToOne", confidence: 0.97, status: "Accepted",
    reasons: ["Exact column name match", "Matching int type", "Used in 12 productivity queries"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 12, reportCount: 18, datasetCount: 3,
  }],
  ["REL-005", {
    id: "REL-005", sourceTable: "Billing.LINE_ITEMS", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.98, status: "Accepted",
    reasons: ["Exact column name match", "FK metadata declaration", "Revenue KPI dependency"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 18, reportCount: 24, datasetCount: 6,
  }],
  ["REL-006", {
    id: "REL-006", sourceTable: "PDGM_PERIOD", sourceColumn: "epi_id",
    targetTable: "CLIENT_EPISODES_ALL", targetColumn: "epi_id",
    relationshipType: "ManyToOne", confidence: 0.99, status: "Accepted",
    reasons: ["Exact column name match", "PDGM period is child of episode", "Referenced by LUPA KPI"],
    createdBy: "system", createdDate: "2026-07-20", kpiCount: 9, reportCount: 14, datasetCount: 3,
  }],
  ["REL-007", {
    id: "REL-007", sourceTable: "WORKER_BASE", sourceColumn: "branch_code",
    targetTable: "BRANCHES", targetColumn: "branch_code",
    relationshipType: "ManyToOne", confidence: 0.95, status: "Suggested",
    reasons: ["Exact column name match", "Matching varchar type", "Inferred from naming convention"],
    createdBy: "inference", createdDate: "2026-07-20", kpiCount: 6, reportCount: 9, datasetCount: 2,
  }],
  ["REL-008", {
    id: "REL-008", sourceTable: "CLIENT_EPISODE_VISIT_NOTES", sourceColumn: "visit_id",
    targetTable: "CLIENT_EPISODE_VISITS_ALL", targetColumn: "visit_id",
    relationshipType: "ManyToOne", confidence: 0.97, status: "Suggested",
    reasons: ["Exact column name match", "Child-to-parent relationship pattern"],
    createdBy: "inference", createdDate: "2026-07-20", kpiCount: 4, reportCount: 6, datasetCount: 1,
  }],
]);

const datasets: Map<string, SemanticDataset> = new Map([
  ["DS-001", {
    datasetId: "DS-001", datasetName: "Acacia Enterprise Reporting",
    description: "Core enterprise dataset — episodes, branches, service lines, and billing.",
    tables: ["CLIENT_EPISODES_ALL", "BRANCHES", "SERVICE_LINES", "WORKER_BASE", "Billing.LINE_ITEMS"],
    relationships: ["REL-001", "REL-002", "REL-004", "REL-005"],
    dimensions: ["Branch", "Service Line", "Care Type", "Region", "Payor"],
    measures: ["Census", "Admissions", "Discharges", "Revenue", "Patient Days"],
    owner: "Analytics Team", version: "2.4.1", status: "Published",
    createdDate: "2026-01-15", publishedDate: "2026-02-01",
    createdBy: "admin", health: 98,
  }],
  ["DS-002", {
    datasetId: "DS-002", datasetName: "PDGM & LUPA Analytics",
    description: "PDGM period-level dataset for LUPA rate analysis and reimbursement modeling.",
    tables: ["CLIENT_EPISODES_ALL", "PDGM_PERIOD", "BRANCHES"],
    relationships: ["REL-001", "REL-006"],
    dimensions: ["Branch", "Period Number", "HIPPS Code", "Reimbursement Type"],
    measures: ["LUPA Rate", "Avg Visits per Period", "Revenue per Period"],
    owner: "Revenue Cycle", version: "1.2.0", status: "Published",
    createdDate: "2026-03-10", publishedDate: "2026-03-20",
    createdBy: "admin", health: 94,
  }],
  ["DS-003", {
    datasetId: "DS-003", datasetName: "Worker Productivity Dataset",
    description: "Visit and point productivity dataset for clinician performance reporting.",
    tables: ["WORKER_BASE", "CLIENT_EPISODE_VISITS_ALL", "BRANCHES"],
    relationships: ["REL-004", "REL-007"],
    dimensions: ["Worker", "Branch", "Discipline", "Visit Type"],
    measures: ["Total Points", "Achievement %", "Visits per Day"],
    owner: "Operations", version: "1.0.3", status: "Draft",
    createdDate: "2026-05-20",
    createdBy: "analyst", health: 82,
  }],
]);

let relSeq = 9;
let dsSeq  = 4;

function nextRelId() { return `REL-${String(relSeq++).padStart(3, "0")}`; }
function nextDsId()  { return `DS-${String(dsSeq++).padStart(3, "0")}`; }

function bumpVer(v: string, type: "major" | "minor" | "patch" = "minor") {
  const [maj, min, rev] = v.split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${(rev ?? 0) + 1}`;
}

// ── Inference engine ──────────────────────────────────────────────────────────

interface InferenceInput {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  sourceType?: string;
  targetType?: string;
}

interface InferenceResult {
  detected: boolean;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: RelType;
  confidence: number;
  reasons: string[];
}

function inferRelationship(input: InferenceInput): InferenceResult {
  const { sourceTable, sourceColumn, targetTable, targetColumn, sourceType, targetType } = input;
  const reasons: string[] = [];
  let confidence = 0.5;

  // Exact column name match
  if (sourceColumn.toLowerCase() === targetColumn.toLowerCase()) {
    confidence += 0.2;
    reasons.push("Exact column name match");
  }

  // Column name contains target table name
  const tgtBase = targetTable.replace(/[._]/g, "").toLowerCase();
  const srcColLower = sourceColumn.toLowerCase();
  if (srcColLower.includes(tgtBase.slice(0, 5)) || srcColLower.endsWith("_code") || srcColLower.endsWith("_id")) {
    confidence += 0.15;
    reasons.push("FK naming pattern (_code / _id suffix)");
  }

  // Type match
  if (sourceType && targetType && sourceType.toLowerCase() === targetType.toLowerCase()) {
    confidence += 0.1;
    reasons.push(`Matching data types (${sourceType})`);
  }

  // High value overlap heuristic — simulate based on known pairs
  const knownPairs = [
    { s: "epi_branchcode", t: "branch_code" },
    { s: "epi_id",         t: "epi_id" },
    { s: "worker_id",      t: "worker_id" },
    { s: "invoice_id",     t: "invoice_id" },
    { s: "visit_id",       t: "visit_id" },
    { s: "branch_code",    t: "branch_code" },
  ];
  const isKnownPair = knownPairs.some(
    (p) => p.s === sourceColumn.toLowerCase() && p.t === targetColumn.toLowerCase()
  );
  if (isKnownPair) {
    confidence += 0.12;
    reasons.push("High value overlap from existing join analysis");
  }

  // Existing SQL join patterns
  if (
    (sourceTable === "CLIENT_EPISODES_ALL" && targetTable === "BRANCHES") ||
    (sourceTable === "CLIENT_EPISODE_VISITS_ALL" && targetTable === "CLIENT_EPISODES_ALL")
  ) {
    confidence += 0.08;
    reasons.push("Used in existing SQL join patterns");
  }

  // KPI usage
  if (sourceTable.startsWith("CLIENT_EPISODES") || targetTable.startsWith("CLIENT_EPISODES")) {
    reasons.push("Referenced by active KPI definitions");
    confidence += 0.05;
  }

  confidence = Math.min(0.99, confidence);

  // Determine cardinality — target PK-like columns → ManyToOne
  const isPkColumn = (col: string) =>
    !col.includes("_") || col.endsWith("_id") || col.endsWith("_code");

  const relType: RelType = isPkColumn(targetColumn) ? "ManyToOne" : "OneToMany";

  return {
    detected: confidence > 0.6,
    sourceTable,
    sourceColumn,
    targetTable,
    targetColumn,
    relationshipType: relType,
    confidence,
    reasons,
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id   = searchParams.get("id");
  const type = searchParams.get("type") ?? "datasets";

  if (type === "relationships") {
    if (id) {
      const rel = relationships.get(id);
      if (!rel) return NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
      return NextResponse.json(rel);
    }
    const status = searchParams.get("status");
    let rels = [...relationships.values()];
    if (status) rels = rels.filter((r) => r.status === status);
    return NextResponse.json({ relationships: rels, total: rels.length });
  }

  // datasets
  if (id) {
    const ds = datasets.get(id);
    if (!ds) return NextResponse.json({ error: `Dataset '${id}' not found` }, { status: 404 });
    return NextResponse.json(ds);
  }
  const status = searchParams.get("status");
  let dsList = [...datasets.values()];
  if (status) dsList = dsList.filter((d) => d.status === status);
  return NextResponse.json({
    datasets: dsList,
    total: dsList.length,
    relationships: [...relationships.values()],
    scope: {
      tables: 125,
      columns: 3421,
      relationships: relationships.size,
      datasets: datasets.size,
      kpis: 49,
      reports: 72,
      lastRefresh: new Date().toISOString(),
    },
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action as string;

  // ── INFER ────────────────────────────────────────────────────────────────────
  if (action === "infer") {
    const result = inferRelationship({
      sourceTable:  String(body.sourceTable ?? ""),
      sourceColumn: String(body.sourceColumn ?? ""),
      targetTable:  String(body.targetTable ?? ""),
      targetColumn: String(body.targetColumn ?? ""),
      sourceType:   body.sourceType as string | undefined,
      targetType:   body.targetType as string | undefined,
    });
    return NextResponse.json({ success: true, inference: result });
  }

  // ── ACCEPT RELATIONSHIP ───────────────────────────────────────────────────────
  if (action === "accept_rel") {
    const id = body.id as string;
    if (id) {
      // existing — update status
      const rel = relationships.get(id);
      if (rel) {
        rel.status = "Accepted";
        return NextResponse.json({ success: true, relationship: rel });
      }
    }
    // new relationship from drag-drop
    const newId = nextRelId();
    const newRel: Relationship = {
      id: newId,
      sourceTable:  String(body.sourceTable ?? ""),
      sourceColumn: String(body.sourceColumn ?? ""),
      targetTable:  String(body.targetTable ?? ""),
      targetColumn: String(body.targetColumn ?? ""),
      relationshipType: (body.relationshipType as RelType) ?? "ManyToOne",
      confidence:   typeof body.confidence === "number" ? body.confidence : 0.9,
      status: "Accepted",
      reasons: Array.isArray(body.reasons) ? body.reasons as string[] : [],
      createdBy: String(body.createdBy ?? "analyst"),
      createdDate: new Date().toISOString().split("T")[0],
      kpiCount: 0, reportCount: 0, datasetCount: 0,
    };
    relationships.set(newId, newRel);
    return NextResponse.json({ success: true, relationship: newRel }, { status: 201 });
  }

  // ── REJECT RELATIONSHIP ─────────────���─────────────────────────────────────────
  if (action === "reject_rel") {
    const id = String(body.id ?? "");
    const rel = relationships.get(id);
    if (!rel) return NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
    rel.status = "Rejected";
    return NextResponse.json({ success: true, relationship: rel });
  }

  // ── CREATE DATASET ────────────────────────────────────────────────────────────
  if (action === "create_dataset") {
    const dsId = body.datasetId as string || nextDsId();
    if (datasets.has(dsId)) {
      return NextResponse.json({ error: `Dataset '${dsId}' already exists` }, { status: 409 });
    }
    const newDs: SemanticDataset = {
      datasetId:    dsId,
      datasetName:  String(body.datasetName ?? "Untitled Dataset"),
      description:  String(body.description ?? ""),
      tables:       Array.isArray(body.tables)        ? body.tables as string[]        : [],
      relationships:Array.isArray(body.relationships) ? body.relationships as string[] : [],
      dimensions:   Array.isArray(body.dimensions)    ? body.dimensions as string[]    : [],
      measures:     Array.isArray(body.measures)      ? body.measures as string[]      : [],
      owner:        String(body.owner ?? "analyst"),
      version:      "1.0.0",
      status:       "Draft",
      createdDate:  new Date().toISOString().split("T")[0],
      createdBy:    String(body.createdBy ?? "analyst"),
      health:       50,
    };
    datasets.set(dsId, newDs);
    return NextResponse.json({ success: true, dataset: newDs }, { status: 201 });
  }

  // ── UPDATE DATASET ────────────────────────────────────────────────────────────
  if (action === "update_dataset") {
    const dsId = String(body.datasetId ?? "");
    const ds = datasets.get(dsId);
    if (!ds) return NextResponse.json({ error: `Dataset '${dsId}' not found` }, { status: 404 });
    if (body.datasetName)   ds.datasetName  = String(body.datasetName);
    if (body.description)   ds.description  = String(body.description);
    if (Array.isArray(body.tables))         ds.tables         = body.tables as string[];
    if (Array.isArray(body.relationships))  ds.relationships  = body.relationships as string[];
    if (Array.isArray(body.dimensions))     ds.dimensions     = body.dimensions as string[];
    if (Array.isArray(body.measures))       ds.measures       = body.measures as string[];
    if (body.owner)         ds.owner        = String(body.owner);
    ds.version = bumpVer(ds.version, "patch");
    return NextResponse.json({ success: true, dataset: ds });
  }

  // ── PUBLISH DATASET ───────────────────────────────────────────────────────────
  if (action === "publish_dataset") {
    const dsId = String(body.datasetId ?? "");
    const ds = datasets.get(dsId);
    if (!ds) return NextResponse.json({ error: `Dataset '${dsId}' not found` }, { status: 404 });
    const validationRecord = getDatasetValidation(dsId);
    if (!validationRecord || validationRecord.validation.status === "Failed" || validationRecord.validation.score < 70) {
      return NextResponse.json({
        error: "Dataset must pass validation with a score of 70 or higher before publishing",
        validation: validationRecord?.validation ?? null,
      }, { status: 422 });
    }
    ds.status = "Published";
    ds.version = bumpVer(ds.version, "minor");
    ds.publishedDate = new Date().toISOString().split("T")[0];
    ds.health = Math.min(100, (ds.health ?? 80) + 5);
    return NextResponse.json({ success: true, dataset: ds });
  }

  return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id   = searchParams.get("id");
  const type = searchParams.get("type") ?? "datasets";

  if (type === "relationships") {
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const rel = relationships.get(id);
    if (!rel) return NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
    relationships.delete(id);
    return NextResponse.json({ success: true, id });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ds = datasets.get(id);
  if (!ds) return NextResponse.json({ error: `Dataset '${id}' not found` }, { status: 404 });
  if (ds.status === "Published") {
    return NextResponse.json({ error: "Cannot delete a published dataset — deprecate it first" }, { status: 422 });
  }
  datasets.delete(id);
  return NextResponse.json({ success: true, id });
}
