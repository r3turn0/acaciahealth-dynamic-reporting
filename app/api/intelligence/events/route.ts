import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestEvent } from "@/lib/intelligence/detection";

const schema = z.object({ eventType: z.string().min(1), entityType: z.string().min(1), entityId: z.string().min(1), entityName: z.string().min(1), actionBy: z.string().default("System"), sourceSystem: z.string().default("Application"), metadata: z.record(z.string(), z.unknown()).default({}) });
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event", details: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json({ result: ingestEvent(parsed.data) }, { status: 202 });
}
