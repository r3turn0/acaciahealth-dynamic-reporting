import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestEvent } from "@/lib/intelligence/detection";
import { setVirtualAsset, virtualMetadata } from "@/lib/services/virtualAssetCache";

const SaveReportBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  userQuery: z.string().max(4_000),
  sql: z.string().trim().min(1).max(100_000),
  columns: z.array(z.string().max(256)).max(500),
  rowCount: z.number().int().nonnegative().default(0),
  vectorSources: z.array(z.string().max(256)).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = SaveReportBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const id = crypto.randomUUID();
  const report = {
    id,
    name: data.name,
    userQuery: data.userQuery,
    sql: data.sql,
    columns: data.columns,
    rowCount: data.rowCount,
    createdAt: new Date().toISOString(),
    vectorSources: data.vectorSources ?? [],
    ...virtualMetadata("Report Studio request and canonical report definitions"),
  };

  setVirtualAsset("report", id, report);

  const intelligence = ingestEvent({
    eventType: "Report Saved",
    entityType: "report",
    entityId: id,
    entityName: data.name,
    actionBy: "Current User",
    sourceSystem: "Report Studio virtual cache",
    metadata: {
      columns: data.columns,
      rowCount: data.rowCount,
      cacheScope: "process",
      authoritative: false,
    },
  });

  return NextResponse.json({ report, intelligence }, { status: 201 });
}
