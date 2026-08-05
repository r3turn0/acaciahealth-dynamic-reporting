import { createHash } from "node:crypto";
import type { SavedReport } from "@/lib/services/reportService";

export type ReportSimilarity = "exact" | "near";

export interface ReportAuditMember {
  reportId: string;
  reportName: string;
  similarity: number;
  reason: string;
}

export interface ReportAuditGroup {
  id: string;
  kind: ReportSimilarity;
  canonicalReportId: string;
  canonicalReportName: string;
  members: ReportAuditMember[];
  recommendation: string;
}

function normalizeSql(sql: string) {
  return sql.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").replace(/;$/, "").trim().toLowerCase();
}

function terms(report: SavedReport) {
  const tables = Array.from(report.sql.matchAll(/\b(?:from|join)\s+(?:\[?\w+\]?\.)?\[?([\w.]+)\]?/gi), (match) => match[1].toLowerCase());
  const aliases = Array.from(report.sql.matchAll(/\bas\s+\[?([\w ]+)\]?/gi), (match) => match[1].trim().toLowerCase().replace(/\s+/g, "_"));
  return new Set([report.kpi.toLowerCase(), ...report.tags.map((tag) => tag.toLowerCase()), ...tables, ...aliases]);
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function canonical(reports: SavedReport[]) {
  return [...reports].sort((a, b) => b.run_count - a.run_count || b.version - a.version || a.created_date.localeCompare(b.created_date))[0];
}

export function auditReports(reports: SavedReport[], nearThreshold = 0.72): ReportAuditGroup[] {
  const assigned = new Set<string>();
  const groups: ReportAuditGroup[] = [];

  for (const report of reports) {
    if (assigned.has(report.id)) continue;
    const reportSql = normalizeSql(report.sql);
    const reportHash = createHash("sha256").update(reportSql).digest("hex");
    const reportTerms = terms(report);
    const matches: Array<{ report: SavedReport; similarity: number; kind: ReportSimilarity; reason: string }> = [];

    for (const candidate of reports) {
      if (candidate.id === report.id || assigned.has(candidate.id)) continue;
      const candidateHash = createHash("sha256").update(normalizeSql(candidate.sql)).digest("hex");
      if (candidateHash === reportHash) {
        matches.push({ report: candidate, similarity: 1, kind: "exact", reason: "Normalized SQL is identical" });
        continue;
      }
      const semanticScore = jaccard(reportTerms, terms(candidate));
      const kpiBoost = report.kpi && report.kpi === candidate.kpi ? 0.15 : 0;
      const score = Math.min(0.99, semanticScore * 0.85 + kpiBoost);
      if (score >= nearThreshold) matches.push({ report: candidate, similarity: score, kind: "near", reason: "KPI, source, and result-shape signals overlap" });
    }

    if (!matches.length) continue;
    const members = [report, ...matches.map((match) => match.report)];
    const preferred = canonical(members);
    members.forEach((member) => assigned.add(member.id));
    const kind: ReportSimilarity = matches.every((match) => match.kind === "exact") ? "exact" : "near";
    groups.push({
      id: createHash("sha256").update(members.map((member) => member.id).sort().join(":" )).digest("hex").slice(0, 12),
      kind,
      canonicalReportId: preferred.id,
      canonicalReportName: preferred.name,
      members: members.map((member) => {
        const match = matches.find((item) => item.report.id === member.id);
        return { reportId: member.id, reportName: member.name, similarity: member.id === report.id ? 1 : match?.similarity ?? 1, reason: member.id === report.id ? "Audit group reference" : match?.reason ?? "Related report" };
      }),
      recommendation: `Review ${members.length} preserved variants and use “${preferred.name}” as the canonical report.`,
    });
  }
  return groups;
}
