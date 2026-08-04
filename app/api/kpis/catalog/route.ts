import { NextResponse } from "next/server";
import { intelligenceStore } from "@/lib/intelligence/store";

export async function GET() {
  const kpis = intelligenceStore.snapshot().kpis;
  return NextResponse.json({ kpis, total: kpis.length });
}
