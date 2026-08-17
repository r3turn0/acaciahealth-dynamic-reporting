/**
 * Metadata Registry — Single Source of Truth
 *
 * Merges every table source in the platform into one canonical catalog:
 *   1. allTables.json           (static seed list)
 *   2. schemaConfig.json        (column + join config)
 *   3. DatasetDesigner catalog  (SOURCE_TABLES — static column definitions)
 *   4. /api/schema/tables       (live DB introspection when available)
 *
 * Exposes runValidation() which runs the full 8-check pipeline and returns a
 * MetadataHealthReport consumed by the MetadataValidationPanel and the
 * /api/metadata/validate route.
 *
 * Server-safe: uses no browser APIs.
 */

import schemaConfigRaw from "@/lib/config/schemaConfig.json";
import { buildMetadataIntelligence, type MetadataIntelligenceSummary } from "@/lib/services/metadataIntelligence";
import allTablesRaw    from "@/lib/config/allTables.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetaColumn {
  name:     string;
  type:     string;
  isPk:     boolean;
  isFk:     boolean;
  nullable: boolean;
}

export interface MetaTable {
  id:          string;   // canonical key used everywhere
  schema:      string;
  name:        string;
  columns:     MetaColumn[];
  sources:     CatalogSource[];
  recordCount?: number;
  checksumKey?: string;  // schema_version fingerprint
}

export type CatalogSource =
  | "allTables.json"
  | "schemaConfig.json"
  | "DatasetDesigner"
  | "live_db"
  | "DataExplorer";

// ── Validation result types ───────────────────────────────────────────────────

export type ValidationStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

export interface ValidationCheck {
  id:          string;
  name:        string;
  description: string;
  status:      ValidationStatus;
  detail?:     string;
  affectedItems?: string[];
  fixHint?:    string;
}

export interface MetadataHealthReport {
  runAt:              string;
  durationMs:         number;
  overallStatus:      "HEALTHY" | "DEGRADED" | "UNHEALTHY";

  // Summary counters
  tablesDiscovered:   number;
  tablesRegistered:   number;
  tablesSearchable:   number;
  tablesReportable:   number;
  missingTables:      number;
  orphanTables:       number;
  staleSchemaTables:  number;
  duplicateTables:    number;

  // Per-surface counts
  discoverCount:      number;
  datasetBuilderCount:number;
  syncDelta:          number;   // discoverCount - datasetBuilderCount

  // Per-check results
  checks:             ValidationCheck[];

  // Detail lists
  orphanTableIds:     string[];
  duplicateTableIds:  string[];
  staleTableIds:      string[];
  missingFromBuilder: string[];
  missingFromDiscover:string[];
  intelligence: MetadataIntelligenceSummary;
}

// ── Static catalogs ───────────────────────────────────────────────────────────

const schemaConfig = schemaConfigRaw as Record<string, { alias?: string; joins?: Record<string, string> }>;
const allTables    = allTablesRaw    as string[];

