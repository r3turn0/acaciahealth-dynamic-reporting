/**
 * POST /api/analytics/query
 * Post-Query Analytics Engine.
 * Operates on an already-retrieved in-memory dataset to answer follow-up
 * analytical questions without generating new SQL queries.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel, isAiConfigured } from "@/lib/ai/gateway";
import {
  isAnalyticsResponse,
  type AnalyticsDataset,
  type AnalyticsRequest,
  type AnalyticsResponse,
} from "@/lib/contracts/analytics";

export type { AnalyticsDataset, AnalyticsRequest, AnalyticsResponse } from "@/lib/contracts/analytics";

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Post-Query Analytics Engine that operates on an already retrieved dataset.

CORE RESPONSIBILITY:
- You DO NOT generate SQL queries.
- You ONLY analyze the provided dataset, answer follow-up questions, and perform in-memory transformations (grouping, filtering, ranking, summarizing).

ALLOWED OPERATIONS:
- FILTER (subset rows)
- GROUP_BY (aggregate values)
- SORT (ascending / descending)
- TOP_N (limit results)
- SUMMARY (textual synthesis)
- COUNT / SUM / AVG (only if data supports it)

YOU MUST NOT:
- Call external systems
- Generate SQL or API queries
- Add fields not present in the dataset

INTENT TYPES (classify into ONE):
FILTER | GROUP_BY | SUMMARY | TOP_N | SORT | CLARIFICATION

RESPONSE TYPES (STRICT — only return one of):
TABLE | SUMMARY_TEXT | CHART | KPI | CLARIFICATION

TRANSFORMATION RULES:
- Only operate on provided dataset columns
- Preserve data integrity
- Apply transformations step-by-step
- Default row limit: 100

OUTPUT FORMAT:
You must return ONLY valid JSON matching this schema exactly:
{
  "intent": { "type": "string", "operation": "string" },
  "transformation": { "steps": [] },
  "response": {
    "type": "TABLE | SUMMARY_TEXT | CHART | KPI | CLARIFICATION",
    "data": [],
    "columns": [],
    "text": "string (for SUMMARY_TEXT only)",
    "presentation": {
      "chartType": "bar | line | pie | none",
      "xAxis": "string",
      "yAxis": "string",
      "groupBy": [],
      "limit": 100
    }
  },
  "clarification": { "question": "string", "options": [] },
  "metadata": { "source": "in_memory_dataset", "confidence": 0.0 }
}

No free-form text outside JSON. No markdown code fences.`;

// ── In-memory fallback engine ─────────────────────────────────────────────────
// Used when AI is not configured.

function runFallback(dataset: AnalyticsDataset, question: string): AnalyticsResponse {
  const q = question.toLowerCase();
  const { columns, rows } = dataset;

  // Detect numeric columns
  const numCols = columns.filter((_, ci) =>
    rows.some((r) => typeof r[ci] === "number" && r[ci] !== null)
  );
  const strCols = columns.filter((c) => !numCols.includes(c));

  // TOP N pattern
  const topMatch = q.match(/top\s+(\d+)/);
  const topN = topMatch ? parseInt(topMatch[1], 10) : 5;

  if (q.includes("top") || q.includes("highest") || q.includes("most")) {
    const groupCol = strCols[0];
    const valueCol = numCols[0];
    if (groupCol && valueCol) {
      const ci = columns.indexOf(groupCol);
      const vi = columns.indexOf(valueCol);
      const agg: Record<string, number> = {};
      for (const row of rows) {
        const k = String(row[ci] ?? "Unknown");
        agg[k] = (agg[k] ?? 0) + (Number(row[vi]) || 0);
      }
      const sorted = Object.entries(agg)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      const data = sorted.map(([k, v]) => ({ [groupCol]: k, [valueCol]: v }));
      return {
        intent: { type: "TOP_N", operation: "RANK" },
        transformation: {
          steps: [`GROUP_BY ${groupCol} SUM ${valueCol}`, "SORT DESC", `LIMIT ${topN}`],
        },
        response: {
          type: "CHART",
          data,
          columns: [groupCol, valueCol],
          presentation: {
            chartType: "bar",
            xAxis: groupCol,
            yAxis: valueCol,
            limit: topN,
          },
        },
        metadata: { source: "in_memory_dataset", confidence: 0.75, fallback: true },
      };
    }
  }

  // SUMMARY fallback
  const totals: Record<string, number> = {};
  for (const col of numCols) {
    const ci = columns.indexOf(col);
    totals[col] = rows.reduce((sum, r) => sum + (Number(r[ci]) || 0), 0);
  }
  const summaryParts = numCols
    .slice(0, 3)
    .map((c) => `${c.replace(/_/g, " ")}: ${totals[c].toLocaleString()}`);
  return {
    intent: { type: "SUMMARY", operation: "SUMMARIZE" },
    transformation: { steps: ["AGGREGATE all numeric columns"] },
    response: {
      type: "SUMMARY_TEXT",
      text: `Dataset summary (${rows.length} rows): ${summaryParts.join(", ")}.`,
    },
    metadata: { source: "in_memory_dataset", confidence: 0.6, fallback: true },
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: AnalyticsRequest = await req.json();
    const { dataset, question, history = [] } = body;

    if (!dataset?.columns?.length || !dataset?.rows) {
      return NextResponse.json({ error: "dataset is required" }, { status: 400 });
    }
    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    // Cap dataset rows sent to AI to avoid token blowout
    const MAX_ROWS_AI = 200;
    const cappedDataset: AnalyticsDataset = {
      columns: dataset.columns,
      rows: dataset.rows.slice(0, MAX_ROWS_AI),
    };

    if (!isAiConfigured()) {
      const fallback = runFallback(cappedDataset, question);
      return NextResponse.json(fallback);
    }

    // Build conversation messages
    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...history.slice(-6), // keep last 6 turns for context
      {
        role: "user",
        content: [
          `Dataset (${cappedDataset.rows.length} rows${dataset.rows.length > MAX_ROWS_AI ? ` of ${dataset.rows.length} total, capped for analysis` : ""}):\n${JSON.stringify(cappedDataset)}`,
          `\nQuestion: ${question}`,
        ].join(""),
      },
    ];

    let text: string;
    try {
      const result = await generateText({
        model: getModel("default"),
        system: SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 1024,
        temperature: 0.1,
      });
      text = result.text;
    } catch {
      // Analytics remains available when the AI provider is unavailable,
      // misconfigured, or rate limited.
      return NextResponse.json(runFallback(cappedDataset, question));
    }

    // Strip any accidental markdown fences
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Preserve useful model prose when the model returns non-JSON content.
      return NextResponse.json({
        intent: { type: "SUMMARY" },
        response: { type: "SUMMARY_TEXT", text: text.slice(0, 1000) },
        metadata: { source: "in_memory_dataset", confidence: 0.4 },
      } satisfies AnalyticsResponse);
    }

    // Valid JSON is not necessarily a valid analytics response. AI providers can
    // return error envelopes or incomplete objects with HTTP 200, so fall back to
    // the deterministic engine instead of forwarding an unsafe shape to the UI.
    if (!isAnalyticsResponse(parsed)) {
      return NextResponse.json(runFallback(cappedDataset, question));
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[v0] /api/analytics/query error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
