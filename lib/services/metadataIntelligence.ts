import type { MetaColumn, MetaTable, ValidationCheck } from "@/lib/services/metadataRegistry";

export type ConfidenceBand = "verified" | "strong" | "possible" | "rejected";
export type DataClassification = "PHI" | "PII" | "SENSITIVE" | "NON_SENSITIVE";
export type RiskLevel = "low" | "medium" | "high";

export interface AdvisoryRecommendation {
  id: string;
  category: "metadata" | "relationship" | "security" | "optimization";
  message: string;
  rationale: string;
  advisory: true;
  virtual: true;
  persisted: false;
}

export interface ColumnClassification {
  table: string;
  column: string;
  classification: DataClassification;
  confidence: number;
  rationale: string;
}

export interface MetadataIntelligenceSummary {
  metadataConsistencyScore: number;
  schemaConfidenceScore: number;
  freshnessScore: number;
  classifications: ColumnClassification[];
  recommendedMetadataUpdates: AdvisoryRecommendation[];
  advisory: true;
  virtual: true;
  persisted: false;
}

export interface SqlColumnUse {
  tableAlias?: string;
  column: string;
}

export interface SqlJoinEvidence {
  left: string;
  right: string;
  confidence: number;
  band: ConfidenceBand;
  evidence: string[];
}

export interface SqlIntelligenceResult {
  validationStatus: "ready" | "warning" | "blocked";
  executionReadinessScore: number;
  queryComplexityScore: number;
  joinConfidenceScore: number;
  tablesUsed: string[];
  usedColumns: SqlColumnUse[];
  primaryKeys: string[];
  foreignKeys: string[];
  filters: string[];
  aggregations: string[];
  joinLogic: SqlJoinEvidence[];
  externalParameters: string[];
  estimatedRowImpact: RiskLevel;
  estimatedCostRisk: RiskLevel;
  errors: string[];
  warnings: string[];
  optimizationRecommendations: AdvisoryRecommendation[];
  advisory: true;
  virtual: true;
  persisted: false;
}

const PHI_PATTERNS = [
  /patient/i, /client/i, /member/i, /medical.?record/i, /mrn/i, /diagnos/i,
  /birth/i, /dob/i, /admission/i, /discharge/i, /episode/i,
];
const PII_PATTERNS = [
  /name/i, /email/i, /phone/i, /address/i, /ssn/i, /social.?security/i,
  /worker/i, /employee/i, /license/i,
];
const SENSITIVE_PATTERNS = [/payor/i, /payer/i, /claim/i, /amount/i, /salary/i, /credential/i];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyColumn(table: string, column: MetaColumn): ColumnClassification {
  const subject = `${table}.${column.name}`;
  const match = (patterns: RegExp[]) => patterns.find((pattern) => pattern.test(subject));
  const phi = match(PHI_PATTERNS);
  const pii = match(PII_PATTERNS);
  const sensitive = match(SENSITIVE_PATTERNS);
  const classification: DataClassification = phi ? "PHI" : pii ? "PII" : sensitive ? "SENSITIVE" : "NON_SENSITIVE";
  return {
    table,
    column: column.name,
    classification,
    confidence: classification === "NON_SENSITIVE" ? 72 : 88,
    rationale: classification === "NON_SENSITIVE"
      ? "No governed healthcare or identity naming signal was detected; no values were sampled."
      : `Column name matched a governed ${classification} terminology rule; no values were sampled.`,
  };
}

export function buildMetadataIntelligence(
  catalog: Map<string, MetaTable>,
  checks: ValidationCheck[],
  liveSchemaAvailable: boolean,
): MetadataIntelligenceSummary {
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const warned = checks.filter((check) => check.status === "WARN").length;
  const metadataConsistencyScore = clampScore(100 - failed * 18 - warned * 6);
  const liveCoverage = [...catalog.values()].filter((table) => table.sources.includes("live_db")).length;
  const schemaConfidenceScore = liveSchemaAvailable
    ? clampScore(75 + (liveCoverage / Math.max(1, catalog.size)) * 25 - failed * 10)
    : clampScore(68 - failed * 10);
  const freshnessScore = liveSchemaAvailable ? 100 : 65;
  const classifications = [...catalog.values()]
    .flatMap((table) => table.columns.map((column) => classifyColumn(table.id, column)))
    .filter((item) => item.classification !== "NON_SENSITIVE")
    .slice(0, 100);
  const recommendedMetadataUpdates = checks
    .filter((check) => check.status === "FAIL" || check.status === "WARN")
    .map((check) => ({
      id: `metadata-${check.id}`,
      category: "metadata" as const,
      message: check.fixHint ?? `Review ${check.name}`,
      rationale: check.detail ?? check.description,
      advisory: true as const,
      virtual: true as const,
      persisted: false as const,
    }));

  return {
    metadataConsistencyScore,
    schemaConfidenceScore,
    freshnessScore,
    classifications,
    recommendedMetadataUpdates,
    advisory: true,
    virtual: true,
    persisted: false,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function confidenceBand(score: number): ConfidenceBand {
  if (score >= 95) return "verified";
  if (score >= 80) return "strong";
  if (score >= 60) return "possible";
  return "rejected";
}

const FROM_CLAUSE_TERMINATOR = /^(?:where|group\s+by|order\s+by|having|union|intersect|except|join|left\s+join|right\s+join|full\s+join|inner\s+join|outer\s+apply|cross\s+apply)\b/i;

/** Detect only top-level commas in FROM source lists, not projection, CTE, function, or grouping commas. */
function hasCommaSeparatedFromSources(sql: string): boolean {
  const sanitized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, "''");

  for (const fromMatch of sanitized.matchAll(/\bfrom\b/gi)) {
    let depth = 0;
    const start = (fromMatch.index ?? 0) + fromMatch[0].length;
    for (let index = start; index < sanitized.length; index += 1) {
      const character = sanitized[index];
      if (character === "(") depth += 1;
      else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && character === ",") {
        return true;
      }

      if (depth === 0 && FROM_CLAUSE_TERMINATOR.test(sanitized.slice(index))) break;
      if (depth === 0 && character === ";") break;
    }
  }
  return false;
}

