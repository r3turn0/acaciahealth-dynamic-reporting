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

  const systemPrompt = `You are a senior healthcare analytics consultant for AcaciaHealth, an operator of home health and hospice services.
You have access to the current KPI intelligence snapshot for the active invoice period.
Answer questions directly and concisely using the KPI data provided. Be specific with numbers from the context.

Rules:
- Answer in 2–5 sentences unless the question requires a list or table.
- Use healthcare / home health domain language (census, SOC, discharge, LUPA, PDGM, branch, etc.).
- Ground every claim in the KPI context — never invent figures not present in it.
- If a question cannot be answered from the context, say so clearly and suggest what data would help.
- Format lists with short bullet lines when presenting multiple items.
- Do not repeat the full context back — only reference the relevant parts.`;

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
