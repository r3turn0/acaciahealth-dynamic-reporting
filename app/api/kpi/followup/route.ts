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
  try {
    const body = await req.json();
    const { question, insights, report_name, kpi } = body as {
      question: string;
      insights: BusinessInsights;
      report_name: string;
      kpi: string;
    };

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

    const userMessage = `Report: "${report_name}" (KPI: ${kpi})

Previously generated insights:
${JSON.stringify(insights, null, 2)}

Follow-up question: ${question}`;

    const result = await generateText({
      model: getModel("default"),
      system: systemPrompt,
      prompt: userMessage,
      temperature: 0.3,
      maxTokens: 512,
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

    // Graceful fallback
    const { question } = await req.clone().json().catch(() => ({ question: "" }));
    return NextResponse.json({
      answer: `I'm unable to process your follow-up question right now (AI service unavailable). Your question was: "${question}". Please ensure AI Gateway is configured and try again.`,
      meta: {
        model: "demo-fallback",
        generated_at: new Date().toISOString(),
        fallback: true,
      },
    });
  }
}
