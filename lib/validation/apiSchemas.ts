/**
 * lib/validation/apiSchemas.ts
 *
 * Shared Zod schemas for all API route request bodies.
 *
 * Usage in a route:
 *   import { RunSqlBodySchema } from "@/lib/validation/apiSchemas";
 *   const parsed = RunSqlBodySchema.safeParse(await req.json());
 *   if (!parsed.success) {
 *     return NextResponse.json(
 *       { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
 *       { status: 400 }
 *     );
 *   }
 *   const { sql, start_date, end_date } = parsed.data;
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/** ISO date YYYY-MM-DD */
const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date YYYY-MM-DD");

/** Non-empty string trimmed, max 10,000 chars (prevents SQL prompt stuffing) */
const SafeString = (maxLen = 10_000) =>
  z.string().trim().min(1).max(maxLen);

/** Non-empty string trimmed, max 200 chars (labels / names) */
const ShortString = z.string().trim().min(1).max(200);

const QUERY_SOURCES = [
  "natural_language",
  "sql_editor",
  "dashboard_filter",
  "report_builder",
  "kpi_explorer",
  "ai_copilot",
  "ad_hoc",
  "pipeline",
  "scheduled",
] as const;

// ── /api/run-sql ──────────────────────────────────────────────────────────────

export const RunSqlBodySchema = z.object({
  /** Raw SQL — required */
  sql: SafeString(50_000),
  /** ISO date range (required by the gateway) */
  start_date: ISODate,
  end_date: ISODate,
  /** Optional metadata */
  report_name: z.string().trim().max(200).optional(),
  report_id: z.string().trim().max(100).optional(),
  original_prompt: z.string().trim().max(2_000).optional(),
});

export type RunSqlBody = z.infer<typeof RunSqlBodySchema>;

// ── /api/gateway/query ────────────────────────────────────────────────────────

export const GatewayQueryBodySchema = z.object({
  query: z.string().trim().max(10_000).optional(),
  rawSql: SafeString(50_000).optional(),
  source: z.enum(QUERY_SOURCES),
  startDate: ISODate,
  endDate: ISODate,
  branchCode: z.string().trim().max(50).optional(),
  role: z.enum(["admin", "analyst", "viewer"]).optional().default("analyst"),
  planOnly: z.boolean().optional().default(false),
  reportName: z.string().trim().max(200).optional(),
  requestId: z.string().trim().max(100).optional(),
}).refine(
  (d) => d.query || d.rawSql,
  { message: "query or rawSql is required", path: ["query"] }
).refine(
  (d) => d.source !== "sql_editor" || !!d.rawSql,
  { message: "source=sql_editor requires rawSql", path: ["rawSql"] }
);

export type GatewayQueryBody = z.infer<typeof GatewayQueryBodySchema>;

// ── /api/generate-query ───────────────────────────────────────────────────────

export const GenerateQueryBodySchema = z.object({
  prompt: SafeString(2_000),
  start_date: ISODate,
  end_date: ISODate,
  branch_code: z.string().trim().max(50).optional(),
  role: z.enum(["admin", "analyst", "viewer"]).optional(),
});

export type GenerateQueryBody = z.infer<typeof GenerateQueryBodySchema>;

// ── /api/kpi/ask ──────────────────────────────────────────────────────────────

export const KpiAskBodySchema = z.object({
  question: SafeString(2_000),
  context: z.string().trim().max(20_000).optional().default(""),
  kpi: z.string().trim().max(100).optional().default(""),
  start_date: ISODate.optional(),
  end_date: ISODate.optional(),
});

export type KpiAskBody = z.infer<typeof KpiAskBodySchema>;

// ── /api/kpi/interpret ────────────────────────────────────────────────────────

export const KpiInterpretBodySchema = z.object({
  kpi: ShortString,
  value: z.number().or(z.string()),
  context: z.string().trim().max(20_000).optional(),
  start_date: ISODate.optional(),
  end_date: ISODate.optional(),
});

export type KpiInterpretBody = z.infer<typeof KpiInterpretBodySchema>;

// ── /api/report/run ───────────────────────────────────────────────────────────

export const ReportRunBodySchema = z.object({
  report_name: ShortString,
  prompt: SafeString(2_000),
  filters: z
    .object({
      date_range: z
        .object({
          start_date: ISODate,
          end_date: ISODate,
        })
        .optional(),
      branch_code: z.string().trim().max(50).optional(),
    })
    .optional(),
  report_id: z.string().trim().max(100).optional(),
});

export type ReportRunBody = z.infer<typeof ReportRunBodySchema>;
