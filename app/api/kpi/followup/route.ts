/**
 * POST /api/kpi/followup
 *
 * Streaming follow-up chat for a KPI Interpreter session.
 * Accepts the user's question, the BusinessInsights context, report metadata,
 * and optional date range, then streams a plain-text answer.
 *
 * Body:
 *   question    string            — the user's follow-up question
 *   insights    BusinessInsights  — the already-generated insights object
 *   report_name string            — name of the report being discussed
 *   kpi         string            — KPI type for domain context
 *   start_date  string?           — optional YYYY-MM-DD
 *   end_date    string?           — optional YYYY-MM-DD
 */

import { NextRequest } from "next/server";
import { streamText } from "ai";
import { getModel } from "@/lib/ai/gateway";
import type { BusinessInsights } from "@/app/api/kpi/interpret/route";
import { buildCompactConversationalPrompt } from "@/lib/ai/insightAgentPrompt";
import { edgeCheckRateLimit } from "@/lib/middleware/edgeRateLimiter";
import type { AnalysisSource } from "@/lib/services/kpiAnalysisTypes";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const rateLimited = edgeCheckRateLimit(req, { limit: 20, window: 60, prefix: "kpi-followup" });
  if (rateLimited) return rateLimited;

  let question = "";

  try {
    const body = await req.json();
    const { insights, report_name, kpi, start_date, end_date } = body as {
      insights: BusinessInsights;
      report_name: string;
      kpi: string;
      start_date?: string;
      end_date?: string;
    };
    const sources = Array.isArray(body.sources) ? (body.sources as AnalysisSource[]).slice(0, 12) : [];
    const conversation = Array.isArray(body.conversation)
      ? body.conversation.slice(-10).filter((item: unknown): item is { role: "user" | "assistant"; content: string } => {
          if (!item || typeof item !== "object") return false;
          const message = item as Record<string, unknown>;
          return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.length <= 4_000;
        })
      : [];
    question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return new Response("question is required", { status: 400 });
    }
    if (!insights) {
      return new Response("insights context is required", { status: 400 });
    }

    const { systemPrompt } = buildCompactConversationalPrompt();

    const dateContext =
      start_date && end_date
        ? `\nDate range in focus: ${start_date} to ${end_date}. Scope your answer to this period; if the insights above cover a different period, note that explicitly.`
        : "";

    const citationIds = new Set([
      ...insights.evidence.flatMap((item) => item.citation_ids),
      ...insights.trends.flatMap((item) => item.citation_ids),
      ...sources.flatMap((source) => source.resultSets.map((set) => set.citationId)),
    ]);
    const evidenceContext = sources.flatMap((source) => source.resultSets.map((set) => ({
      source: source.name, citation_id: set.citationId, columns: set.columns, row_count: set.rowCount, sample_rows: set.sampleRows.slice(0, 50),
    })));
    const userMessage = `Report: "${report_name}" (KPI: ${kpi})${dateContext}

Previously generated cited insights:
${JSON.stringify(insights).slice(0, 40_000)}

Additional normalized evidence:
${JSON.stringify(evidenceContext).slice(0, 60_000)}

Conversation history:
${JSON.stringify(conversation).slice(0, 20_000)}

Allowed citation IDs: ${[...citationIds].join(", ")}
Follow-up question: ${question}`;

    const result = streamText({
      model: getModel("default"),
      system: `${systemPrompt}\nAnswer only from the supplied cited insights and normalized evidence. Preserve the conversation context. Put findings before recommendations. Cite supporting IDs in square brackets. If evidence does not support the answer, state that clearly and do not infer or fabricate.`,
      prompt: userMessage,
      temperature: 0.3,
      maxOutputTokens: 512,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("[v0] /api/kpi/followup error:", err);
    const q = question ? ` Your question was: "${question}".` : "";
    return new Response(
      `I'm unable to generate an AI answer right now (the AI service is unavailable or not configured).${q} You can still review the generated insights above, or configure the AI Gateway and try again.`,
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }
}
