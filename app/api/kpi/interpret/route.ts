import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId } from "@/lib/ai/gateway";
import { buildCompactInterpretationPrompt } from "@/lib/ai/insightAgentPrompt";
import { checkRateLimit } from "@/lib/middleware/rateLimiter";
import { collectComparativeKpiEvidence } from "@/lib/services/kpiEvidenceService";
import { analyzeKpiEvidence } from "@/lib/services/kpiEvidenceAnalyzer";
import type { AnalysisSource } from "@/lib/services/kpiAnalysisTypes";

const CitedTextSchema = z.object({ statement: z.string(), citation_ids: z.array(z.string()).min(1) });
const BusinessInsightsSchema = z.object({
  summary: z.string(), plain_language_summary: z.string(), period_label: z.string(),
  headline_metric: z.object({ label: z.string(), value: z.string(), context: z.string(), citation_ids: z.array(z.string()).min(1) }).nullable(),
  evidence: z.array(CitedTextSchema),
  trends: z.array(z.object({ label: z.string(), direction: z.enum(["up", "down", "flat"]), magnitude: z.string().nullable(), insight: z.string(), citation_ids: z.array(z.string()).min(1) })),
  top_segments: z.array(z.object({ segment: z.string(), value: z.string(), share_of_total: z.string().nullable(), commentary: z.string(), citation_ids: z.array(z.string()).min(1) })),
  alerts: z.array(z.object({ severity: z.enum(["high", "medium", "low"]), title: z.string(), detail: z.string(), recommended_action: z.string(), citation_ids: z.array(z.string()).min(1) })),
  risks: z.array(CitedTextSchema), opportunities: z.array(CitedTextSchema),
  recommended_actions: z.array(z.object({ horizon: z.enum(["immediate", "medium-term", "long-term"]), action: z.string(), rationale: z.string(), citation_ids: z.array(z.string()).min(1) })),
  data_quality_notes: z.array(z.string()).nullable(), confidence: z.enum(["high", "medium", "low"]),
  source_reports_used: z.array(z.object({ id: z.string(), name: z.string(), mode: z.enum(["live", "cache", "upload", "metadata"]), result_set_count: z.number() })),
});
export type BusinessInsights = z.infer<typeof BusinessInsightsSchema>;

const BodySchema = z.object({
  report_name: z.string().max(200).optional(), kpi: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data: z.array(z.record(z.string(), z.unknown())).max(5_000).optional(), columns: z.array(z.string()).max(100).optional(),
  sources: z.array(z.custom<AnalysisSource>()).max(12).optional(),
});

