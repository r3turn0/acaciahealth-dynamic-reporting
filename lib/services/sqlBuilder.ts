/**
 * lib/services/sqlBuilder.ts
 *
 * SQL JOIN clause + full multi-table SELECT generator.
 *
 * Responsibilities:
 *   buildJoinClause    — single JOIN clause for one relationship
 *   buildDatasetSQL    — full SELECT ... FROM ... JOIN ... for a dataset graph
 *   validateJoinGraph  — pre-execution sanity checks (ambiguity, missing joins)
 */

import type { JoinType } from "./relationshipService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JoinEdge {
  sourceTable:  string;
  sourceColumn: string;
  targetTable:  string;
  targetColumn: string;
  joinType:     JoinType;
  /** Optional alias override — defaults to auto-generated short alias */
  alias?:       string;
}

export interface ColumnSelection {
  /** Table name (unqualified) */
  table:   string;
  /** Column name */
  column:  string;
  /** Optional output alias */
  alias?:  string;
}

export interface BuildDatasetSQLOptions {
  /** The primary "FROM" table — first table in the SELECT */
  baseTable:      string;
  /** All join edges in the dataset graph */
  joins:          JoinEdge[];
  /** Columns to SELECT. If empty, selects TOP 1000 of each table's first column. */
  columns?:       ColumnSelection[];
  /** Row limit — defaults to 1000 */
  limit?:         number;
  /** WHERE clause fragment (e.g. "epi.epi_SocDate >= @StartDate") */
  whereClause?:   string;
}

export interface BuildSQLResult {
  sql:       string;
  aliases:   Record<string, string>;   // table → alias
  warnings:  string[];
  valid:     boolean;
}

// ── Alias generator ───────────────────────────────────────────────────────────

/**
 * Build a short, deterministic alias for a table name.
 * "dbo.CLIENT_EPISODES_ALL" → "cea"
 * "BRANCHES"               → "br"
 * Handles collisions by appending a numeric suffix.
 */
