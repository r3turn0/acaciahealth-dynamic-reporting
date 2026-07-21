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
import { buildConversationalSystemPrompt } from "@/lib/ai/insightAgentPrompt";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  let question = "";
  let context = "";
  let kpi = "";
  let start_date = "";
  let end_date = "";

  try {
    const body = await req.json();
    question  = typeof body.question  === "string" ? body.question.trim()  : "";
    context   = typeof body.context   === "string" ? body.context           : "";
    kpi       = typeof body.kpi       === "string" ? body.kpi               : "";
    start_date = typeof body.start_date === "string" ? body.start_date     : "";
    end_date   = typeof body.end_date   === "string" ? body.end_date       : "";
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  if (!question) {
    return new Response("question is required", { status: 400 });
  }

  const systemPrompt = buildConversationalSystemPrompt();

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