export function analyzeSql(sql: string, catalog = new Map<string, MetaTable>()): SqlIntelligenceResult {
  const cteNames = new Set(
    [...sql.matchAll(/(?:\bwith|,)\s*([A-Za-z_]\w*)\s+as\s*\(/gi)]
      .map((match) => match[1].toLowerCase()),
  );
  const tablesUsed = unique([...sql.matchAll(/\b(?:from|join)\s+([\[\]\w.]+)/gi)].map((match) => match[1].replace(/[\[\]]/g, "")));
  const usedColumns = unique([...sql.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g)].map((match) => `${match[1]}.${match[2]}`))
    .map((value) => { const [tableAlias, column] = value.split("."); return { tableAlias, column }; });
  const filters = [...sql.matchAll(/\bwhere\b([\s\S]*?)(?=\bgroup\s+by\b|\border\s+by\b|$)/gi)].map((match) => match[1].trim()).filter(Boolean);
  const aggregations = unique([...sql.matchAll(/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(([^)]*)\)/gi)].map((match) => `${match[1].toUpperCase()}(${match[2].trim()})`));
  const externalParameters = unique([...sql.matchAll(/@[A-Za-z_]\w*/g)].map((match) => match[0]));
  const joinMatches = [...sql.matchAll(/\bjoin\s+([\[\]\w.]+)(?:\s+(?:as\s+)?\w+)?\s+on\s+([\w.\[\]]+)\s*=\s*([\w.\[\]]+)/gi)];
  const joinLogic = joinMatches.map((match) => {
    const left = match[2].replace(/[\[\]]/g, "");
    const right = match[3].replace(/[\[\]]/g, "");
    const sameName = left.split(".").at(-1)?.toLowerCase() === right.split(".").at(-1)?.toLowerCase();
    const score = sameName ? 84 : 68;
    return { left, right, confidence: score, band: confidenceBand(score), evidence: sameName ? ["Type-compatible same-name join candidate"] : ["Join expression detected; verify relationship metadata"] };
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  if (/\bselect\s+\*/i.test(sql)) warnings.push("SELECT * reduces lineage precision; select explicit columns.");
  if (joinLogic.length === 0 && hasCommaSeparatedFromSources(sql)) errors.push("Potential Cartesian join detected.");
  if (/\bjoin\b/i.test(sql) && joinLogic.length === 0) warnings.push("A join was detected without a simple validated equality path.");
  for (const table of tablesUsed) {
    if (cteNames.has(table.toLowerCase())) continue;
    if (catalog.size > 0 && ![...catalog.keys()].some((id) => id.toLowerCase() === table.toLowerCase() || id.endsWith(`.${table.toLowerCase()}`))) {
      warnings.push(`Table '${table}' is not present in the verified metadata catalog.`);
    }
  }
  const averageJoinConfidence = joinLogic.length ? joinLogic.reduce((sum, join) => sum + join.confidence, 0) / joinLogic.length : 100;
  const complexity = clampScore(10 + tablesUsed.length * 12 + joinLogic.length * 14 + aggregations.length * 8 + filters.length * 5);
  const readiness = clampScore(100 - errors.length * 45 - warnings.length * 8 - Math.max(0, 80 - averageJoinConfidence) / 2);
  const risk: RiskLevel = complexity >= 70 ? "high" : complexity >= 40 ? "medium" : "low";
  const optimizationRecommendations: AdvisoryRecommendation[] = [];
  if (!filters.length) optimizationRecommendations.push({ id: "sql-date-filter", category: "optimization", message: "Add a bounded date filter where the business question supports one.", rationale: "Bounded filters reduce scan volume and improve reporting reliability.", advisory: true, virtual: true, persisted: false });
  if (/\bselect\s+\*/i.test(sql)) optimizationRecommendations.push({ id: "sql-explicit-columns", category: "optimization", message: "Replace SELECT * with governed columns.", rationale: "Explicit columns improve lineage, stability, and data minimization.", advisory: true, virtual: true, persisted: false });

  return {
    validationStatus: errors.length ? "blocked" : warnings.length ? "warning" : "ready",
    executionReadinessScore: readiness,
    queryComplexityScore: complexity,
    joinConfidenceScore: clampScore(averageJoinConfidence),
    tablesUsed,
    usedColumns,
    primaryKeys: [],
    foreignKeys: [],
    filters,
    aggregations,
    joinLogic,
    externalParameters,
    estimatedRowImpact: !filters.length && tablesUsed.length > 0 ? "high" : risk,
    estimatedCostRisk: risk,
    errors,
    warnings,
    optimizationRecommendations,
    advisory: true,
    virtual: true,
    persisted: false,
  };
}
