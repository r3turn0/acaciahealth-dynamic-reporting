/**
 * Schema Intelligence Agent
 * Reads DB metadata from INFORMATION_SCHEMA (live) or falls back to static config.
 * Caches schema for 60 minutes.
 */

import { getCache, setCache } from "../services/cache";
import schemaConfig from "../config/schemaConfig.json";
import semanticLayer from "../config/semanticLayer.json";

const SCHEMA_CACHE_KEY = "schema_intelligence_v1";
const SCHEMA_TTL_MS = 60 * 60 * 1000; // 60 min

export interface ColumnMeta {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
}

export interface TableMeta {
  table_name: string;
  table_schema: string;
  columns: ColumnMeta[];
  relationships: Record<string, string>;
  row_estimate?: number;
}

export interface SchemaIntelligence {
  tables: TableMeta[];
  semantic_layer: typeof semanticLayer;
  schema_config: typeof schemaConfig;
  generated_at: string;
  source: "live_db" | "static_config";
}

// ── Live introspection ────────────────────────────────────────────────────────

async function introspectFromDb(): Promise<SchemaIntelligence | null> {
  try {
    // Dynamic import so mssql is not loaded client-side
    const { executeRawQuery } = await import("../services/db");

    const columnsSQL = `
      SELECT
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
       AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
        AND t.TABLE_SCHEMA IN ('dbo', 'Billing', 'PDGM')
      ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
    `;

    const rows = await executeRawQuery(columnsSQL);

    // Group by table
    const tableMap = new Map<string, TableMeta>();
    for (const row of rows as Record<string, unknown>[]) {
      const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}` as string;
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          table_name: row.TABLE_NAME as string,
          table_schema: row.TABLE_SCHEMA as string,
          columns: [],
          relationships:
            schemaConfig[row.TABLE_NAME as keyof typeof schemaConfig]?.joins ?? {},
        });
      }
      tableMap.get(key)!.columns.push({
        column_name: row.COLUMN_NAME as string,
        data_type: row.DATA_TYPE as string,
        is_nullable: row.IS_NULLABLE as string,
        character_maximum_length: row.CHARACTER_MAXIMUM_LENGTH as number | null,
      });
    }

    return {
      tables: Array.from(tableMap.values()),
      semantic_layer: semanticLayer,
      schema_config: schemaConfig,
      generated_at: new Date().toISOString(),
      source: "live_db",
    };
  } catch {
    return null;
  }
}

// ── Static fallback ───────────────────────────────────────────────────────────

function buildStaticSchema(): SchemaIntelligence {
  const staticTables: TableMeta[] = Object.entries(schemaConfig).map(
    ([tableName, config]) => ({
      table_name: tableName,
      table_schema: tableName.includes(".") ? tableName.split(".")[0] : "dbo",
      columns: [
        {
          column_name: config.keys[0],
          data_type: "int",
          is_nullable: "NO",
          character_maximum_length: null,
        },
      ],
      relationships: config.joins,
    })
  );

  return {
    tables: staticTables,
    semantic_layer: semanticLayer,
    schema_config: schemaConfig,
    generated_at: new Date().toISOString(),
    source: "static_config",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getSchemaIntelligence(): Promise<SchemaIntelligence> {
  const cached = getCache<SchemaIntelligence>(SCHEMA_CACHE_KEY);
  if (cached) return cached;

  let schema: SchemaIntelligence;

  if (process.env.SQL_CONNECTION_STRING) {
    const live = await introspectFromDb();
    schema = live ?? buildStaticSchema();
  } else {
    schema = buildStaticSchema();
  }

  setCache(SCHEMA_CACHE_KEY, schema, SCHEMA_TTL_MS);
  return schema;
}
