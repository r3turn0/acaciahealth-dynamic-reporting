/**
 * GET  /api/learned-mappings  — Returns all learned term→table mappings
 * POST /api/learned-mappings  — Manually add or update a mapping
 * DELETE /api/learned-mappings?term=...  — Delete a mapping by user_term
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getLearnedMappings,
  upsertLearnedMapping,
  deleteLearnedMapping,
} from "@/lib/services/queryHistoryStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const mappings = await getLearnedMappings();
    return NextResponse.json({ mappings, total: mappings.length });
  } catch (err) {
    console.error("[learned-mappings GET]", err);
    return NextResponse.json({ error: "Failed to fetch learned mappings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      user_term: string;
      actual_object: string;
      confidence?: number;
    };

    if (!body.user_term || !body.actual_object) {
      return NextResponse.json({ error: "user_term and actual_object are required" }, { status: 400 });
    }

    await upsertLearnedMapping(body.user_term, body.actual_object, body.confidence ?? 1.0, "success");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[learned-mappings POST]", err);
    return NextResponse.json({ error: "Failed to upsert mapping" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const term = searchParams.get("term");
    if (!term) {
      return NextResponse.json({ error: "term param required" }, { status: 400 });
    }
    await deleteLearnedMapping(term);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[learned-mappings DELETE]", err);
    return NextResponse.json({ error: "Failed to delete mapping" }, { status: 500 });
  }
}
