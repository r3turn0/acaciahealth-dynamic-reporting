/**
 * seed-schema.mjs
 *
 * Run this ONCE on your local machine (where AS01AHHS is reachable) to
 * populate lib/config/schemaConfig.json with every table and view in the
 * HCHB database. The resulting file is committed to the repo so it works
 * as a static fallback in all other environments.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-schema.mjs
 */

import sql from "mssql";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, "../lib/config/schemaConfig.json");
const TABLES_OUTPUT = path.resolve(__dirname, "../lib/config/allTables.json");

const config = {
  server:   process.env.DB_HOST,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  port:     parseInt(process.env.DB_PORT || "1433", 10),
  options: {
    encrypt:              process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
    readOnlyIntent:       false,
  },
};

if (!config.server || !config.database) {
  console.error("ERROR: DB_HOST and DB_NAME must be set in .env.local");
  process.exit(1);
}

console.log(`Connecting to ${config.server}/${config.database}...`);

const pool = await sql.connect(config);
console.log("Connected.");

// ── 1. Get full table + view list via sys catalog ─────────────────────────────
const tableResult = await pool.request().query(`
  SELECT
    s.name           AS TABLE_SCHEMA,
    o.name           AS TABLE_NAME,
    CASE o.type
      WHEN 'U' THEN 'BASE TABLE'
      WHEN 'V' THEN 'VIEW'
      ELSE 'BASE TABLE'
    END              AS TABLE_TYPE
  FROM sys.objects o
  JOIN sys.schemas s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U', 'V')
    AND o.is_ms_shipped = 0
  ORDER BY o.type DESC, o.name
`);

const tables = tableResult.recordset;
console.log(`Found ${tables.length} tables/views.`);

// ── 2. Write allTables.json — simple flat list for the dropdown ───────────────
const allTablesList = tables.map((t) =>
  t.TABLE_SCHEMA === "dbo" ? t.TABLE_NAME : `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`
);
fs.writeFileSync(TABLES_OUTPUT, JSON.stringify(allTablesList, null, 2));
console.log(`Wrote ${allTablesList.length} entries to lib/config/allTables.json`);

// ── 3. Get columns for every table/view ──────────────────────────────────────
const colResult = await pool.request().query(`
  SELECT
    s.name    AS TABLE_SCHEMA,
    o.name    AS TABLE_NAME,
    c.name    AS COLUMN_NAME,
    tp.name   AS DATA_TYPE
  FROM sys.objects o
  JOIN sys.schemas  s  ON s.schema_id  = o.schema_id
  JOIN sys.columns  c  ON c.object_id  = o.object_id
  JOIN sys.types    tp ON tp.user_type_id = c.user_type_id
  WHERE o.type IN ('U', 'V')
    AND o.is_ms_shipped = 0
  ORDER BY o.name, c.column_id
`);

// ── 4. Build schemaConfig.json ────────────────────────────────────────────────
// Load existing file so we preserve any hand-crafted join/alias entries
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT, "utf8")); } catch {}

const schemaMap = {};
for (const row of colResult.recordset) {
  const key = row.TABLE_SCHEMA === "dbo"
    ? row.TABLE_NAME
    : `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
  if (!schemaMap[key]) {
    schemaMap[key] = {
      alias: row.TABLE_NAME.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 8),
      keys:  [],
      joins: existing[key]?.joins ?? {},
    };
  }
  // Heuristic: any column containing "id" at the end and not nullable = likely PK
  if (/(_id|_ID)$/.test(row.COLUMN_NAME) && schemaMap[key].keys.length === 0) {
    schemaMap[key].keys.push(row.COLUMN_NAME);
  }
}
// Ensure every entry has at least one key placeholder
for (const key of Object.keys(schemaMap)) {
  if (schemaMap[key].keys.length === 0) schemaMap[key].keys.push("id");
}

fs.writeFileSync(OUTPUT, JSON.stringify(schemaMap, null, 2));
console.log(`Wrote ${Object.keys(schemaMap).length} entries to lib/config/schemaConfig.json`);

await pool.close();
console.log("Done. Commit both lib/config/allTables.json and lib/config/schemaConfig.json.");
