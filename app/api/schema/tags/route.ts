// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/schema/tags        — return auto-tags for all tables
// POST /api/schema/tags        — apply user override (add/remove a tag)
// POST /api/schema/tags/retag  — recompute all tags from scratch
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getSchemaIntelligence } from "@/lib/agents/schemaAgent";
import { parseMetadata } from "@/lib/schema/parser";
import { transformToSchemaModel } from "@/lib/schema/transformer";
import {
  tagAllTables,
  addUserTag,
  removeUserTag,
  TAG_CATEGORIES,
  type TagStore,
} from "@/lib/agents/tableTagger";

// ── In-process tag store (survives within a single serverless instance) ────────
// For a multi-instance deployment, replace this with a database-backed store.

let _tagStore: TagStore | null = null;
let _taggedAt: string | null = null;

async function getTagStore(): Promise<TagStore> {
  if (_tagStore) return _tagStore;

  // Build a SchemaModel from the schema intelligence agent (live DB or static)
  const intelligence = await getSchemaIntelligence();

  // Convert SchemaIntelligence tables into the RawMetadata format the parser expects
  const rawMeta = {
    tables: intelligence.tables.map((t) => ({
      schema: t.table_schema,
      table: t.table_name,
      columns: t.columns.map((c) => ({
        name: c.column_name,
        data_type: c.data_type,
        nullable: c.is_nullable === "YES",
        is_identity: false,
        is_computed: false,
        default: null,
        description: null,
      })),
      primary_keys: [] as string[],
      foreign_keys: [] as [],
      descriptions: { table_description: null, triggers: [], check_constraints: [], indexes: [] },
    })),
  };

  const tables = parseMetadata(rawMeta);
  const model = transformToSchemaModel(tables);
  _tagStore = tagAllTables(Object.values(model.tables));
  _taggedAt = new Date().toISOString();
  return _tagStore;
}

// ── GET — return all tags + categories ────────────────────────────────────────

export async function GET() {
  try {
    const store = await getTagStore();
    return NextResponse.json({
      store,
      categories: TAG_CATEGORIES,
      taggedAt: _taggedAt,
      tableCount: Object.keys(store).length,
    });
  } catch (err) {
    console.error("[tags] GET error:", err);
    return NextResponse.json({ error: "Failed to load tag store" }, { status: 500 });
  }
}

// ── POST — user override or full retag ────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: "add" | "remove" | "retag";
      tableId?: string;
      tag?: string;
    };

    if (body.action === "retag") {
      // Force rebuild from scratch
      _tagStore = null;
      const store = await getTagStore();
      return NextResponse.json({
        store,
        categories: TAG_CATEGORIES,
        taggedAt: _taggedAt,
        tableCount: Object.keys(store).length,
        retagged: true,
      });
    }

    if (!body.tableId || !body.tag) {
      return NextResponse.json({ error: "tableId and tag are required" }, { status: 400 });
    }

    let store = await getTagStore();

    if (body.action === "add") {
      store = addUserTag(store, body.tableId, body.tag);
    } else if (body.action === "remove") {
      store = removeUserTag(store, body.tableId, body.tag);
    } else {
      return NextResponse.json({ error: "action must be 'add', 'remove', or 'retag'" }, { status: 400 });
    }

    _tagStore = store;
    return NextResponse.json({ ok: true, entry: store[body.tableId] });
  } catch (err) {
    console.error("[tags] POST error:", err);
    return NextResponse.json({ error: "Tag update failed" }, { status: 500 });
  }
}