// DatasetDesigner SOURCE_TABLES — mirrored here (server-side) so validation
// can compare them without importing the component.
const DESIGNER_TABLES: MetaTable[] = [
  {
    id: "dbo.CLIENT_EPISODES_ALL", schema: "dbo", name: "CLIENT_EPISODES_ALL",
    recordCount: 284_512,
    sources: ["DatasetDesigner"],
    columns: [
      { name: "epi_id",            type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "epi_branchcode",    type: "varchar", isPk: false, isFk: true,  nullable: false },
      { name: "epi_slid",          type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "epi_caretypeid",    type: "int",     isPk: false, isFk: true,  nullable: true  },
      { name: "epi_SocDate",       type: "date",    isPk: false, isFk: false, nullable: false },
      { name: "epi_DischargeDate", type: "date",    isPk: false, isFk: false, nullable: true  },
      { name: "epi_payor",         type: "varchar", isPk: false, isFk: false, nullable: true  },
      { name: "epi_recertDate",    type: "date",    isPk: false, isFk: false, nullable: true  },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_VISITS_ALL", schema: "dbo", name: "CLIENT_EPISODE_VISITS_ALL",
    recordCount: 2_148_932, sources: ["DatasetDesigner"],
    columns: [
      { name: "visit_id",      type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "epi_id",        type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "worker_id",     type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "visit_date",    type: "date",    isPk: false, isFk: false, nullable: false },
      { name: "visit_points",  type: "decimal", isPk: false, isFk: false, nullable: true  },
      { name: "discipline_id", type: "int",     isPk: false, isFk: true,  nullable: false },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_VISIT_NOTES", schema: "dbo", name: "CLIENT_EPISODE_VISIT_NOTES",
    recordCount: 2_101_445, sources: ["DatasetDesigner"],
    columns: [
      { name: "note_id",   type: "int",      isPk: true,  isFk: false, nullable: false },
      { name: "visit_id",  type: "int",      isPk: false, isFk: true,  nullable: false },
      { name: "epi_id",    type: "int",      isPk: false, isFk: true,  nullable: false },
      { name: "note_type", type: "varchar",  isPk: false, isFk: false, nullable: false },
      { name: "note_date", type: "datetime", isPk: false, isFk: false, nullable: false },
      { name: "note_text", type: "nvarchar", isPk: false, isFk: false, nullable: true  },
    ],
  },
  {
    id: "dbo.CLIENT_EPISODE_RECERT_HISTORY", schema: "dbo", name: "CLIENT_EPISODE_RECERT_HISTORY",
    recordCount: 412_890, sources: ["DatasetDesigner"],
    columns: [
      { name: "recert_id",   type: "int",  isPk: true,  isFk: false, nullable: false },
      { name: "epi_id",      type: "int",  isPk: false, isFk: true,  nullable: false },
      { name: "cert_period", type: "int",  isPk: false, isFk: false, nullable: false },
      { name: "cert_start",  type: "date", isPk: false, isFk: false, nullable: false },
      { name: "cert_end",    type: "date", isPk: false, isFk: false, nullable: false },
    ],
  },
  {
    id: "dbo.BRANCHES", schema: "dbo", name: "BRANCHES",
    recordCount: 16, sources: ["DatasetDesigner"],
    columns: [
      { name: "branch_code",   type: "varchar", isPk: true,  isFk: false, nullable: false },
      { name: "branch_name",   type: "varchar", isPk: false, isFk: false, nullable: false },
      { name: "branch_county", type: "varchar", isPk: false, isFk: false, nullable: true  },
      { name: "branch_state",  type: "varchar", isPk: false, isFk: false, nullable: false },
      { name: "region",        type: "varchar", isPk: false, isFk: false, nullable: true  },
    ],
  },
  {
    id: "dbo.WORKER_BASE", schema: "dbo", name: "WORKER_BASE",
    recordCount: 892, sources: ["DatasetDesigner"],
    columns: [
      { name: "worker_id",   type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "branch_code", type: "varchar", isPk: false, isFk: true,  nullable: false },
      { name: "worker_name", type: "varchar", isPk: false, isFk: false, nullable: false },
      { name: "worker_type", type: "varchar", isPk: false, isFk: false, nullable: false },
      { name: "discipline",  type: "varchar", isPk: false, isFk: false, nullable: true  },
      { name: "hire_date",   type: "date",    isPk: false, isFk: false, nullable: true  },
    ],
  },
  {
    id: "Billing.LINE_ITEMS", schema: "Billing", name: "LINE_ITEMS",
    recordCount: 1_892_441, sources: ["DatasetDesigner"],
    columns: [
      { name: "li_id",           type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "epi_id",          type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "invoice_id",      type: "int",     isPk: false, isFk: true,  nullable: true  },
      { name: "li_amount",       type: "decimal", isPk: false, isFk: false, nullable: false },
      { name: "li_paid",         type: "decimal", isPk: false, isFk: false, nullable: true  },
      { name: "li_claim_status", type: "varchar", isPk: false, isFk: false, nullable: false },
    ],
  },
  {
    id: "Billing.INVOICES", schema: "Billing", name: "INVOICES",
    recordCount: 412_100, sources: ["DatasetDesigner"],
    columns: [
      { name: "invoice_id",     type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "epi_id",         type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "invoice_date",   type: "date",    isPk: false, isFk: false, nullable: false },
      { name: "invoice_total",  type: "decimal", isPk: false, isFk: false, nullable: false },
      { name: "invoice_status", type: "varchar", isPk: false, isFk: false, nullable: false },
    ],
  },
  {
    id: "dbo.PDGM_PERIOD", schema: "dbo", name: "PDGM_PERIOD",
    recordCount: 512_890, sources: ["DatasetDesigner"],
    columns: [
      { name: "period_id",         type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "epi_id",            type: "int",     isPk: false, isFk: true,  nullable: false },
      { name: "hipps_code",        type: "varchar", isPk: false, isFk: false, nullable: true  },
      { name: "lupa_flag",         type: "bit",     isPk: false, isFk: false, nullable: true  },
      { name: "reimbursement_type",type: "varchar", isPk: false, isFk: false, nullable: true  },
    ],
  },
  {
    id: "dbo.SERVICE_LINES", schema: "dbo", name: "SERVICE_LINES",
    recordCount: 6, sources: ["DatasetDesigner"],
    columns: [
      { name: "service_line_id",   type: "int",     isPk: true,  isFk: false, nullable: false },
      { name: "service_line_name", type: "varchar", isPk: false, isFk: false, nullable: false },
      { name: "service_line_code", type: "varchar", isPk: false, isFk: false, nullable: false },
    ],
  },
];

// ── Canonical ID normalisation ────────────────────────────────────────────────

/** Normalise a raw table name to a canonical id of the form "schema.TABLE". */
function canonicalId(raw: string): string {
  if (raw.includes(".")) {
    const parts = raw.split(".");
    return `${parts[0]}.${parts.slice(1).join(".")}`;
  }
  return `dbo.${raw}`;
}

function nameOnly(id: string): string {
  return id.includes(".") ? id.split(".").slice(1).join(".") : id;
}

// ── Build canonical catalog ───────────────────────────────────────────────────

/**
 * Merge all static sources into a single Map<id, MetaTable>.
 * Live DB results can be merged in later (see mergeFromLiveDb).
 */
export function buildStaticCatalog(): Map<string, MetaTable> {
  const catalog = new Map<string, MetaTable>();

  // 1. allTables.json
  for (const raw of allTables) {
    const id = canonicalId(raw);
    const parts = id.split(".");
    const entry: MetaTable = {
      id,
      schema: parts[0],
      name:   parts.slice(1).join("."),
      columns: [],
      sources: ["allTables.json"],
    };
    catalog.set(id.toLowerCase(), entry);
  }

  // 2. schemaConfig.json
  for (const key of Object.keys(schemaConfig)) {
    const id  = canonicalId(key);
    const low = id.toLowerCase();
    if (catalog.has(low)) {
      catalog.get(low)!.sources.push("schemaConfig.json");
    } else {
      const parts = id.split(".");
      catalog.set(low, {
        id,
        schema: parts[0],
        name:   parts.slice(1).join("."),
        columns: [],
        sources: ["schemaConfig.json"],
      });
    }
  }

  // 3. DatasetDesigner SOURCE_TABLES
  for (const t of DESIGNER_TABLES) {
    const low = t.id.toLowerCase();
    if (catalog.has(low)) {
      const existing = catalog.get(low)!;
      existing.sources.push("DatasetDesigner");
      if (t.columns.length > 0 && existing.columns.length === 0) {
        existing.columns = t.columns;
      }
      existing.recordCount = t.recordCount;
    } else {
      catalog.set(low, { ...t });
    }
  }

  return catalog;
}

/**
 * Merge live DB table list into the catalog.
 * @param dbTables  Array from /api/schema/tables response.
 */
export function mergeFromLiveDb(
  catalog: Map<string, MetaTable>,
  dbTables: { table_schema: string; table_name: string }[]
): void {
  for (const row of dbTables) {
    const id  = `${row.table_schema}.${row.table_name}`;
    const low = id.toLowerCase();
    if (catalog.has(low)) {
      catalog.get(low)!.sources.push("live_db");
    } else {
      catalog.set(low, {
        id,
        schema: row.table_schema,
        name:   row.table_name,
        columns: [],
        sources: ["live_db"],
      });
    }
  }
}

// ── Validation Pipeline ───────────────────────────────────────────────────────

interface ValidationInput {
  catalog:         Map<string, MetaTable>;
  /** Tables visible in DataExplorer (allTables.json + schemaConfig merged list). */
  discoverIds:     Set<string>;
  /** Tables visible in DatasetDesigner (SOURCE_TABLES). */
  designerIds:     Set<string>;
  /** Tables visible in live DB (from /api/schema/tables). */
  liveDbIds:       Set<string>;
}

function check(
  id: string,
  name: string,
  description: string,
  pass: boolean,
  detail?: string,
  affectedItems?: string[],
  fixHint?: string,
  warnInstead?: boolean,
): ValidationCheck {
  return {
    id,
    name,
    description,
    status: pass ? "PASS" : (warnInstead ? "WARN" : "FAIL"),
    detail,
    affectedItems,
    fixHint,
  };
}

export function runValidationChecks(input: ValidationInput): ValidationCheck[] {
  const { catalog, discoverIds, designerIds, liveDbIds } = input;
  const allIds     = new Set(catalog.keys());
  const checks: ValidationCheck[] = [];

  // ── Check 1: Table Catalog Consistency ───────────────────────────────────────
  const missingFromBuilder  = [...discoverIds].filter((id) => !designerIds.has(id));
  const missingFromDiscover = [...designerIds].filter((id) => !discoverIds.has(id));
  const syncPass = missingFromBuilder.length === 0 && missingFromDiscover.length === 0;
  checks.push(check(
    "catalog_consistency",
    "Table Catalog Consistency",
    "Discover Data Explorer and Dataset Builder must show the same table list.",
    syncPass,
    syncPass
      ? `Both surfaces expose ${discoverIds.size} tables.`
      : `Discover: ${discoverIds.size} tables. Dataset Builder: ${designerIds.size} tables. Delta: ${Math.abs(discoverIds.size - designerIds.size)}.`,
    syncPass ? [] : missingFromBuilder.map(nameOnly).slice(0, 20),
    syncPass ? undefined : "Rebuild the DatasetDesigner SOURCE_TABLES from the live schema registry.",
  ));

  // ── Check 2: Column Metadata Consistency ─────────────────────────────────────
  const tablesWithNoColumns = [...catalog.values()].filter(
    (t) => t.sources.includes("DatasetDesigner") && t.columns.length === 0
  );
  checks.push(check(
    "column_consistency",
    "Column Metadata Consistency",
    "Every DatasetDesigner table must have column definitions.",
    tablesWithNoColumns.length === 0,
    tablesWithNoColumns.length === 0
      ? "All Designer tables have column definitions."
      : `${tablesWithNoColumns.length} table(s) are missing column definitions.`,
    tablesWithNoColumns.map((t) => t.id).slice(0, 10),
    "Run schema introspection to populate missing column metadata.",
  ));

  // ── Check 3: Schema Refresh Validation ───────────────────────────────────────
  const liveOnlyIds = [...liveDbIds].filter((id) => !allIds.has(id));
  checks.push(check(
    "schema_refresh",
    "Schema Refresh Validation",
    "Newly discovered DB tables must appear in all downstream catalogs.",
    liveOnlyIds.length === 0,
    liveOnlyIds.length === 0
      ? "No unregistered live tables detected."
      : `${liveOnlyIds.length} live table(s) not yet registered in the metadata catalog.`,
    liveOnlyIds.map(nameOnly).slice(0, 10),
    "Trigger a manual metadata refresh or wait for the next scheduled sync.",
    liveOnlyIds.length < 5, // warn not fail if small delta
  ));

  // ── Check 4: Relationship Metadata Validation ─────────────────────────────────
  // Check that FK columns on Designer tables resolve to known tables.
  const brokenFks: string[] = [];
  for (const t of catalog.values()) {
    for (const col of t.columns) {
      if (col.isFk) {
        // Heuristic: FK column name contains target table short-name or ends with _id/_code
        // We just verify the parent table itself is in the catalog.
        const parentHint = col.name.replace(/_id$|_code$/i, "");
        const parentMatches = [...allIds].some((id) =>
          id.includes(parentHint.toLowerCase()) && id !== t.id.toLowerCase()
        );
        if (!parentMatches && col.name !== "epi_id" && col.name !== "visit_id") {
          brokenFks.push(`${t.name}.${col.name}`);
        }
      }
    }
  }
  checks.push(check(
    "relationship_metadata",
    "Relationship Metadata Validation",
    "All FK columns must reference a table present in the metadata catalog.",
    brokenFks.length === 0,
    brokenFks.length === 0
      ? "All FK references resolve to known tables."
      : `${brokenFks.length} unresolved FK column reference(s).`,
    brokenFks.slice(0, 10),
    "Verify relationship definitions in the Dataset Designer Relationships tab.",
    brokenFks.length < 3,
  ));

  // ── Check 5: Dataset Registration Validation ──────────────────────────────────
  // Every Designer-sourced table should be discoverable (present in discoverIds).
  const designerNotInDiscover = [...designerIds].filter((id) => !discoverIds.has(id));
  checks.push(check(
    "dataset_registration",
    "Dataset Registration",
    "All DatasetDesigner tables must also appear in the Discover Data Explorer.",
    designerNotInDiscover.length === 0,
    designerNotInDiscover.length === 0
      ? "All Dataset Builder tables are registered and discoverable."
      : `${designerNotInDiscover.length} table(s) in Dataset Builder not visible in Discover Data.`,
    designerNotInDiscover.map(nameOnly).slice(0, 10),
    "Register missing tables in allTables.json or the schema registry.",
  ));

  // ── Check 6: Orphan Table Detection ──────────────────────────────────────────
  const orphans = [...allIds].filter((id) => {
    const t = catalog.get(id)!;
    // Orphan: only in one source and not in the primary discovery + designer surfaces
    return t.sources.length === 1 && !discoverIds.has(id) && !designerIds.has(id);
  });
  checks.push(check(
    "orphan_detection",
    "Orphan Table Detection",
    "Tables that exist in one source but are unreachable from any platform surface.",
    orphans.length === 0,
    orphans.length === 0
      ? "No orphan tables detected."
      : `${orphans.length} orphan table(s) detected — visible in one catalog but not others.`,
    orphans.map(nameOnly).slice(0, 15),
    "Add orphan tables to allTables.json and DatasetDesigner SOURCE_TABLES.",
    orphans.length < 5,
  ));

  // ── Check 7: Duplicate Registration Detection ─────────────────────────────────
  // Look for tables whose names (without schema prefix) appear more than once.
  const nameCount = new Map<string, string[]>();
  for (const id of allIds) {
    const n = nameOnly(id).toLowerCase();
    if (!nameCount.has(n)) nameCount.set(n, []);
    nameCount.get(n)!.push(id);
  }
  const duplicates = [...nameCount.entries()]
    .filter(([, ids]) => ids.length > 1)
    .flatMap(([, ids]) => ids);
  checks.push(check(
    "duplicate_detection",
    "Duplicate Registration Detection",
    "Each table name must be unique across schemas — duplicates cause incorrect joins.",
    duplicates.length === 0,
    duplicates.length === 0
      ? "No duplicate table registrations detected."
      : `${duplicates.length / 2} duplicate group(s) detected.`,
    duplicates.map(nameOnly).slice(0, 10),
    "Resolve schema conflicts by using fully-qualified names or removing stale entries.",
    duplicates.length < 4,
  ));

  // ── Check 8: Stale Metadata Detection ────────────────────────────────────────
  // A table is stale if it appears in the static catalog but NOT in the live DB
  // (only meaningful when we have live DB data).
  const stale = liveDbIds.size > 0
    ? [...designerIds].filter((id) => !liveDbIds.has(id) && catalog.get(id)?.sources.includes("live_db") === false)
    : [];
  checks.push(check(
    "stale_metadata",
    "Stale Metadata Detection",
    "Tables registered in the metadata catalog but no longer present in the live database.",
    stale.length === 0,
    liveDbIds.size === 0
      ? "Skipped — no live DB connection available."
      : stale.length === 0
        ? "No stale metadata detected."
        : `${stale.length} table(s) in the metadata catalog are not present in the live DB.`,
    stale.map(nameOnly).slice(0, 10),
    "Run a schema refresh to remove or archive stale table definitions.",
    true, // stale is always WARN, not FAIL — could be intentional
  ));

  return checks;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RunValidationOptions {
  /** Live DB table rows from /api/schema/tables (optional). */
  liveDbTables?: { table_schema: string; table_name: string }[];
}

export function runValidation(opts: RunValidationOptions = {}): MetadataHealthReport {
  const t0 = Date.now();

  const catalog    = buildStaticCatalog();
  const liveDbIds  = new Set<string>();

  if (opts.liveDbTables && opts.liveDbTables.length > 0) {
    mergeFromLiveDb(catalog, opts.liveDbTables);
    for (const row of opts.liveDbTables) {
      liveDbIds.add(`${row.table_schema}.${row.table_name}`.toLowerCase());
    }
  }

  // Discover = allTables.json + schemaConfig keys
  const discoverIds = new Set<string>(
    [
      ...allTables.map(canonicalId),
      ...Object.keys(schemaConfig).map(canonicalId),
    ].map((id) => id.toLowerCase())
  );

  // Designer = DESIGNER_TABLES ids
  const designerIds = new Set<string>(
    DESIGNER_TABLES.map((t) => t.id.toLowerCase())
  );

  const checks = runValidationChecks({ catalog, discoverIds, designerIds, liveDbIds });

  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const overallStatus =
    failCount > 0 ? "UNHEALTHY" :
    warnCount > 0 ? "DEGRADED"  :
    "HEALTHY";

  const missingFromBuilder  = [...discoverIds].filter((id) => !designerIds.has(id));
  const missingFromDiscover = [...designerIds].filter((id) => !discoverIds.has(id));

  const orphans  = [...catalog.keys()].filter((id) => {
    const t = catalog.get(id)!;
    return t.sources.length === 1 && !discoverIds.has(id) && !designerIds.has(id);
  });
  const nameCount = new Map<string, string[]>();
  for (const id of catalog.keys()) {
    const n = nameOnly(id).toLowerCase();
    if (!nameCount.has(n)) nameCount.set(n, []);
    nameCount.get(n)!.push(id);
  }
  const duplicates = [...nameCount.entries()]
    .filter(([, ids]) => ids.length > 1)
    .flatMap(([, ids]) => ids);
  const stale = liveDbIds.size > 0
    ? [...designerIds].filter((id) => !liveDbIds.has(id) && catalog.get(id)?.sources.includes("live_db") === false)
    : [];

  return {
    runAt:               new Date().toISOString(),
    durationMs:          Date.now() - t0,
    overallStatus,
    tablesDiscovered:    catalog.size,
    tablesRegistered:    discoverIds.size,
    tablesSearchable:    discoverIds.size,  // same source drives search
    tablesReportable:    designerIds.size,
    missingTables:       missingFromBuilder.length,
    orphanTables:        orphans.length,
    staleSchemaTables:   stale.length,
    duplicateTables:     duplicates.length / 2,
    discoverCount:       discoverIds.size,
    datasetBuilderCount: designerIds.size,
    syncDelta:           discoverIds.size - designerIds.size,
    checks,
    orphanTableIds:      orphans.map(nameOnly),
    duplicateTableIds:   duplicates.map(nameOnly),
    staleTableIds:       stale.map(nameOnly),
    missingFromBuilder:  missingFromBuilder.map(nameOnly),
    missingFromDiscover: missingFromDiscover.map(nameOnly),
    intelligence: buildMetadataIntelligence(catalog, checks, liveDbIds.size > 0),
  };
}
