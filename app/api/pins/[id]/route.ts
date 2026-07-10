/**
 * DELETE /api/pins/[id]  — remove a dashboard pin
 */

import { NextRequest, NextResponse } from "next/server";
import { removePin } from "@/lib/agents/pinsRegistry";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const removed = removePin(id);
  if (!removed) return NextResponse.json({ error: "Pin not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
