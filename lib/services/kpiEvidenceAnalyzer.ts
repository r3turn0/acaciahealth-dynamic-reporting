import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/gateway";
import { compareKpiEvidence, type KpiComparativeAnalytics, type KpiDriver, type KpiMetricComparison } from "@/lib/services/kpiComparativeAnalytics";
import type { KpiComparativeEvidence, KpiEvidenceBundle } from "@/lib/services/kpiEvidenceService";

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
  citations: Array<{ id: string; reportId: string; reportName: string; version: number; resultSet: number; source: "live" | "cache"; rowCount: number; window: "current" | "prior"; dateRange: { startDate: string; endDate: string } }>;
  dateRange: { startDate: string; endDate: string };
  priorDateRange: { startDate: string; endDate: string } | null;
  comparisons: KpiMetricComparison[];
  deterministicDrivers: KpiDriver[];
  risks: KpiDriver[];
  opportunities: KpiDriver[];
  dataSufficiency: KpiComparativeAnalytics["dataSufficiency"];
  generatedAt: string;
  fallbackReason: string | null;
  synthesis: "ai" | "deterministic" | "metadata";
  askContext: string;
}

export function scoreEvidenceConfidence(bundle: KpiEvidenceBundle, comparisonAvailable = false): KpiEvidenceAnalysis["confidence"] {
  const successfulSets = bundle.evidence.filter((report) => report.status === "success").flatMap((report) => report.resultSets);
  const completeness = successfulSets.length ? successfulSets.reduce((sum, set) => sum + set.completeness, 0) / successfulSets.length : 0;
  const freshness = bundle.evidence.some((report) => report.source === "live") ? 1 : bundle.evidence.some((report) => report.source === "cache") ? 0.85 : 0;
  const score = Math.round(100 * (bundle.coverage * 0.5 + bundle.reportSuccessRate * 0.2 + completeness * 0.15 + freshness * 0.1 + (comparisonAvailable ? 0.05 : 0)));
  return {
    score,
    band: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
    explanation: [
      `${Math.round(bundle.coverage * 100)}% required dependency coverage`,
      `${Math.round(bundle.reportSuccessRate * 100)}% selected report success rate`,
      `${Math.round(completeness * 100)}% populated aggregate evidence cells`,
      freshness ? `${Math.round(freshness * 100)}% freshness contribution` : "No live or eligible cached evidence",
      comparisonAvailable ? "Matched prior-period evidence available" : "Prior-period comparison unavailable",
    ],
  };
}

function citationCatalog(bundles: KpiEvidenceBundle[]): KpiEvidenceAnalysis["citations"] {
  return bundles.flatMap((bundle) => bundle.evidence.flatMap((report) => report.status === "success" ? report.resultSets.map((set, index) => ({
    id: set.citationId, reportId: report.reportId, reportName: report.reportName, version: report.reportVersion,
    resultSet: index + 1, source: report.source, rowCount: set.rowCount, window: report.window, dateRange: report.dateRange,
  })) : []));
}

function emptyAnalytics(): KpiComparativeAnalytics {
  return { currentMetrics: [], priorMetrics: [], comparisons: [], drivers: [], risks: [], opportunities: [], dataSufficiency: { comparableMetrics: 0, currentMetrics: 0, priorMetrics: 0, sufficient: false } };
}

