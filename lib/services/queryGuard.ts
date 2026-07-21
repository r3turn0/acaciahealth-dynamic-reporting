export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const BLOCKED_PATTERNS = [
  { pattern: /drop\s+table/i,                          message: "DROP TABLE is not allowed" },
  { pattern: /truncate\s+table/i,                       message: "TRUNCATE TABLE is not allowed" },
  { pattern: /delete\s+from/i,                          message: "DELETE is not allowed (read-only database)" },
  { pattern: /insert\s+into/i,                          message: "INSERT is not allowed (read-only database)" },
  { pattern: /update\s+\w/i,                            message: "UPDATE is not allowed (read-only database)" },
  { pattern: /create\s+(table|view|procedure|index)/i,  message: "DDL operations are not allowed" },
  { pattern: /exec(\s|\()/i,                            message: "EXEC is not allowed" },
  { pattern: /xp_cmdshell/i,                            message: "xp_cmdshell is not allowed" },
  { pattern: /openrowset/i,                             message: "OPENROWSET is not allowed" },
];

// Tables that are permitted to appear in queries.
// Any query that names no table from this set is rejected.
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

export function validateQuery(sql: string): ValidationResult {
  const errors: string[] = [];
  const upper = sql.toUpperCase();
  const lowered = sql.toLowerCase();

  // ── Structural checks ────────────────────────────────────────────────────────

  // Must contain a WHERE clause
  if (!upper.includes("WHERE")) {
    errors.push("Query must include a WHERE clause");
  }

  // Must use parameterized date range — no hardcoded date literals allowed
  if (!sql.includes("@StartDate")) {
    errors.push("Query must reference @StartDate parameter");
  }
  if (!sql.includes("@EndDate")) {
    errors.push("Query must reference @EndDate parameter");
  }

  // Must reference at least one allowed table
  const referencesAllowedTable = Array.from(ALLOWED_TABLES).some((t) =>
    upper.includes(t)
  );
  if (!referencesAllowedTable) {
    errors.push(
      "Query must reference at least one allowed table (e.g. CLIENT_EPISODES_ALL, BRANCHES)"
    );
  }

  // ── Content checks ───────────────────────────────────────────────────────────

  if (lowered.includes("select *")) {
    errors.push("SELECT * is not allowed — specify explicit column names");
  }

  if (lowered.includes("cross join")) {
    errors.push("CROSS JOINs are not allowed — they can produce cartesian products");
  }

  // Security / DML / DDL blocks
  for (const { pattern, message } of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      errors.push(message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
