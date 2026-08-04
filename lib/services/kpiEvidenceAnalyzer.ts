import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/gateway";
import type { KpiEvidenceBundle } from "@/lib/services/kpiEvidenceService";

const CitedObservationSchema = z.object({
  statement: z.string(),
  citationIds: z.array(z.string()),
  classification: z.enum(["fact", "hypothesis"]),
});

const EvidenceAnalysisSchema = z.object({
  executiveSummary: z.string(),
  headline: z.object({ label: z.string(), value: z.string(), citationIds: z.array(z.string()) }).nullable(),
  dependencyObservations: z.array(CitedObservationSchema),
  keyDrivers: z.array(CitedObservationSchema),
  anomalies: z.array(CitedObservationSchema),
  recommendations: z.array(z.object({ action: z.string(), rationale: z.string(), citationIds: z.array(z.string()) })),
});

export interface KpiEvidenceAnalysis {
  kpiKey: string;
  kpiLabel: string;
  mode: "live" | "cached" | "partial" | "metadata-fallback";
  executiveSummary: string;
  headline: { label: string; value: string; citationIds: string[] } | null;
  dependencyObservations: Array<z.infer<typeof CitedObservationSchema>>;
  keyDrivers: Array<z.infer<typeof CitedObservationSchema>>;
  anomalies: Array<z.infer<typeof CitedObservationSchema>>;
  recommendations: Array<{ action: string; rationale: string; citationIds: string[] }>;
  missingEvidence: string[];
  confidence: { score: number; band: "high" | "medium" | "low"; explanation: string[] };
  citations: Array<{ id: string; reportId: string; reportName: string; version: number; resultSet: number; source: "live" | "cache"; rowCount: number }>;
  dateRange: { startDate: string; endDate: string };
  generatedAt: string;
  fallbackReason: string | null;
  synthesis: "ai" | "deterministic" | "metadata";
  askContext: string;
}

export function scoreEvidenceConfidence(bundle: KpiEvidenceBundle): KpiEvidenceAnalysis["confidence"] {
  const successfulSets = bundle.evidence.filter((report) => report.status === "success").flatMap((report) => report.resultSets);
  const completeness = successfulSets.length ? successfulSets.reduce((sum, set) => sum + set.completeness, 0) / successfulSets.length : 0;
  const freshness = bundle.evidence.some((report) => report.source === "live") ? 1 : bundle.evidence.some((report) => report.source === "cache") ? 0.85 : 0;
  const score = Math.round(100 * (bundle.coverage * 0.55 + bundle.reportSuccessRate * 0.2 + completeness * 0.15 + freshness * 0.1));
  return {
    score,
    band: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
    explanation: [
      `${Math.round(bundle.coverage * 100)}% required dependency coverage`,
      `${Math.round(bundle.reportSuccessRate * 100)}% selected report success rate`,
      `${Math.round(completeness * 100)}% populated aggregate evidence cells`,
      freshness ? `${Math.round(freshness * 100)}% freshness contribution` : "No live or eligible cached evidence",
    ],
  };
}

function citationCatalog(bundle: KpiEvidenceBundle): KpiEvidenceAnalysis["citations"] {
  return bundle.evidence.flatMap((report) => report.status === "success" ? report.resultSets.map((set, index) => ({
    id: set.citationId, reportId: report.reportId, reportName: report.reportName, version: report.reportVersion,
    resultSet: index + 1, source: report.source, rowCount: set.rowCount,
  })) : []);
}

