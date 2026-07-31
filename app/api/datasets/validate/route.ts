import { NextRequest, NextResponse } from "next/server";
import { validateDataset } from "@/lib/validation/datasetValidation";
import { ingestEvent } from "@/lib/intelligence/detection";
import { getDatasetValidation, listDatasetValidations, saveDatasetValidation } from "@/lib/validation/datasetValidationRegistry";

export async function GET(request: NextRequest) {
  const datasetId = new URL(request.url).searchParams.get("datasetId");
  if (datasetId) {
    const record = getDatasetValidation(datasetId);
    return record
      ? NextResponse.json(record)
      : NextResponse.json({ error: `No validation found for '${datasetId}'` }, { status: 404 });
  }
  return NextResponse.json({ validations: listDatasetValidations() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Parameters<typeof validateDataset>[0] | null;
  if (!body?.datasetId || !Array.isArray(body.tables)) return NextResponse.json({ error: "datasetId and tables are required" }, { status: 400 });
  const validation = validateDataset(body);
  const record = saveDatasetValidation({
    validation,
    tableCount: body.tables.length,
    relationshipCount: body.relationshipCount,
    updatedAt: new Date().toISOString(),
  });
  const intelligence = ingestEvent({ eventType: "SQL Validation Completed", entityType: "dataset", entityId: body.datasetId, entityName: body.datasetId, actionBy: "Validation Engine", sourceSystem: "Dataset Builder", metadata: { columns: body.tables.flatMap((table) => table.columns.map((column) => column.name)), validationScore: validation.score, detectedKpis: validation.detectedKpis, missingInputs: validation.missingInputs } });
  return NextResponse.json({ validation, record, intelligence });
}