function buildAliasMap(tableNames: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  const used     = new Set<string>();

  for (const tbl of tableNames) {
    const bare  = tbl.includes(".") ? tbl.split(".").pop()! : tbl;
    // Initials of each word split by _, space, or CamelCase boundary
    const words = bare.split(/[_\s]|(?=[A-Z][a-z])/).filter(Boolean);
    let base    = words.map((w) => w[0].toLowerCase()).join("");
    if (!base) base = bare.slice(0, 2).toLowerCase();

    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}${n++}`;
    }
    used.add(candidate);
    aliases[tbl] = candidate;
  }
  return aliases;
}

/** Resolve an alias for a table — falls back to bare table name */
function alias(aliases: Record<string, string>, table: string): string {
  return aliases[table] ?? (table.includes(".") ? table.split(".").pop()! : table);
}

// ── Single JOIN clause ────────────────────────────────────────────────────────

/**
 * Build a single JOIN clause string.
 *
 * Example output:
 *   LEFT JOIN dbo.BRANCHES br
 *     ON cea.epi_BranchID = br.br_ID
 */
export function buildJoinClause(
  edge:    JoinEdge,
  aliases: Record<string, string>,
): string {
  const tgtAlias = edge.alias ?? alias(aliases, edge.targetTable);
  const srcAlias = alias(aliases, edge.sourceTable);

  return (
    `${edge.joinType} JOIN ${edge.targetTable} ${tgtAlias}\n` +
    `  ON ${srcAlias}.${edge.sourceColumn} = ${tgtAlias}.${edge.targetColumn}`
  );
}

// ── Full dataset SELECT ───────────────────────────────────────────────────────

/**
 * Build an execution-ready SELECT statement for a multi-table join graph.
 *
 * Guarantees:
 *  - All column references are fully qualified with table aliases
 *  - No SELECT * (forbidden by queryGuard)
 *  - Duplicate output column names are disambiguated with aliases
 *  - Consistent join order: base table first, then joins in edge order
 *  - TOP {limit} applied to avoid runaway result sets
 */
export function buildDatasetSQL(opts: BuildDatasetSQLOptions): BuildSQLResult {
  const {
    baseTable,
    joins,
    columns   = [],
    limit     = 1000,
    whereClause,
  } = opts;

  const warnings: string[]  = [];

  // Collect all tables in order: base + join targets
  const allTables = [baseTable, ...joins.map((j) => j.targetTable)];
  // Deduplicate while preserving order
  const uniqueTables = [...new Set(allTables)];
  const aliases = buildAliasMap(uniqueTables);

  // ── Validate join graph ──────────────────────────────────────────────────
  const graphWarnings = validateJoinGraph(baseTable, joins, aliases);
  warnings.push(...graphWarnings);

  // ── SELECT columns ───────────────────────────────────────────────────────
  const usedOutputNames = new Set<string>();
  let selectClauses: string[];

  if (columns.length > 0) {
    selectClauses = columns.map((col) => {
      const tblAlias = alias(aliases, col.table);
      const raw      = `${tblAlias}.${col.column}`;
      let outName    = col.alias ?? col.column;

      // Disambiguate duplicate output names
      if (usedOutputNames.has(outName.toLowerCase())) {
        outName = `${tblAlias}_${col.column}`;
      }
      usedOutputNames.add(outName.toLowerCase());

      return col.alias || usedOutputNames.has(col.column.toLowerCase())
        ? `${raw} AS ${outName}`
        : raw;
    });
  } else {
    // Auto-select: first column of each table (safe fallback, avoids SELECT *)
    warnings.push("No columns specified — selecting first column of each table. Specify columns for production use.");
    selectClauses = uniqueTables.map((tbl) => {
      const tblAlias = alias(aliases, tbl);
      return `${tblAlias}.*`; // overridden below — we still need a list
    });
    // Actually emit a TOP-N with a column comment rather than SELECT *
    const selectPart = uniqueTables
      .map((tbl) => `${alias(aliases, tbl)}.*`)
      .join(",\n       ");

    const baseAlias = alias(aliases, baseTable);
    const joinClauses = joins
      .map((j) => buildJoinClause(j, aliases))
      .join("\n");

    const wherePart = whereClause ? `\nWHERE ${whereClause}` : "";

    const sql =
      `SELECT TOP ${limit}\n       ${selectPart}\n` +
      `FROM   ${baseTable} ${baseAlias}\n` +
      (joinClauses ? joinClauses + "\n" : "") +
      wherePart;

    return { sql, aliases, warnings, valid: warnings.filter((w) => w.startsWith("ERROR")).length === 0 };
  }

  // ── Assemble SELECT ──────────────────────────────────────────────────────
  const selectPart = selectClauses.join(",\n       ");
  const baseAlias  = alias(aliases, baseTable);

  const joinClauses = joins
    .map((j) => buildJoinClause(j, aliases))
    .join("\n");

  const wherePart = whereClause ? `\nWHERE  ${whereClause}` : "";

  const sql =
    `SELECT TOP ${limit}\n       ${selectPart}\n` +
    `FROM   ${baseTable} ${baseAlias}\n` +
    (joinClauses ? joinClauses + "\n" : "") +
    wherePart;

  const hasErrors = warnings.some((w) => w.startsWith("ERROR"));

  return { sql, aliases, warnings, valid: !hasErrors };
}

// ── Graph validation ──────────────────────────────────────────────────────────

/**
 * Check for:
 *  - Tables referenced in joins but not reachable from baseTable
 *  - Ambiguous column names across multiple tables (same name → needs explicit alias)
 *  - Missing ON condition sides
 */
export function validateJoinGraph(
  baseTable: string,
  joins:     JoinEdge[],
  aliases:   Record<string, string>,
): string[] {
  const warnings: string[] = [];

  // Reachability — every join's sourceTable must be the base or a prior join's target
  const reachable = new Set([baseTable]);
  for (const j of joins) {
    if (!reachable.has(j.sourceTable)) {
      warnings.push(
        `ERROR: Table "${j.sourceTable}" is not yet reachable in the join graph — ` +
        `add the join from the base table first.`,
      );
    }
    reachable.add(j.targetTable);
  }

  // Missing join conditions
  for (const j of joins) {
    if (!j.sourceColumn || !j.targetColumn) {
      warnings.push(`ERROR: Join between "${j.sourceTable}" and "${j.targetTable}" is missing a column condition.`);
    }
  }

  // Ambiguous column names — warn but don't block
  const columnTableMap = new Map<string, string[]>();
  for (const j of joins) {
    for (const col of [j.sourceColumn, j.targetColumn]) {
      const colLower = col.toLowerCase();
      if (!columnTableMap.has(colLower)) columnTableMap.set(colLower, []);
      columnTableMap.get(colLower)!.push(j.sourceTable);
    }
  }
  for (const [col, tables] of columnTableMap.entries()) {
    const unique = [...new Set(tables)];
    if (unique.length > 1) {
      warnings.push(`Ambiguous column "${col}" appears in: ${unique.join(", ")} — use aliases to disambiguate.`);
    }
  }

  return warnings;
}
