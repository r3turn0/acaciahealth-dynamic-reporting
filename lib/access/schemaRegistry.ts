// ─────────────────────────────────────────────────────────────────────────────
// Schema Registry — Access-Proxy Layer (Phase 1)
//
//   Read-Only DB → Introspection Service → [Schema Registry] → Selection → Proxy
//
// Stores the set of tables + columns that MAY be exposed. Two sources:
//   • "introspection" — derived from live INFORMATION_SCHEMA via schemaAgent
//   • "upload"        — schemas registered by the app (parsed uploads)
//
// This is the source of truth that Data Contracts are validated against: a
// contract can only allow tables/columns that exist in the registry.
// ─────────────────────────────────────────────────────────────────────────────

import { getSchemaIntelligence } from "@/lib/agents/schemaAgent";

export type SchemaSource = "upload" | "introspection";

export interface RegistryColumn {
  name: string;
  type: string;
}

export interface RegistryTable {
  /** Fully-qualified id, e.g. "Billing.LINE_ITEMS" or "patients" */
  id: string;
  schema: string;
  name: string;
  columns: RegistryColumn[];
}

export interface RegisteredSchema {
  id: string;
  name: string;
  source: SchemaSource;
  tables: RegistryTable[];
  registeredAt: string;
}

// ── Singleton store (survives Next.js hot-reload) ───────────────────────────────

const globalForRegistry = globalThis as unknown as {
  __schema_registry?: Map<string, RegisteredSchema>;
};

function store(): Map<string, RegisteredSchema> {
  if (!globalForRegistry.__schema_registry) {
    globalForRegistry.__schema_registry = new Map();
  }
  return globalForRegistry.__schema_registry;
}

// ── Introspection-backed schema (default) ───────────────────────────────────────

const INTROSPECTION_ID = "introspection:live";

/**
 * Build (and cache) the registry entry from live/static introspection.
 * Always refreshed on read so newly-connected DBs surface without a restart.
 */
export async function getIntrospectedSchema(): Promise<RegisteredSchema> {
  const intel = await getSchemaIntelligence();

  const tables: RegistryTable[] = intel.tables.map((t) => ({
    id: `${t.table_schema}.${t.table_name}`,
    schema: t.table_schema,
    name: t.table_name,
    columns: t.columns.map((c) => ({
      name: c.column_name,
      type: c.data_type,
    })),
  }));

  const entry: RegisteredSchema = {
    id: INTROSPECTION_ID,
    name: `Live introspection (${intel.source})`,
    source: "introspection",
    tables,
    registeredAt: intel.generated_at,
  };

  store().set(INTROSPECTION_ID, entry);
  return entry;
}

// ── Upload registration ─────────────────────────────────────────────────────────

export function registerSchema(input: {
  id: string;
  name: string;
  tables: RegistryTable[];
}): RegisteredSchema {
  const entry: RegisteredSchema = {
    id: input.id,
    name: input.name,
    source: "upload",
    tables: input.tables,
    registeredAt: new Date().toISOString(),
  };
  store().set(entry.id, entry);
  return entry;
}

// ── Lookups ──────────────────────────────────────────────────────────────────────

/** All registered schemas, always including fresh live introspection. */
export async function listSchemas(): Promise<RegisteredSchema[]> {
  await getIntrospectedSchema();
  return Array.from(store().values());
}

/**
 * Flattened lookup of every known table across all registered schemas.
 * Later registrations win on id collisions (keeps uploads authoritative).
 */
export async function getAllTables(): Promise<Map<string, RegistryTable>> {
  const schemas = await listSchemas();
  const map = new Map<string, RegistryTable>();
  for (const s of schemas) {
    for (const t of s.tables) map.set(t.id, t);
  }
  return map;
}

/** Find a single table by its fully-qualified id (case-insensitive). */
export async function findTable(tableId: string): Promise<RegistryTable | null> {
  const all = await getAllTables();
  if (all.has(tableId)) return all.get(tableId)!;
  const lower = tableId.toLowerCase();
  for (const [id, t] of all) {
    if (id.toLowerCase() === lower || t.name.toLowerCase() === lower) return t;
  }
  return null;
}
