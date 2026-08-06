import { NextRequest, NextResponse } from "next/server";
import { validateDataset } from "@/lib/validation/datasetValidation";
import { ingestEvent } from "@/lib/intelligence/detection";
import { createHash } from "node:crypto";
import {
  getDatasetValidation,
  getDatasetValidationCacheDiagnostics,
  getDatasetValidationSnapshot,
  listDatasetValidations,
  saveDatasetValidation,
} from "@/lib/validation/datasetValidationRegistry";

export async function GET(request: NextRequest) {
  const datasetId = new URL(request.url).searchParams.get("datasetId");
  if (datasetId) {
    const record = getDatasetValidation(datasetId);
    return record
      ? NextResponse.json(record)
      : NextResponse.json({ error: `No validation found for '${datasetId}'` }, { status: 404 });
  }
  return NextResponse.json({
    validations: listDatasetValidations(),
    cache: getDatasetValidationCacheDiagnostics(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as (Parameters<typeof validateDataset>[0] & { force?: boolean }) | null;
  if (!body?.datasetId || !Array.isArray(body.tables)) return NextResponse.json({ error: "datasetId and tables are required" }, { status: 400 });
  const fingerprint = createHash("sha256").update(JSON.stringify({
    datasetId: body.datasetId,
    relationshipCount: body.relationshipCount,
    tables: body.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => [column.name, column.type, column.nullable, column.isPk]),
    })),
  })).digest("hex");
  const cached = body.force ? null : getDatasetValidationSnapshot(body.datasetId, fingerprint);
  if (cached) {
    return NextResponse.json({
      validation: cached.validation,
      record: cached,
      cache: { hit: true, fingerprint, diagnostics: getDatasetValidationCacheDiagnostics() },
    });
  }
  const validation = validateDataset(body);
  const record = saveDatasetValidation({
    validation,
    tableCount: body.tables.length,
    relationshipCount: body.relationshipCount,
    updatedAt: new Date().toISOString(),
    fingerprint,
  });
  const intelligence = ingestEvent({ eventType: "SQL Validation Completed", entityType: "dataset", entityId: body.datasetId, entityName: body.datasetId, actionBy: "Validation Engine", sourceSystem: "Dataset Builder", metadata: { columns: body.tables.flatMap((table) => table.columns.map((column) => column.name)), validationScore: validation.score, detectedKpis: validation.detectedKpis, missingInputs: validation.missingInputs } });
  return NextResponse.json({ validation, record, intelligence, cache: { hit: false, fingerprint, diagnostics: getDatasetValidationCacheDiagnostics() } });
}
