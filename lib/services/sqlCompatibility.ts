export interface SqlCompatibilityReport {
  compatible: boolean;
  statementCount: number;
  declaredParameters: string[];
  referencedParameters: string[];
  unresolvedParameters: string[];
  features: string[];
  warnings: string[];
  errors: string[];
}

export interface BindValue {
  name: string;
  value: unknown;
  type?: string;
}

const PARAMETER = /@[A-Za-z_][A-Za-z0-9_]*/g;

function executableSql(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, "''")
    .replace(/\[(?:[^\]]|\]\])*\]/g, "[]")
    .replace(/"(?:""|[^"])*"/g, '""');
}

export function declaredSqlParameters(sql: string) {
  const executable = executableSql(sql);
  return [...new Set([...executable.matchAll(/\bDECLARE\s+(@[A-Za-z_][A-Za-z0-9_]*)\b/gi)].map((match) => match[1].slice(1).toLowerCase()))];
}

export function referencedSqlParameters(sql: string) {
  const declared = new Set(declaredSqlParameters(sql));
  return [...new Set((executableSql(sql).match(PARAMETER) ?? []).map((name) => name.slice(1).toLowerCase()))].filter((name) => !declared.has(name));
}

export function stripLeadingDeclareBlock(sql: string) {
  let remaining = sql.trim();
  while (/^DECLARE\b/i.test(remaining)) {
    const boundary = remaining.indexOf(";");
    if (boundary < 0) break;
    remaining = remaining.slice(boundary + 1).trim();
  }
  return remaining;
}

export function bindUnresolvedParameters(sql: string, candidates: BindValue[]) {
  const unresolved = new Set(referencedSqlParameters(sql));
  return candidates.filter((candidate) => unresolved.has(candidate.name.toLowerCase()));
}

export function analyzeSqlCompatibility(sql: string, availableParameterNames: string[] = []) : SqlCompatibilityReport {
  const executable = executableSql(sql);
  const declaredParameters = declaredSqlParameters(sql);
  const referencedParameters = referencedSqlParameters(sql);
  const available = new Set(availableParameterNames.map((name) => name.replace(/^@/, "").toLowerCase()));
  const unresolvedParameters = referencedParameters.filter((name) => !available.has(name));
  const features: string[] = [];
  if (/\bDECLARE\b/i.test(executable)) features.push("Local variables");
  if (/\bWITH\b/i.test(executable)) features.push("CTEs");
  if (/\bOVER\s*\(/i.test(executable)) features.push("Window functions");
  if (/\bUNION(?:\s+ALL)?\b/i.test(executable)) features.push("Set operations");
  if (/\b(?:CROSS|OUTER)\s+APPLY\b/i.test(executable)) features.push("APPLY operators");
  if (/\bPIVOT\b/i.test(executable)) features.push("PIVOT");
  if (/\bCASE\b/i.test(executable)) features.push("CASE expressions");
  const statementCount = stripLeadingDeclareBlock(executable).split(";").map((part) => part.trim()).filter(Boolean).length;
  const warnings = unresolvedParameters.length ? [`Missing values for: ${unresolvedParameters.map((name) => `@${name}`).join(", ")}`] : [];
  return { compatible: warnings.length === 0, statementCount, declaredParameters, referencedParameters, unresolvedParameters, features, warnings, errors: [] };
}
