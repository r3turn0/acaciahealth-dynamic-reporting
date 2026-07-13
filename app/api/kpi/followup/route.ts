/**
 * POST /api/kpi/followup
 *
 * Accepts a follow-up question and the existing BusinessInsights context,
 * returns a plain-text answer grounded in the insights already generated.
 *
 * Body:
 *   question   string            — the user's follow-up question
 *   insights   BusinessInsights  — the already-generated insights object
 *   report_name string           — name of the report being discussed
 *   kpi         string           — KPI type for domain context
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel, getModelId } from "@/lib/ai/gateway";
import type { BusinessInsights } from "@/app/api/kpi/interpret/route";

export async function POST(req: NextRequest) {
  // Parse the body once, up front, so the request stream is never read twice
  // (reading req again in the catch block below would throw and mask the real
  // error, producing a 500 instead of the graceful fallback).
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
    question = typeof body.question === "string" ? body.question : "";

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    if (!insights) {
      return NextResponse.json({ error: "insights context is required" }, { status: 400 });
    }

    const systemPrompt = `You are a senior healthcare analytics consultant for AcaciaHealth, specialising in home health and hospice operations.
You have already generated a BusinessInsights report for the user. They are now asking a follow-up question about that report.

Rules:
- Answer concisely and directly — 2–5 sentences unless the question requires more.
- Ground every answer in the insights data provided. Do not invent numbers not present in the context.
- Use healthcare / home health domain language where relevant.
- If you cannot answer from the provided context, say so clearly and suggest what additional data would help.
- Do not repeat the full insights back — only reference the relevant parts.`;

    const dateContext =
      start_date && end_date
        ? `\nDate range in focus: ${start_date} to ${end_date}. Scope your answer to this period; if the insights above cover a different period, note that explicitly.`
        : "";

    const userMessage = `Report: "${report_name}" (KPI: ${kpi})${dateContext}

Previously generated insights:
${JSON.stringify(insights, null, 2)}

Follow-up question: ${question}`;

    const result = await generateText({
      model: getModel("default"),
      system: systemPrompt,
      prompt: userMessage,
      temperature: 0.3,
      maxOutputTokens: 512,
    });

    return NextResponse.json({
      answer: result.text,
      meta: {
        model: getModelId("default"),
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[v0] /api/kpi/followup error:", err);

    // Graceful fallback — `question` was captured above, so we never re-read
    // the (already-consumed) request body here.
    const q = question ? ` Your question was: "${question}".` : "";
    return NextResponse.json({
      answer: `I'm unable to generate an AI answer right now (the AI service is unavailable or not configured).${q} You can still review the generated insights above, or configure the AI Gateway and try again.`,
      meta: {
        model: "demo-fallback",
        generated_at: new Date().toISOString(),
        fallback: true,
      },
    });
  }
}