function deterministic(bundle: KpiEvidenceBundle, startDate: string, endDate: string, reason?: string): KpiEvidenceAnalysis {
  const citations = citationCatalog(bundle);
  const confidence = scoreEvidenceConfidence(bundle);
  const successful = bundle.evidence.filter((report) => report.status === "success");
  const observations = successful.flatMap((report) => report.resultSets.slice(0, 1).map((set) => ({
    statement: `${report.reportName} returned ${set.rowCount} aggregate rows with ${Math.round(set.completeness * 100)}% completeness.`,
    citationIds: [set.citationId], classification: "fact" as const,
  })));
  const missing = [...new Set([...bundle.uncoveredNodes, ...bundle.failedNodes])];
  const mode = bundle.mode === "fallback" || bundle.coverage < 0.5 ? "metadata-fallback" : bundle.mode;
  const executiveSummary = successful.length
    ? `${bundle.graph.root.label} was evaluated from ${successful.length} governed report${successful.length === 1 ? "" : "s"}. Evidence coverage is ${Math.round(bundle.coverage * 100)}%; unsupported dependencies are disclosed below.`
    : `${bundle.graph.root.label} is shown using governed metadata because report evidence was unavailable.`;
  return {
    kpiKey: bundle.graph.root.key, kpiLabel: bundle.graph.root.label, mode, executiveSummary, headline: null,
    dependencyObservations: observations, keyDrivers: [], anomalies: [],
    recommendations: observations.length ? [{ action: "Review the cited report segments before operational action.", rationale: "The evidence is aggregate and causal attribution has not been established.", citationIds: observations.flatMap((item) => item.citationIds).slice(0, 2) }] : [],
    missingEvidence: missing, confidence, citations, dateRange: { startDate, endDate }, generatedAt: new Date().toISOString(),
    fallbackReason: reason ?? (mode === "metadata-fallback" ? "Evidence coverage did not pass the 50% hybrid threshold." : null),
    synthesis: successful.length ? "deterministic" : "metadata",
    askContext: `${executiveSummary} Citations: ${citations.map((citation) => `${citation.id}=${citation.reportName} v${citation.version}`).join(", ") || "none"}. Missing evidence: ${missing.join(", ") || "none"}.`,
  };
}

function validateCitations<T extends { citationIds: string[] }>(items: T[], valid: Set<string>): T[] {
  return items.filter((item) => item.citationIds.length > 0 && item.citationIds.every((id) => valid.has(id)));
}

export async function analyzeKpiEvidence(bundle: KpiEvidenceBundle, startDate: string, endDate: string): Promise<KpiEvidenceAnalysis> {
  const base = deterministic(bundle, startDate, endDate);
  if (base.mode === "metadata-fallback" || base.citations.length === 0) return base;
  try {
    const payload = bundle.evidence.filter((report) => report.status === "success").map((report) => ({
      report: report.reportName, node: report.nodeKey, version: report.reportVersion,
      resultSets: report.resultSets.map((set) => ({ citationId: set.citationId, rowCount: set.rowCount, numericSummary: set.numericSummary, sampleRows: set.sampleRows })),
    }));
    const result = await generateText({
      model: getModel("default"),
      system: "You are a healthcare analytics evidence synthesizer. Use only supplied aggregate evidence. Every numeric or causal claim must cite one or more valid citationIds. Label correlation or possible causes as hypotheses. Never infer patient-level facts or invent missing metrics.",
      prompt: `Analyze ${bundle.graph.root.label} for ${startDate} through ${endDate}. Formula: ${bundle.graph.root.formula}. Evidence: ${JSON.stringify(payload)}. Missing dependencies: ${base.missingEvidence.join(", ") || "none"}.`,
      experimental_output: Output.object({ schema: EvidenceAnalysisSchema }),
      temperature: 0.1,
    });
    const output = result.experimental_output;
    const valid = new Set(base.citations.map((citation) => citation.id));
    const headline = output.headline && output.headline.citationIds.length > 0 && output.headline.citationIds.every((id) => valid.has(id)) ? output.headline : null;
    const dependencyObservations = validateCitations(output.dependencyObservations, valid);
    const keyDrivers = validateCitations(output.keyDrivers, valid);
    const anomalies = validateCitations(output.anomalies, valid);
    const recommendations = output.recommendations.filter((item) => item.citationIds.length > 0 && item.citationIds.every((id) => valid.has(id)));
    return { ...base, executiveSummary: output.executiveSummary, headline, dependencyObservations, keyDrivers, anomalies, recommendations, synthesis: "ai", askContext: `${output.executiveSummary} ${[...dependencyObservations, ...keyDrivers].map((item) => `${item.statement} [${item.citationIds.join(", ")}]`).join(" ")}` };
  } catch (error) {
    return deterministic(bundle, startDate, endDate, `AI synthesis unavailable; deterministic evidence summary used. ${error instanceof Error ? error.message : String(error)}`);
  }
}
