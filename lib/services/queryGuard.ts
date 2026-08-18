import { stripLeadingDeclareBlock } from "./sqlCompatibility";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const BLOCKED_COMMANDS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bINSERT\b/i, message: "INSERT is not allowed (read-only database)" },
  { pattern: /\bUPDATE\b/i, message: "UPDATE is not allowed (read-only database)" },
  { pattern: /\bDELETE\b/i, message: "DELETE is not allowed (read-only database)" },
  { pattern: /\bMERGE\b/i, message: "MERGE is not allowed (read-only database)" },
  { pattern: /\b(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i, message: "DDL operations such as CREATE, ALTER, DROP TABLE, TRUNCATE, and RENAME are not allowed" },
  { pattern: /\b(?:GRANT|REVOKE|DENY)\b/i, message: "Permission changes are not allowed" },
  { pattern: /\bUSE\b/i, message: "Database context changes are not allowed" },
  { pattern: /\bEXEC(?:UTE)?\b/i, message: "Stored procedure execution is not allowed" },
  { pattern: /\b(?:XP_CMDSHELL|OPENROWSET|OPENDATASOURCE|OPENQUERY)\b/i, message: "External or privileged data access is not allowed" },
  { pattern: /\bSELECT\b[\s\S]*?\bINTO\b/i, message: "SELECT INTO is not allowed" },
];

const ALLOWED_TABLES = new Set([
  "CLIENT_EPISODES_ALL",
  "CLIENT_EPISODE_VISITS_ALL",
  "CLIENT_EPISODE_VISIT_NOTES",
  "CLIENT_EPISODE_RECERT_HISTORY",
  "CLIENT_EPISODE_ADMISSION_TYPES",
  "BRANCHES",
  "WORKER_BASE",
  "BILLING.LINE_ITEMS",
  "BILLING.INVOICES",
  "PDGM_PERIOD",
  "CARE_TYPES",
  "SERVICE_LINES",
  "PAYOR_GROUPS",
  "V_AL_HOSPICEDAILYCENSUSINFO",
]);

/**
 * Removes comments and quoted values before command scanning. Keywords inside
 * prose, comments, aliases, or string literals therefore cannot cause false
 * positives and cannot be used to smuggle a second command past the guard.
 */
function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, "''")
    .replace(/\[(?:[^\]]|\]\])*\]/g, "[]")
    .replace(/"(?:""|[^"])*"/g, '""');
}

const SQL_IDENTIFIER_PART = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:""|[^"])*"|[A-Za-z_][\w$#@]*)`;
const SQL_TABLE_REFERENCE = new RegExp(
  String.raw`\b(?:FROM|JOIN)\s+(${SQL_IDENTIFIER_PART}(?:\s*\.\s*${SQL_IDENTIFIER_PART}){0,2})`,
  "gi",
);

function normalizeIdentifierPart(part: string): string {
  const trimmed = part.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).replaceAll("]]", "]");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed;
}

/** Extracts physical FROM/JOIN identifiers while ignoring comments and string literals. */
function governedTableReferences(sql: string): string[] {
  const referenceSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, "''");

  return [...referenceSql.matchAll(SQL_TABLE_REFERENCE)].map((match) =>
    match[1]
      .split(".")
      .map(normalizeIdentifierPart)
      .join(".")
      .toUpperCase(),
  );
}

function isAllowedTableReference(reference: string): boolean {
  const parts = reference.split(".");
  const tableName = parts.at(-1) ?? reference;
  return ALLOWED_TABLES.has(reference) || ALLOWED_TABLES.has(tableName);
}

/** Security-only validation shared by every analytics execution path. */
export function validateReadOnlySql(sql: string): ValidationResult {
  const errors: string[] = [];
  const executable = executableSql(sql).trim();

  if (!executable) {
    return { valid: false, errors: ["SQL is required"] };
  }

  // Comments and literals are removed above, so semicolons now represent
  // statement boundaries. Every statement is independently constrained to a
  // SELECT or read-only CTE; this safely supports governed multi-result reports.
  const statements = stripLeadingDeclareBlock(executable)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    if (!/^(?:SELECT|WITH)\b/i.test(statement)) {
      errors.push("Every statement must be a SELECT query or read-only CTE");
    }

    for (const { pattern, message } of BLOCKED_COMMANDS) {
      if (pattern.test(statement)) errors.push(message);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * Product-level query validation. In addition to the global read-only policy,
 * generated analytics SQL must use governed tables and parameterized dates.
 */
export function validateQuery(sql: string): ValidationResult {
  const errors = [...validateReadOnlySql(sql).errors];
  const upper = stripLeadingDeclareBlock(executableSql(sql)).toUpperCase();

  if (!upper.includes("WHERE")) errors.push("Query must include a WHERE clause");
  if (!sql.includes("@StartDate")) errors.push("Query must reference @StartDate parameter");
  if (!sql.includes("@EndDate")) errors.push("Query must reference @EndDate parameter");

  const referencesAllowedTable = governedTableReferences(sql).some(isAllowedTableReference);
  if (!referencesAllowedTable) {
    errors.push("Query must reference at least one allowed table (e.g. CLIENT_EPISODES_ALL, BRANCHES)");
  }

  if (/\bSELECT\s+(?:DISTINCT\s+)?(?:TOP\s*(?:\(\s*\d+\s*\)|\d+)\s*(?:PERCENT\s+)?(?:WITH\s+TIES\s+)?)*\*/i.test(upper)) {
    errors.push("SELECT * is not allowed — specify explicit column names");
  }
  if (/\bCROSS\s+JOIN\b/i.test(upper)) errors.push("CROSS JOINs are not allowed — they can produce cartesian products");

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
