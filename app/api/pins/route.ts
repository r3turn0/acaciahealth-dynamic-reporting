export const runtime = "nodejs";

/**
 * GET  /api/pins  — list all dashboard pins
 * POST /api/pins  — pin an item (report or KPI) to the dashboard
 */

import { NextRequest, NextResponse } from "next/server";
import { listPins, addPin, type PinType } from "@/lib/agents/pinsRegistry";

export async function GET() {
  try {
    const pins = listPins();
    return NextResponse.json({ pins, count: pins.length });
  } catch (err) {
    console.error("[v0] GET /api/pins error:", err);
    return NextResponse.json({ error: "Failed to list pins" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, refId, title, subtitle, kpi, meta, pinned_by } = body;

    if ((type !== "report" && type !== "kpi") || !refId || !title) {
      return NextResponse.json(
        { error: "type ('report'|'kpi'), refId, and title are required" },
        { status: 400 }
      );
    }

    const pin = addPin({
      type: type as PinType,
      refId: String(refId),
      title: String(title),
      subtitle: subtitle ?? "",
      kpi: kpi ?? "custom",
      meta: meta && typeof meta === "object" ? meta : {},
      pinned_by: pinned_by ?? "analyst",
    });

    return NextResponse.json(pin, { status: 201 });
  } catch (err) {
    console.error("[v0] POST /api/pins error:", err);
    return NextResponse.json({ error: "Failed to pin item" }, { status: 500 });
  }
}
