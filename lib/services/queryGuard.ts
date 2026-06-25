export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const BLOCKED_PATTERNS = [
  { pattern: /drop\s+table/i, message: "DROP TABLE is not allowed" },
  { pattern: /truncate\s+table/i, message: "TRUNCATE TABLE is not allowed" },
  { pattern: /delete\s+from/i, message: "DELETE is not allowed (read-only database)" },
  { pattern: /insert\s+into/i, message: "INSERT is not allowed (read-only database)" },
  { pattern: /update\s+\w/i, message: "UPDATE is not allowed (read-only database)" },
  { pattern: /create\s+(table|view|procedure|index)/i, message: "DDL operations are not allowed" },
  { pattern: /exec(\s|\()/i, message: "EXEC is not allowed" },
  { pattern: /xp_cmdshell/i, message: "xp_cmdshell is not allowed" },
  { pattern: /openrowset/i, message: "OPENROWSET is not allowed" },
];

export function validateQuery(sql: string): ValidationResult {
  const errors: string[] = [];
  const lowered = sql.toLowerCase();

  // Structural requirements
  if (!lowered.includes("where")) {
    errors.push("Query must include a WHERE clause");
  }

  if (!lowered.includes("@startdate")) {
    errors.push("Query must include @StartDate parameter for date filtering");
  }

  if (!lowered.includes("@enddate")) {
    errors.push("Query must include @EndDate parameter for date filtering");
  }

  if (lowered.includes("select *")) {
    errors.push("SELECT * is not allowed — specify explicit column names");
  }

  if (lowered.includes("cross join")) {
    errors.push("CROSS JOINs are not allowed — they can produce cartesian products");
  }

  // Security checks
  for (const { pattern, message } of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      errors.push(message);
    }
  }

  // Must reference an allowed table
  const allowedTables = [
    "CLIENT_EPISODES_ALL",
    "BRANCHES",
    "SERVICE_LINES",
    "CARE_TYPES",
    "Billing.LINE_ITEMS",
    "PDGM.PDGM_PERIOD",
  ];
  const referencesAllowedTable = allowedTables.some((t) =>
    sql.toUpperCase().includes(t.toUpperCase())
  );
  if (!referencesAllowedTable) {
    errors.push("Query must reference at least one allowed AcaciaHealth table");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
