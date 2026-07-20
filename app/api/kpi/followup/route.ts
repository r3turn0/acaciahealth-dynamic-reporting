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

export const runtime = "edge";

export async function POST(req: NextRequest) {
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
    question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return new Response("question is required", { status: 400 });
    }
    if (!insights) {
      return new Response("insights context is required", { status: 400 });
    }

    const systemPrompt = `You are a senior healthcare analytics consultant for AcaciaHealth, specialising in home health and hospice operations.
You have already generated a BusinessInsights report for the user. They are now asking a follow-up question about that report.

Rules:
- Answer concisely and directly — 2–5 sentences unless the question requires a list.
- Ground every answer in the insights data provided. Do not invent numbers not present in the context.
- Use healthcare / home health domain language where relevant.
- If you cannot answer from the provided context, say so clearly and suggest what additional data would help.
- Do not repeat the full insights back — only reference the relevant parts.
- Format lists as short bullet lines when presenting multiple items.`;

    const dateContext =
      start_date && end_date
        ? `\nDate range in focus: ${start_date} to ${end_date}. Scope your answer to this period; if the insights above cover a different period, note that explicitly.`
        : "";

    const userMessage = `Report: "${report_name}" (KPI: ${kpi})${dateContext}

Previously generated insights:
${JSON.stringify(insights, null, 2)}

Follow-up question: ${question}`;

    const result = streamText({
      model: getModel("default"),
      system: systemPrompt,
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
