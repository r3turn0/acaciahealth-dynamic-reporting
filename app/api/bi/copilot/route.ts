/**
 * POST /api/bi/copilot
 *
 * Natural-language → KPI report config. Given a dataset's fields and a prompt
 * like "Show me total revenue by region last 30 days", returns a structured
 * { metrics, dimensions, filters, chart } config plus a short explanation.
 *
 * Falls back to a deterministic keyword heuristic when AI is not configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId } from "@/lib/ai/gateway";
import type { DatasetField, Filter, Metric } from "@/lib/bi/types";

const ConfigSchema = z.object({
  metrics: z
    .array(
      z.object({
        agg: z.enum(["sum", "avg", "count", "min", "max"]),
        field: z.string().nullable(),
      })
    )
    .describe("Aggregations to compute. Use count with field null for row counts."),
  dimensions: z.array(z.string()).describe("Field names to group by (0-2)."),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["equals", "not_equals", "contains", "gt", "lt", "gte", "lte", "last_n_days"]),
        value: z.union([z.string(), z.number()]),
      })
    )
    .describe("Filters to apply. Use last_n_days with a number for recent date windows."),
  chart: z.enum(["bar", "line", "pie", "table"]),
  title: z.string().describe("A concise title for the proposed visualization."),
  action: z.enum(["create_visualization", "update_visualization", "add_filter", "forecast", "explain"]).default("create_visualization"),
  explanation: z.string().describe("One sentence explaining the chosen config and why it is appropriate."),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt: string = body?.prompt ?? "";
  const fields: DatasetField[] = Array.isArray(body?.fields) ? body.fields : [];

  if (!prompt.trim() || fields.length === 0) {
    return NextResponse.json({ error: "prompt and fields are required" }, { status: 400 });
  }

  try {
    const system = `You translate a natural-language analytics request into a KPI report config.
You are given the available dataset fields (name + type). Rules:
- Only reference field names that exist in the provided list. Never invent fields.
- Numeric fields are candidates for metrics; string fields for dimensions; date fields for trends/date filters.
- "total/sum" -> sum, "average/avg" -> avg, "count/number of" -> count (field null).
- Phrases like "last 30 days" -> a last_n_days filter of 30 on a date field.
- Choose the best chart: bar (comparison), line (time trend), pie (share), table (raw).
- Return a proposed action only. The user must confirm before it is applied or saved.
- You receive schema metadata only. Do not request, infer, or expose patient-level identifiers or source rows.`;

    const user = `Available fields:
${fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}

Request: "${prompt}"

Return a config that satisfies the request.`;

    const result = await generateText({
      model: getModel("default"),
      system,
      prompt: user,
      experimental_output: Output.object({ schema: ConfigSchema }),
      temperature: 0.1,
    });

    const config = result.experimental_output;
    // Guard against hallucinated field names.
    const valid = new Set(fields.map((f) => f.name));
    config.metrics = config.metrics.filter((m) => !m.field || valid.has(m.field));
    config.dimensions = config.dimensions.filter((d) => valid.has(d));
    config.filters = config.filters.filter((f) => valid.has(f.field));

    return NextResponse.json({
      config,
      meta: { model: getModelId("default"), fallback: false },
    });
  } catch (err) {
    console.error("[v0] /api/bi/copilot error, using heuristic:", err);
    const config = heuristicConfig(prompt, fields);
    return NextResponse.json({ config, meta: { model: "heuristic", fallback: true } });
  }
}

// ── Deterministic fallback ────────────────────────────────────────────────────

function heuristicConfig(prompt: string, fields: DatasetField[]) {
  const p = prompt.toLowerCase();
  const numbers = fields.filter((f) => f.type === "number");
  const strings = fields.filter((f) => f.type === "string");
  const dates = fields.filter((f) => f.type === "date");

  // Pick a metric field mentioned in the prompt, else the first numeric field.
  const metricField =
    numbers.find((f) => p.includes(f.name.toLowerCase()))?.name ?? numbers[0]?.name ?? null;

  let agg: Metric["agg"] = "sum";
  if (/\bavg|average|mean\b/.test(p)) agg = "avg";
  else if (/\bcount|number of|how many\b/.test(p)) agg = "count";
  else if (/\bmax|highest|peak\b/.test(p)) agg = "max";
  else if (/\bmin|lowest\b/.test(p)) agg = "min";

  const metrics: Metric[] =
    agg === "count" || !metricField
      ? [{ agg: "count", field: null }]
      : [{ agg, field: metricField }];

  // Dimension: a field named after "by X", else the first string field.
  const byMatch = p.match(/by\s+([a-z0-9_ ]+)/);
  let dimension: string | undefined;
  if (byMatch) {
    const target = byMatch[1].trim();
    dimension =
      strings.find((f) => target.includes(f.name.toLowerCase()))?.name ??
      dates.find((f) => target.includes(f.name.toLowerCase()))?.name;
  }
  if (!dimension) dimension = strings[0]?.name;

  // Date filter: "last N days".
  const filters: Filter[] = [];
  const daysMatch = p.match(/last\s+(\d+)\s+days?/);
  if (daysMatch && dates[0]) {
    filters.push({ field: dates[0].name, op: "last_n_days", value: Number(daysMatch[1]) });
  }

  const chart = /trend|over time|line/.test(p)
    ? "line"
    : /share|proportion|pie|percent/.test(p)
    ? "pie"
    : "bar";

  return {
    metrics,
    dimensions: dimension ? [dimension] : [],
    filters,
    chart,
    title: `${agg === "count" ? "Count" : `${agg} ${metricField ?? "metric"}`}${dimension ? ` by ${dimension}` : ""}`,
    action: /forecast|project|predict/.test(p) ? "forecast" : filters.length ? "add_filter" : "create_visualization",
    explanation: `Heuristic: ${agg}${metricField ? ` of ${metricField}` : ""}${
      dimension ? ` by ${dimension}` : ""
    }${filters.length ? " over recent window" : ""}.`,
  };
}
