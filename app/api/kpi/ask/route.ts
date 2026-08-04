/**
 * POST /api/kpi/ask
 *
 * A streaming KPI-intelligence chat endpoint. Accepts a user question plus
 * the AcaciaHealth KPI context string and returns a streamed text answer
 * grounded in the KPI data.
 *
 * Body:
 *   question   string  — the user's question
 *   context    string  — the askContext string from /api/kpi/intelligence
 *   kpi        string  — optional KPI name being asked about
 *   start_date string  — optional YYYY-MM-DD
 *   end_date   string  — optional YYYY-MM-DD
 */

import { NextRequest } from "next/server";
import { streamText } from "ai";
import { getModel } from "@/lib/ai/gateway";
import { buildCompactConversationalPrompt } from "@/lib/ai/insightAgentPrompt";
import { KpiAskBodySchema } from "@/lib/validation/apiSchemas";
import { edgeCheckRateLimit } from "@/lib/middleware/edgeRateLimiter";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const rateLimited = edgeCheckRateLimit(req, { limit: 15, window: 60, prefix: "kpi-ask" });
  if (rateLimited) return rateLimited;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const parsed = KpiAskBodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { question, context, kpi, start_date, end_date } = parsed.data;

  const { systemPrompt } = buildCompactConversationalPrompt();

  const dateContext =
    start_date && end_date
      ? `\nDate range filter: ${start_date} to ${end_date}. Scope your answer to this period.`
      : "";

  const kpiContext = kpi ? `\nFocus KPI: ${kpi}` : "";

  const userMessage = `KPI Intelligence Context:
${context}${dateContext}${kpiContext}

User question: ${question}`;

  const result = streamText({
    model: getModel("default"),
    system: systemPrompt,
    prompt: userMessage,
    temperature: 0.25,
    maxOutputTokens: 512,
  });

  return result.toTextStreamResponse();
}
