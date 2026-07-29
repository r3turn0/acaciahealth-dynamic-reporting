import { NextRequest, NextResponse } from "next/server";
import { intelligenceStore } from "@/lib/intelligence/store";

export async function GET(request: NextRequest) {
  const entityType = request.nextUrl.searchParams.get("entityType");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 100), 500);
  let activity = intelligenceStore.snapshot().activity;
  if (entityType) activity = activity.filter((event) => event.entityType === entityType);
  return NextResponse.json({ activity: activity.slice(0, limit), total: activity.length });
}
