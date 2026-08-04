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

/** Security-only validation shared by every analytics execution path. */
export function validateReadOnlySql(sql: string): ValidationResult {
  const errors: string[] = [];
  const executable = executableSql(sql).trim();

  if (!executable) {
    return { valid: false, errors: ["SQL is required"] };
  }

  const withoutTrailingTerminator = executable.replace(/;\s*$/, "");
  if (withoutTrailingTerminator.includes(";")) {
    errors.push("Multiple SQL statements are not allowed");
  }

  if (!/^(?:SELECT|WITH)\b/i.test(withoutTrailingTerminator)) {
    errors.push("Only SELECT queries and read-only CTEs are allowed");
  }

  for (const { pattern, message } of BLOCKED_COMMANDS) {
    if (pattern.test(withoutTrailingTerminator)) errors.push(message);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * Product-level query validation. In addition to the global read-only policy,
 * generated analytics SQL must use governed tables and parameterized dates.
 */
export function validateQuery(sql: string): ValidationResult {
  const errors = [...validateReadOnlySql(sql).errors];
  const upper = executableSql(sql).toUpperCase();

  if (!upper.includes("WHERE")) errors.push("Query must include a WHERE clause");
  if (!sql.includes("@StartDate")) errors.push("Query must reference @StartDate parameter");
  if (!sql.includes("@EndDate")) errors.push("Query must reference @EndDate parameter");

  const referencesAllowedTable = Array.from(ALLOWED_TABLES).some((table) =>
    upper.includes(table)
  );
  if (!referencesAllowedTable) {
    errors.push("Query must reference at least one allowed table (e.g. CLIENT_EPISODES_ALL, BRANCHES)");
  }

  if (/\bSELECT\s+\*/i.test(upper)) errors.push("SELECT * is not allowed — specify explicit column names");
  if (/\bCROSS\s+JOIN\b/i.test(upper)) errors.push("CROSS JOINs are not allowed — they can produce cartesian products");

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
