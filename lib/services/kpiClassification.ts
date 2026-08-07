export interface SqlStatementAnalysis {
  index: number;
  sql: string;
  tables: string[];
  columns: string[];
  joins: string[];
  filters: string[];
  groupings: string[];
  aggregates: string[];
}

export interface KpiRule {
  id: string;
  label: string;
  family: string;
  aliases: string[];
  sourceHints: string[];
  expressionHints: string[];
}

export interface KpiClassification {
  ruleId: string;
  label: string;
  family: string;
  confidence: number;
  matchedSignals: string[];
  validationStatus: "supported" | "partial" | "metadata-only";
}

export interface ReadOnlyVerificationPlan {
  statement: number;
  supported: boolean;
  aggregateExpressions: string[];
  sourceTables: string[];
  reason: string;
}

export interface ValidationComparison {
  status: "validated" | "partial" | "unverified";
  confidence: number;
  variance: number | null;
  reason: string;
}

export interface SqlGovernanceAnalysis {
  statements: SqlStatementAnalysis[];
  classifications: KpiClassification[];
  lineage: Array<{ statement: number; table: string; columns: string[] }>;
  verificationPlans: ReadOnlyVerificationPlan[];
  validation: {
    confidence: number;
    status: "supported" | "partial" | "metadata-only";
    reasons: string[];
  };
}

export const KPI_RULES: KpiRule[] = [
  { id: "admissions", label: "Admissions", family: "Operations", aliases: ["admission", "admits", "soc"], sourceHints: ["client_episodes", "episode"], expressionHints: ["socdate", "startofcare", "count"] },
  { id: "census", label: "Census", family: "Operations", aliases: ["census", "active patients", "patient census"], sourceHints: ["client_episodes", "episode"], expressionHints: ["socdate", "dischargedate", "active"] },
  { id: "adc", label: "Average Daily Census", family: "Operations", aliases: ["adc", "average daily census", "patient days"], sourceHints: ["client_episodes", "census"], expressionHints: ["avg", "average", "datediff", "patient days"] },
  { id: "discharges", label: "Discharges", family: "Operations", aliases: ["discharge", "live discharge"], sourceHints: ["client_episodes"], expressionHints: ["dischargedate", "discharge"] },
  { id: "referrals", label: "Referrals", family: "Growth", aliases: ["referral", "ntuc", "conversion"], sourceHints: ["referral", "episode"], expressionHints: ["non admit", "ntuc", "conversion"] },
  { id: "los", label: "Length of Stay", family: "Operations", aliases: ["los", "length of stay"], sourceHints: ["client_episodes"], expressionHints: ["datediff", "socdate", "dischargedate"] },
  { id: "revenue", label: "Revenue", family: "Financial", aliases: ["revenue", "net revenue", "rpd"], sourceHints: ["billing", "line_items", "claim"], expressionHints: ["amount", "revenue", "sum"] },
  { id: "margin", label: "Contribution Margin", family: "Financial", aliases: ["margin", "contribution margin"], sourceHints: ["billing", "payroll"], expressionHints: ["revenue", "cost", "margin"] },
  { id: "workforce", label: "Workforce Productivity", family: "Workforce", aliases: ["productivity", "turnover", "vacancy", "pto"], sourceHints: ["worker", "employee", "payroll"], expressionHints: ["hours", "fte", "visits"] },
  { id: "quality", label: "Quality and Timeliness", family: "Quality", aliases: ["qa", "timeliness", "oasis", "hospitalization"], sourceHints: ["visit_notes", "oasis", "qa"], expressionHints: ["timely", "completed", "hospital"] },
];

function stripCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, "''");
}

export function splitReadOnlyStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "'" && quoted && next === "'") { current += "''"; index++; continue; }
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "(") depth++;
    if (!quoted && char === ")") depth = Math.max(0, depth - 1);
    if (!quoted && depth === 0 && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function unique(matches: Iterable<string>): string[] {
  return [...new Set([...matches].map((value) => value.replace(/[\[\]]/g, "").trim()).filter(Boolean))];
}

export function analyzeSqlStatement(sql: string, index = 0): SqlStatementAnalysis {
  const clean = stripCommentsAndLiterals(sql);
  const tables = unique([...clean.matchAll(/\b(?:FROM|JOIN)\s+((?:\[[^\]]+\]|[A-Za-z0-9_]+)(?:\.(?:\[[^\]]+\]|[A-Za-z0-9_]+)){0,2})/gi)].map((match) => match[1]));
  const columns = unique([...clean.matchAll(/\b(?:SELECT|,|ON|WHERE|GROUP\s+BY|ORDER\s+BY)\s+(?:DISTINCT\s+)?(?:[A-Za-z0-9_]+\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?/gi)].map((match) => match[1]));
  const joins = unique([...clean.matchAll(/\b(?:INNER|LEFT|RIGHT|FULL)?\s*JOIN\s+([^\s]+)[\s\S]*?\bON\s+([^\r\n]+?)(?=\b(?:INNER|LEFT|RIGHT|FULL)?\s*JOIN\b|\bWHERE\b|\bGROUP\b|$)/gi)].map((match) => `${match[1]} ON ${match[2].trim()}`));
  const filters = unique([...clean.matchAll(/\bWHERE\s+([\s\S]*?)(?=\bGROUP\s+BY\b|\bORDER\s+BY\b|$)/gi)].map((match) => match[1].trim()));
  const groupings = unique([...clean.matchAll(/\bGROUP\s+BY\s+([\s\S]*?)(?=\bHAVING\b|\bORDER\s+BY\b|$)/gi)].flatMap((match) => match[1].split(",")));
  const aggregates = unique([...clean.matchAll(/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(([^)]*)\)/gi)].map((match) => `${match[1].toUpperCase()}(${match[2].trim()})`));
  return { index, sql: sql.trim(), tables, columns, joins, filters, groupings, aggregates };
}