function deterministic(current: KpiEvidenceBundle, startDate: string, endDate: string, prior: KpiEvidenceBundle | null, priorDateRange: { startDate: string; endDate: string } | null, analytics: KpiComparativeAnalytics, reason?: string): KpiEvidenceAnalysis {
  const citations = citationCatalog(prior ? [current, prior] : [current]);
  const confidence = scoreEvidenceConfidence(current, analytics.dataSufficiency.sufficient);
  const successful = current.evidence.filter((report) => report.status === "success");
  const observations = successful.flatMap((report) => report.resultSets.slice(0, 1).map((set) => ({
    statement: `${report.reportName} returned ${set.rowCount} aggregate rows with ${Math.round(set.completeness * 100)}% completeness.`,
    citationIds: [set.citationId], classification: "fact" as const,
  })));
  const missing = [...new Set([...current.uncoveredNodes, ...current.failedNodes])];
  const mode = current.mode === "fallback" || current.coverage < 0.5 ? "metadata-fallback" : current.mode;
  const executiveSummary = successful.length
    ? `${current.graph.root.label} was evaluated from ${successful.length} governed report${successful.length === 1 ? "" : "s"}. Evidence coverage is ${Math.round(current.coverage * 100)}%${analytics.dataSufficiency.sufficient ? ` with ${analytics.dataSufficiency.comparableMetrics} matched prior-period metrics` : ""}; unsupported dependencies are disclosed below.`
    : `${current.graph.root.label} is shown using governed metadata because report evidence was unavailable.`;
  const deterministicDrivers = analytics.drivers;
  return {
    kpiKey: current.graph.root.key, kpiLabel: current.graph.root.label, mode, executiveSummary, headline: null,
    dependencyObservations: observations, keyDrivers: deterministicDrivers.map((driver) => ({ statement: driver.statement, citationIds: driver.citationIds, classification: "fact" })), anomalies: [],
    recommendations: deterministicDrivers.length ? [{ action: "Review the largest cited period movements before operational action.", rationale: "Observed variances are descriptive and do not establish causality.", citationIds: deterministicDrivers.flatMap((item) => item.citationIds).slice(0, 4) }] : observations.length ? [{ action: "Review the cited report segments before operational action.", rationale: "The evidence is aggregate and causal attribution has not been established.", citationIds: observations.flatMap((item) => item.citationIds).slice(0, 2) }] : [],
    missingEvidence: missing, confidence, citations, dateRange: { startDate, endDate }, priorDateRange, comparisons: analytics.comparisons, deterministicDrivers, risks: analytics.risks, opportunities: analytics.opportunities, dataSufficiency: analytics.dataSufficiency, generatedAt: new Date().toISOString(),
    fallbackReason: reason ?? (mode === "metadata-fallback" ? "Evidence coverage did not pass the 50% hybrid threshold." : null),
    synthesis: successful.length ? "deterministic" : "metadata",
    askContext: `${executiveSummary} ${deterministicDrivers.map((driver) => `${driver.statement} [${driver.citationIds.join(", ")}]`).join(" ")} Citations: ${citations.map((citation) => `${citation.id}=${citation.reportName} v${citation.version} ${citation.window}`).join(", ") || "none"}. Missing evidence: ${missing.join(", ") || "none"}.`,
  };
}

function validateCitations<T extends { citationIds: string[] }>(items: T[], valid: Set<string>): T[] {
  return items.filter((item) => item.citationIds.length > 0 && item.citationIds.every((id) => valid.has(id)));
}

export async function analyzeKpiEvidence(bundle: KpiEvidenceBundle, startDate: string, endDate: string, comparative?: KpiComparativeEvidence): Promise<KpiEvidenceAnalysis> {
  const current = comparative?.current ?? bundle;
  const prior = comparative?.prior ?? null;
  const analytics = comparative ? compareKpiEvidence(comparative) : emptyAnalytics();
  const base = deterministic(current, startDate, endDate, prior, comparative?.windows.prior ?? null, analytics);
  if (base.mode === "metadata-fallback" || base.citations.length === 0) return base;
  try {
    const payload = current.evidence.filter((report) => report.status === "success").map((report) => ({
      report: report.reportName, node: report.nodeKey, version: report.reportVersion,
      resultSets: report.resultSets.map((set) => ({ citationId: set.citationId, rowCount: set.rowCount, numericSummary: set.numericSummary, sampleRows: set.sampleRows })),
    }));
    const result = await generateText({
      model: getModel("default"),
      system: "You are a healthcare analytics evidence synthesizer. Use only supplied aggregate evidence and validated comparisons. Every numeric claim must cite valid citationIds. Label possible causes as hypotheses. Never infer patient-level facts or invent missing metrics.",
      prompt: `Analyze ${current.graph.root.label} for ${startDate} through ${endDate}. Formula: ${current.graph.root.formula}. Current evidence: ${JSON.stringify(payload)}. Validated comparisons: ${JSON.stringify(analytics.comparisons.slice(0, 12))}. Missing dependencies: ${base.missingEvidence.join(", ") || "none"}.`,
      experimental_output: Output.object({ schema: EvidenceAnalysisSchema }),
      temperature: 0.1,
    });
    const output = result.experimental_output;
    const valid = new Set(base.citations.map((citation) => citation.id));
    const headline = output.headline && output.headline.citationIds.length > 0 && output.headline.citationIds.every((id) => valid.has(id)) ? output.headline : null;
    const dependencyObservations = validateCitations(output.dependencyObservations, valid);
    const keyDrivers = validateCitations(output.keyDrivers, valid);
    const anomalies = validateCitations(output.anomalies, valid);
    const recommendations = validateCitations(output.recommendations, valid);
    const groundedSummary = output.executiveSummary.trim() || base.executiveSummary;
    return { ...base, executiveSummary: groundedSummary, headline, dependencyObservations, keyDrivers: keyDrivers.length ? keyDrivers : base.keyDrivers, anomalies, recommendations: recommendations.length ? recommendations : base.recommendations, synthesis: "ai", askContext: `${groundedSummary} ${[...dependencyObservations, ...(keyDrivers.length ? keyDrivers : base.keyDrivers)].map((item) => `${item.statement} [${item.citationIds.join(", ")}]`).join(" ")}` };
  } catch (error) {
    return deterministic(current, startDate, endDate, prior, comparative?.windows.prior ?? null, analytics, `AI synthesis unavailable; deterministic evidence summary used. ${error instanceof Error ? error.message : String(error)}`);
  }
}
