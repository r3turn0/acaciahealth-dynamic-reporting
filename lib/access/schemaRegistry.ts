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

/**
 * A foreign-key relationship to another registry table.
 * `condition` is a schema-defined (config-controlled) SQL ON clause that
 * references the two tables' aliases. It is NEVER derived from user input.
 */
export interface RegistryRelationship {
  toTable: string;   // fully-qualified id of the related table
  condition: string; // e.g. "epi.epi_sl_id = sl.sl_id"
}

export interface RegistryTable {
  /** Fully-qualified id, e.g. "Billing.LINE_ITEMS" or "patients" */
  id: string;
  schema: string;
  name: string;
  /** Query alias used in join conditions (from schema config), e.g. "epi". */
  alias: string;
  columns: RegistryColumn[];
  /** FK relationships to other tables (child → parent), if any. */
  relationships: RegistryRelationship[];
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
const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function getIntrospectedSchema(): Promise<RegisteredSchema> {
  const intel = await getSchemaIntelligence();
  const cfg = intel.schema_config as Record<
    string,
    { alias?: string; joins?: Record<string, string> } | undefined
  >;

  // Resolve a table's config entry by full key or by short (unqualified) name.
  function findCfg(rawName: string, id: string) {
    for (const key of [id, rawName, rawName.split(".").pop()!]) {
      if (cfg[key]) return cfg[key]!;
    }
    const short = rawName.split(".").pop()!.toLowerCase();
    for (const [k, v] of Object.entries(cfg)) {
      if (k.toLowerCase() === short || k.split(".").pop()!.toLowerCase() === short) return v;
    }
    return undefined;
  }

  // 1. Build base tables. Normalize ids so a schema-qualified table_name
  //    (e.g. "Billing.LINE_ITEMS") does not get its schema doubled.
  const rawJoinsById = new Map<string, Record<string, string>>();
  const tables: RegistryTable[] = intel.tables.map((t) => {
    const rawName = t.table_name;
    const hasSchema = rawName.includes(".");
    const schema = hasSchema ? rawName.split(".")[0] : t.table_schema;
    const name = hasSchema ? rawName.split(".").slice(1).join(".") : rawName;
    const id = `${schema}.${name}`;
    const c = findCfg(rawName, id);
    rawJoinsById.set(id, t.relationships ?? c?.joins ?? {});
    return {
      id,
      schema,
      name,
      alias: c?.alias && ALIAS_RE.test(c.alias) ? c.alias : "",
      columns: t.columns.map((col) => ({ name: col.column_name, type: col.data_type })),
      relationships: [],
    };
  });

  // 2. Resolve relationship target names → registry ids (both key + short name).
  const byName = new Map<string, string>();
  for (const t of tables) {
    byName.set(t.id.toLowerCase(), t.id);
    byName.set(t.name.toLowerCase(), t.id);
  }
  for (const t of tables) {
    const raw = rawJoinsById.get(t.id) ?? {};
    for (const [targetName, condition] of Object.entries(raw)) {
      if (typeof condition !== "string" || !condition.trim()) continue;
      const targetId =
        byName.get(targetName.toLowerCase()) ??
        byName.get(targetName.split(".").pop()!.toLowerCase());
      if (targetId && targetId.toLowerCase() !== t.id.toLowerCase()) {
        t.relationships.push({ toTable: targetId, condition });
      }
    }
  }

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
  tables: Array<
    Omit<RegistryTable, "alias" | "relationships"> &
      Partial<Pick<RegistryTable, "alias" | "relationships">>
  >;
}): RegisteredSchema {
  const entry: RegisteredSchema = {
    id: input.id,
    name: input.name,
    source: "upload",
    tables: input.tables.map((t) => ({
      ...t,
      alias: t.alias ?? "",
      relationships: t.relationships ?? [],
    })),
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

/**
 * Resolve the FK relationship between two tables, searching both directions.
 * The returned `condition` always comes from the schema config, never the
 * caller — this is what keeps generated joins injection-safe. Returns null
 * when the two tables are not related in the registry.
 */
export async function findRelationship(
  aId: string,
  bId: string
): Promise<{ from: RegistryTable; to: RegistryTable; condition: string } | null> {
  const a = await findTable(aId);
  const b = await findTable(bId);
  if (!a || !b) return null;

  const fwd = a.relationships.find((r) => r.toTable.toLowerCase() === b.id.toLowerCase());
  if (fwd) return { from: a, to: b, condition: fwd.condition };

  const rev = b.relationships.find((r) => r.toTable.toLowerCase() === a.id.toLowerCase());
  if (rev) return { from: b, to: a, condition: rev.condition };

  return null;
}