function validateOutput(insights: BusinessInsights, valid: Set<string>): BusinessInsights {
  const validIds = (ids: string[]) => ids.every((id) => valid.has(id));
  return {
    ...insights,
    headline_metric: insights.headline_metric && validIds(insights.headline_metric.citation_ids) ? insights.headline_metric : null,
    evidence: insights.evidence.filter((item) => validIds(item.citation_ids)),
    trends: insights.trends.filter((item) => validIds(item.citation_ids)),
    top_segments: insights.top_segments.filter((item) => validIds(item.citation_ids)),
    alerts: insights.alerts.filter((item) => validIds(item.citation_ids)),
    risks: insights.risks.filter((item) => validIds(item.citation_ids)),
    opportunities: insights.opportunities.filter((item) => validIds(item.citation_ids)),
    recommended_actions: insights.recommended_actions.filter((item) => validIds(item.citation_ids)),
  };
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, { limit: 20, window: 60, prefix: "kpi-interpret" });
  if (!rl.success) return rl.response;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid KPI interpretation request", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const body = parsed.data;
  if (body.start_date > body.end_date) return NextResponse.json({ error: "start_date must not be after end_date" }, { status: 400 });

  try {
    const comparative = await collectComparativeKpiEvidence(body.kpi, body.start_date, body.end_date);
    if (comparative && comparative.current.evidence.some((item) => item.status === "success") && !body.sources?.length && !body.data?.length) {
      const analysis = await analyzeKpiEvidence(comparative.current, body.start_date, body.end_date, comparative);
      const insights: BusinessInsights = {
        summary: analysis.executiveSummary,
        plain_language_summary: analysis.executiveSummary,
        period_label: `${body.start_date} to ${body.end_date}`,
        headline_metric: analysis.headline ? { label: analysis.headline.label, value: analysis.headline.value, context: "Supported by governed report evidence", citation_ids: analysis.headline.citationIds } : null,
        evidence: analysis.dependencyObservations.map((item) => ({ statement: item.statement, citation_ids: item.citationIds })),
        trends: analysis.deterministicDrivers.map((item) => ({ label: item.label, direction: item.direction, magnitude: `${item.magnitude.toFixed(1)}%`, insight: item.statement, citation_ids: item.citationIds })),
        top_segments: [],
        alerts: analysis.risks.map((item) => ({ severity: "medium" as const, title: item.label, detail: item.statement, recommended_action: "Review the cited report evidence before operational action.", citation_ids: item.citationIds })),
        risks: analysis.risks.map((item) => ({ statement: item.statement, citation_ids: item.citationIds })),
        opportunities: analysis.opportunities.map((item) => ({ statement: item.statement, citation_ids: item.citationIds })),
        recommended_actions: analysis.recommendations.map((item) => ({ horizon: "immediate" as const, action: item.action, rationale: item.rationale, citation_ids: item.citationIds })),
        data_quality_notes: analysis.missingEvidence.length ? analysis.missingEvidence.map((item) => `Missing evidence: ${item}`) : null,
        confidence: analysis.confidence.band,
        source_reports_used: analysis.citations.map((item) => ({ id: item.reportId, name: item.reportName, mode: item.source, result_set_count: 1 })),
      };
      return NextResponse.json({ insights, analysis, meta: { model: analysis.synthesis, generated_at: analysis.generatedAt, sources: analysis.citations, fallback: analysis.synthesis !== "ai", source_count: new Set(analysis.citations.map((item) => item.reportId)).size, result_set_count: analysis.citations.length } });
    }

    const legacyRows = body.data ?? [];
    const sources = body.sources ?? [];
    const sourceSets = sources.flatMap((source) => source.resultSets.map((set) => ({ source: source.name, ...set })));
    const validCitations = new Set(sources.flatMap((source) => source.resultSets.map((set) => set.citationId)));
    if (legacyRows.length) validCitations.add(`legacy:${body.report_name ?? body.kpi}:1`);
    if (!sourceSets.length && !legacyRows.length) return NextResponse.json({ error: "No evidence was available. No metrics or findings were generated.", diagnostics: ["Select a validated report or upload a supported file containing data."] }, { status: 422 });

    const { systemPrompt, apcsMetrics } = buildCompactInterpretationPrompt();
    const evidence = sourceSets.length ? sourceSets : [{ source: body.report_name ?? body.kpi, citationId: [...validCitations][0], columns: body.columns ?? [], rowCount: legacyRows.length, sampleRows: legacyRows.slice(0, 200) }];
    const result = await generateText({
      model: getModel("default"), temperature: 0.1,
      system: `${systemPrompt}\nUse only supplied evidence. Findings must precede recommendations. Every quantitative or major claim must cite one or more supplied citation IDs. Never invent a metric, source, comparison, or cause.`,
      prompt: `Analyze KPI ${body.kpi} for ${body.start_date} through ${body.end_date}. Evidence: ${JSON.stringify(evidence).slice(0, 120_000)}`,
      experimental_output: Output.object({ schema: BusinessInsightsSchema }),
    });
    const insights = validateOutput(result.experimental_output, validCitations);
    return NextResponse.json({ insights, meta: { model: getModelId("default"), generated_at: new Date().toISOString(), apcs: apcsMetrics, source_count: sources.length || 1, result_set_count: evidence.length, fallback: false } });
  } catch (error) {
    console.error("[v0] /api/kpi/interpret evidence analysis failed:", error);
    return NextResponse.json({ error: "Evidence analysis is temporarily unavailable. No fallback metrics were generated.", diagnostics: [error instanceof Error ? error.message : "Unknown analysis error"] }, { status: 503 });
  }
}