export function classifySqlKpis(sql: string, rules: KpiRule[] = KPI_RULES): KpiClassification[] {
  const normalized = stripCommentsAndLiterals(sql).toLowerCase();
  return rules.map((rule) => {
    const matchedSignals = [
      ...rule.aliases.filter((hint) => normalized.includes(hint.toLowerCase())).map((hint) => `alias:${hint}`),
      ...rule.sourceHints.filter((hint) => normalized.includes(hint.toLowerCase())).map((hint) => `source:${hint}`),
      ...rule.expressionHints.filter((hint) => normalized.includes(hint.toLowerCase())).map((hint) => `expression:${hint}`),
    ];
    const sourceMatch = matchedSignals.some((signal) => signal.startsWith("source:"));
    const expressionMatch = matchedSignals.some((signal) => signal.startsWith("expression:"));
    const confidence = Math.min(95, matchedSignals.length * 15 + (sourceMatch ? 20 : 0) + (expressionMatch ? 15 : 0));
    return {
      ruleId: rule.id,
      label: rule.label,
      family: rule.family,
      confidence,
      matchedSignals,
      validationStatus: sourceMatch && expressionMatch ? "supported" as const : matchedSignals.length > 1 ? "partial" as const : "metadata-only" as const,
    };
  }).filter((classification) => classification.matchedSignals.length > 0).sort((left, right) => right.confidence - left.confidence);
}

export function buildReadOnlyVerificationPlans(statements: SqlStatementAnalysis[]): ReadOnlyVerificationPlan[] {
  return statements.map((statement) => {
    const supported = statement.tables.length > 0 && statement.aggregates.length > 0;
    return {
      statement: statement.index + 1,
      supported,
      aggregateExpressions: statement.aggregates,
      sourceTables: statement.tables,
      reason: supported
        ? "Aggregate result can be compared with a separately executed read-only verification SELECT."
        : statement.tables.length === 0
          ? "No physical source table was identified."
          : "No supported aggregate expression was identified.",
    };
  });
}

export function compareValidationValues(observed: unknown, verified: unknown, tolerance = 0.0001): ValidationComparison {
  const observedNumber = typeof observed === "number" ? observed : Number(observed);
  const verifiedNumber = typeof verified === "number" ? verified : Number(verified);
  if (!Number.isFinite(observedNumber) || !Number.isFinite(verifiedNumber)) {
    return { status: "unverified", confidence: 0, variance: null, reason: "Both observed and verification values must be finite numeric values." };
  }
  const denominator = Math.max(Math.abs(verifiedNumber), 1);
  const variance = Math.abs(observedNumber - verifiedNumber) / denominator;
  if (variance <= tolerance) return { status: "validated", confidence: 100, variance, reason: "Observed value matches the read-only verification result within tolerance." };
  return { status: "partial", confidence: Math.max(0, Math.round((1 - Math.min(variance, 1)) * 100)), variance, reason: "Observed value differs from the read-only verification result." };
}

export function analyzeSqlGovernance(sql: string): SqlGovernanceAnalysis {
  const statements = splitReadOnlyStatements(sql).map(analyzeSqlStatement);
  const classifications = classifySqlKpis(sql);
  const lineage = statements.flatMap((statement) => statement.tables.map((table) => ({ statement: statement.index + 1, table, columns: statement.columns })));
  const verificationPlans = buildReadOnlyVerificationPlans(statements);
  const aggregateCoverage = statements.length ? statements.filter((statement) => statement.aggregates.length > 0).length / statements.length : 0;
  const top = classifications[0];
  const confidence = Math.round((top?.confidence ?? 0) * 0.7 + aggregateCoverage * 30);
  const status = top?.validationStatus ?? "metadata-only";
  const reasons = [
    `${statements.length} read-only result statement${statements.length === 1 ? "" : "s"} analyzed`,
    `${lineage.length} table lineage edge${lineage.length === 1 ? "" : "s"} extracted`,
    top ? `${top.label} matched from ${top.matchedSignals.length} governed signals` : "No governed KPI rule matched",
    aggregateCoverage ? `${Math.round(aggregateCoverage * 100)}% of statements expose aggregate expressions` : "No directly verifiable aggregate expressions",
  ];
  return { statements, classifications, lineage, verificationPlans, validation: { confidence, status, reasons } };
}
