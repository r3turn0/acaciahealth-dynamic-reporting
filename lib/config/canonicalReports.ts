import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CanonicalReport {
  name: string;
  sourceFile: string;
  resultSet: number;
  resultSetCount: number;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
}

interface SourceDefinition {
  file: string;
  kpi: string;
  resultNames: string[];
}

const SOURCES: SourceDefinition[] = [
  { file: "Avg Admittance Referals.sql", kpi: "avg_days_referral_to_admission", resultNames: ["Avg Admittance Referals"] },
  { file: "Admissions.sql", kpi: "admissions", resultNames: ["Admissions — Result 1", "Admissions — Result 2"] },
  { file: "Discharges and Live Discharges.sql", kpi: "discharges", resultNames: ["Discharges and Live Discharges — Result 1", "Discharges and Live Discharges — Result 2", "Discharges and Live Discharges — Result 3"] },
  { file: "Hospice Census Equivalent.sql", kpi: "hospice_census_equivalent", resultNames: ["Hospice Census Equivalent — Result 1", "Hospice Census Equivalent — Result 2", "Hospice Census Equivalent — Result 3"] },
  { file: "Billing Holds.sql", kpi: "billing_holds", resultNames: ["Billing Holds"] },
  { file: "QA Compliance.sql", kpi: "qa_compliance", resultNames: ["QA Compliance"] },
  { file: "Length of Stay.sql", kpi: "avg_length_of_stay", resultNames: ["Length of Stay — Result 1", "Length of Stay — Result 2"] },
  { file: "New Admissions BP1 - Fixed.sql", kpi: "bp1_compliance_within_48hrs", resultNames: ["New Admissions BP1 - Fixed — Result 1", "New Admissions BP1 - Fixed — Result 2"] },
  { file: "Lupa.sql", kpi: "lupa_rate", resultNames: ["Lupa — Result 1", "Lupa — Result 2"] },
  { file: "Referrals and NTUC - Fixed.sql", kpi: "referrals_ntuc", resultNames: ["Referrals and NTUC - Fixed — Result 1", "Referrals and NTUC - Fixed — Result 2"] },
  { file: "Recerts.sql", kpi: "recertifications", resultNames: ["Recerts — Result 1", "Recerts — Result 2"] },
  { file: "Census and ADC by Service Line and Branch.sql", kpi: "current_census_by_service_line_branch", resultNames: ["Census and ADC by Service Line and Branch"] },
  { file: "Current Census By Service Line and Branch.sql", kpi: "current_census_by_service_line_branch", resultNames: ["Raw Current Census By Service Line and Branch — Current Census"] },
  { file: "14 Rolling Days ADC with Patient Days and Current Census vs ADC.sql", kpi: "average_daily_census", resultNames: ["Raw Current Census By Service Line and Branch + 14 Rolling Days ADC with Patient Days and Current Census vs ADC — 14-Day ADC and Patient Days"] },
  { file: "Daily Census.sql", kpi: "current_census_by_service_line_branch", resultNames: ["Raw Daily Census"] },
  { file: "Current Census and ADC.sql", kpi: "average_daily_census", resultNames: ["Raw Census and ADC"] },
  { file: "Current Census and ADC Month to Date.sql", kpi: "average_daily_census", resultNames: ["Raw Current Census and ADC Month to Date"] },
  { file: "Unbilled and AR.sql", kpi: "ar_aging", resultNames: ["Unbilled and AR — Result 1", "Unbilled and AR — Result 2", "Unbilled and AR — Result 3"] },
  { file: "Revenue and RPD.sql", kpi: "revenue", resultNames: ["Revenue and RPD — Result 1", "Revenue and RPD — Result 2"] },
  { file: "Patient Days.sql", kpi: "patient_days", resultNames: ["Patient Days"] },
  { file: "Client Episode Visit Notes with Service Lines.sql", kpi: "visit_notes", resultNames: ["Client Episode Visit Notes with Service Lines"] },
];

