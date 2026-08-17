export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  createRelationship,
  createSemanticDataset,
  deleteRelationship,
  deleteSemanticDataset,
  deprecateSemanticDataset,
  getPublicationTargets,
  getRegistryScope,
  getRelationship,
  getSemanticDataset,
  listRelationships,
  listSemanticDatasets,
  publishSemanticDataset,
  requestApproval,
  restoreSemanticDatasetVersion,
  compareSemanticDatasetVersion,
  setRelationshipStatus,
  updateSemanticDataset,
  type PublicationTarget,
  type RelType,
} from "@/lib/datasets/virtualDatasetRegistry";
import { canPublishDataset, getDatasetValidation } from "@/lib/validation/datasetValidationRegistry";
import { buildDatasetExport } from "@/lib/datasets/datasetGovernance";

type InferenceInput = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  sourceType?: string;
  targetType?: string;
};

function inferRelationship(input: InferenceInput) {
  const reasons: string[] = [];
  let confidence = 0.5;
  if (input.sourceColumn.toLowerCase() === input.targetColumn.toLowerCase()) {
    confidence += 0.2;
    reasons.push("Exact column name match");
  }
  if (/(_id|_code)$/i.test(input.sourceColumn)) {
    confidence += 0.15;
    reasons.push("Foreign-key naming pattern");
  }
  if (input.sourceType && input.targetType && input.sourceType.toLowerCase() === input.targetType.toLowerCase()) {
    confidence += 0.1;
    reasons.push(`Matching data types (${input.sourceType})`);
  }
  if (input.sourceTable.startsWith("CLIENT_EPISODES") || input.targetTable.startsWith("CLIENT_EPISODES")) {
    confidence += 0.08;
    reasons.push("Governed KPI relationship evidence");
  }
  return {
    detected: confidence > 0.6,
    ...input,
    relationshipType: (/(_id|_code)$/i.test(input.targetColumn) ? "ManyToOne" : "OneToMany") as RelType,
    confidence: Math.min(0.99, confidence),
    reasons,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const type = searchParams.get("type") ?? "datasets";

  if (type === "relationships") {
    if (id) {
      const relationship = getRelationship(id);
      return relationship
        ? NextResponse.json(relationship)
        : NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
    }
    const status = searchParams.get("status");
    const relationships = listRelationships().filter((relationship) => !status || relationship.status === status);
    return NextResponse.json({ relationships, total: relationships.length, cacheScope: "process", authoritative: false });
  }

  if (id) {
    const dataset = getSemanticDataset(id);
    return dataset
      ? NextResponse.json(dataset)
      : NextResponse.json({ error: `Dataset '${id}' not found` }, { status: 404 });
  }

  const status = searchParams.get("status");
  const datasets = listSemanticDatasets().filter((dataset) => !status || dataset.status === status);
  return NextResponse.json({
    datasets,
    total: datasets.length,
    relationships: listRelationships(),
    publicationTargets: getPublicationTargets(),
    scope: getRegistryScope(),
    notice: "Virtual process-local definitions only. No physical tables or source records are created or changed.",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "infer") {
    const inference = inferRelationship({
      sourceTable: String(body.sourceTable ?? ""),
      sourceColumn: String(body.sourceColumn ?? ""),
      targetTable: String(body.targetTable ?? ""),
      targetColumn: String(body.targetColumn ?? ""),
      sourceType: body.sourceType as string | undefined,
      targetType: body.targetType as string | undefined,
    });
    return NextResponse.json({ success: true, inference });
  }

  if (action === "accept_rel") {
    const id = String(body.id ?? "");
    const existing = id ? setRelationshipStatus(id, "Accepted") : null;
    if (existing) return NextResponse.json({ success: true, relationship: existing });
    const relationship = createRelationship({
      sourceTable: String(body.sourceTable ?? ""),
      sourceColumn: String(body.sourceColumn ?? ""),
      targetTable: String(body.targetTable ?? ""),
      targetColumn: String(body.targetColumn ?? ""),
      relationshipType: (body.relationshipType as RelType) ?? "ManyToOne",
      confidence: typeof body.confidence === "number" ? body.confidence : 0.9,
      status: "Accepted",
      reasons: Array.isArray(body.reasons) ? body.reasons.map(String) : [],
      createdBy: String(body.createdBy ?? "analyst"),
      kpiCount: 0,
      reportCount: 0,
      datasetCount: 0,
    });
    return NextResponse.json({ success: true, relationship }, { status: 201 });
  }

  if (action === "reject_rel") {
    const id = String(body.id ?? "");
    const relationship = setRelationshipStatus(id, "Rejected");
    return relationship
      ? NextResponse.json({ success: true, relationship })
      : NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
  }

  if (action === "create_dataset") {
    const dataset = createSemanticDataset(body);
    return dataset
      ? NextResponse.json({ success: true, dataset }, { status: 201 })
      : NextResponse.json({ error: `Dataset '${String(body.datasetId)}' already exists` }, { status: 409 });
  }

  if (action === "update_dataset") {
    const datasetId = String(body.datasetId ?? "");
    const dataset = updateSemanticDataset(datasetId, body, String(body.actor ?? "analyst"));
    return dataset
      ? NextResponse.json({ success: true, dataset })
      : NextResponse.json({ error: `Dataset '${datasetId}' not found` }, { status: 404 });
  }

  if (action === "request_approval") {
    const datasetId = String(body.datasetId ?? "");
    const current = getSemanticDataset(datasetId);
    if (!current) return NextResponse.json({ error: `Dataset '${datasetId}' not found` }, { status: 404 });
    if (current.status !== "Draft") return NextResponse.json({ error: "Only draft datasets can be submitted for approval" }, { status: 422 });
    if ((current.health ?? 0) < 70) {
      return NextResponse.json({ error: `Dataset health must be at least 70% before approval (current: ${current.health ?? 0}%)` }, { status: 422 });
    }
    const dataset = requestApproval(datasetId, String(body.actor ?? "analyst"));
    return dataset ? NextResponse.json({ success: true, dataset }) : NextResponse.json({ error: `Dataset '${datasetId}' cannot be submitted` }, { status: 422 });
  }

  if (action === "publish_dataset") {
    const datasetId = String(body.datasetId ?? "");
    const current = getSemanticDataset(datasetId);
    if (!current) return NextResponse.json({ error: `Dataset '${datasetId}' not found` }, { status: 404 });
    if (current.status !== "Pending Approval") {
      return NextResponse.json({ error: "Only datasets pending approval can be certified and published" }, { status: 422 });
    }
    const validation = getDatasetValidation(datasetId);
    if (!canPublishDataset(datasetId, current.health ?? 0)) {
      return NextResponse.json({ error: "Dataset health or a fresh validation score must be at least 70% with no failing checks before publishing", validation: validation?.validation ?? null }, { status: 422 });
    }
    const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : getPublicationTargets();
    const allowedTargets = getPublicationTargets();
    const targets = requestedTargets.filter((target): target is PublicationTarget => allowedTargets.includes(target as PublicationTarget));
    const dataset = publishSemanticDataset(datasetId, targets, String(body.actor ?? "approver"));
    return dataset
      ? NextResponse.json({ success: true, dataset, publication: { virtual: true, targets: dataset.publicationTargets, physicalObjectsCreated: 0 } })
      : NextResponse.json({ error: `Dataset '${datasetId}' cannot be published` }, { status: 422 });
  }

  if (action === "compare_version") {
    const datasetId = String(body.datasetId ?? "");
    const version = String(body.version ?? "");
    const diff = compareSemanticDatasetVersion(datasetId, version);
    return diff ? NextResponse.json({ success: true, diff }) : NextResponse.json({ error: "Dataset version not found" }, { status: 404 });
  }

  if (action === "restore_version") {
    const datasetId = String(body.datasetId ?? "");
    const version = String(body.version ?? "");
    if (!datasetId || !/^\d+\.\d+\.\d+$/.test(version)) return NextResponse.json({ error: "A valid datasetId and semantic version are required" }, { status: 400 });
    const dataset = restoreSemanticDatasetVersion(datasetId, version, String(body.actor ?? "analyst"));
    return dataset ? NextResponse.json({ success: true, dataset }, { status: 201 }) : NextResponse.json({ error: "Dataset version not found" }, { status: 404 });
  }

  if (action === "export_metadata") {
    const datasetId = String(body.datasetId ?? "");
    const format = String(body.format ?? "json");
    if (!["json", "yaml", "dictionary", "lineage", "graph"].includes(format)) return NextResponse.json({ error: "Unsupported export format" }, { status: 400 });
    const dataset = getSemanticDataset(datasetId);
    if (!dataset) return NextResponse.json({ error: `Dataset '${datasetId}' not found` }, { status: 404 });
    const asset = buildDatasetExport(dataset, format as "json" | "yaml" | "dictionary" | "lineage" | "graph");
    const safeName = dataset.datasetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || dataset.datasetId.toLowerCase();
    return NextResponse.json({ success: true, filename: `${safeName}-v${dataset.version}-${format}.${asset.extension}`, ...asset });
  }

  if (action === "deprecate_dataset") {
    const datasetId = String(body.datasetId ?? "");
    const dataset = deprecateSemanticDataset(datasetId, String(body.actor ?? "approver"));
    return dataset ? NextResponse.json({ success: true, dataset }) : NextResponse.json({ error: `Dataset '${datasetId}' not found` }, { status: 404 });
  }

  return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const type = searchParams.get("type") ?? "datasets";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (type === "relationships") {
    return deleteRelationship(id)
      ? NextResponse.json({ success: true, id })
      : NextResponse.json({ error: `Relationship '${id}' not found` }, { status: 404 });
  }

  const dataset = getSemanticDataset(id);
  if (!dataset) return NextResponse.json({ error: `Dataset '${id}' not found` }, { status: 404 });
  if (dataset.status === "Published") return NextResponse.json({ error: "Cannot delete a published dataset; deprecate it first" }, { status: 422 });
  return NextResponse.json({ success: deleteSemanticDataset(id), id });
}
