import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { intelligenceStore } from "@/lib/intelligence/store";

const schema = z.object({ action: z.enum(["read", "resolve", "reopen"]) });
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const alert = intelligenceStore.alert(id);
  return alert ? NextResponse.json({ alert }) : NextResponse.json({ error: "Alert not found" }, { status: 404 });
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const status = parsed.data.action === "resolve" ? "resolved" : parsed.data.action === "reopen" ? "open" : "read";
  const alert = intelligenceStore.updateAlert(id, { status, resolvedAt: status === "resolved" ? new Date().toISOString() : undefined });
  return alert ? NextResponse.json({ alert }) : NextResponse.json({ error: "Alert not found" }, { status: 404 });
}