function normalizeSource(source: string): string {
  return source
    .replace(/^\s*USE\s+HCHB_AcaciaHealth\s*;?\s*$/gim, "")
    .replace(/^\s*GO\s*;?\s*$/gim, "")
    .replace(/^\s*DECLARE\s+@StartDate\b[^\r\n]*\r?\n?/gim, "")
    .replace(/^\s*DECLARE\s+@EndDate\b[^\r\n]*\r?\n?/gim, "")
    .replace(/^\s*DECLARE\s+@AsOfDate\b[^\r\n]*\r?\n?/gim, "")
    .replace(/^\s*DECLARE\s+@HceFactor\b[^\r\n]*\r?\n?/gim, "")
    .replace(/@AsOfDate\b/g, "CAST(GETDATE() AS date)")
    .replace(/@HceFactor\b/g, "CAST(0.40 AS decimal(5,3))")
    .trim();
}

function splitResultSets(source: string, file: string): string[] {
  let parts = source.split(/\r?\n(?=;WITH\s)/i);

  // Comments and non-date declarations before the first CTE belong to result 1.
  if (parts.length > 1 && !/\bSELECT\b/i.test(parts[0])) {
    parts = [`${parts[0]}\n${parts[1]}`, ...parts.slice(2)];
  }

  if (file === "New Admissions BP1 - Fixed.sql" && parts.length === 1) {
    const starts = [...source.matchAll(/^WITH admissions AS\s*$/gim)].map((match) => match.index ?? 0);
    if (starts.length > 1) {
      parts = [source.slice(0, starts[1]), source.slice(starts[1])];
    }
  }

  return parts.map((part) => part.trim()).filter(Boolean);
}

function assertCanonicalSql(sql: string, file: string, resultSet: number): void {
  const auditTarget = `${file} result set ${resultSet}`;
  if (/\bSELECT[ \t]+(?:[A-Za-z_][A-Za-z0-9_]*\.)?\*/i.test(sql)) {
    throw new Error(`${auditTarget}: wildcard SELECT projections are not allowed`);
  }
  if (/^\s*(?:USE|GO)\b/im.test(sql)) {
    throw new Error(`${auditTarget}: database context and batch directives are not allowed`);
  }
  if (/\bDECLARE\s+@(StartDate|EndDate|EndOfDate|AsOfDate)\b/i.test(sql)) {
    throw new Error(`${auditTarget}: Report Studio date parameters must not be redeclared`);
  }
}

function loadSource(definition: SourceDefinition): CanonicalReport[] {
  const path = join(process.cwd(), "lib", "config", "report-sql", definition.file);
  const source = normalizeSource(readFileSync(path, "utf8"));
  const statements = splitResultSets(source, definition.file);

  statements.forEach((sql, index) => assertCanonicalSql(sql, definition.file, index + 1));

  if (statements.length !== definition.resultNames.length) {
    throw new Error(
      `${definition.file}: expected ${definition.resultNames.length} result sets, found ${statements.length}`
    );
  }

  const baseName = definition.file.replace(/\.sql$/i, "");
  return statements.map((sql, index) => ({
    name: definition.resultNames[index],
    sourceFile: definition.file,
    resultSet: index + 1,
    resultSetCount: statements.length,
    description: statements.length === 1
      ? `Canonical report imported from ${definition.file}.`
      : `Canonical result set ${index + 1} of ${statements.length} imported from ${definition.file}.`,
    prompt: `Run ${baseName}${statements.length > 1 ? ` result set ${index + 1}` : ""}`,
    sql,
    kpi: definition.kpi,
    tags: [definition.kpi, "canonical", "uploaded-sql", `result-set-${index + 1}`],
  }));
}

export const CANONICAL_REPORTS: CanonicalReport[] = SOURCES.flatMap(loadSource);
