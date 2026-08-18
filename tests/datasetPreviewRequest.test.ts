import { describe, expect, it } from "vitest";
import { RunSqlBodySchema } from "@/lib/validation/apiSchemas";
import {
  buildDatasetPreviewRequest,
  formatRequestError,
  getDatasetPreviewDateRange,
} from "@/lib/dataset/previewRequest";

describe("dataset preview request", () => {
  const now = new Date("2026-08-17T18:30:00.000Z");

  it("builds a bounded request that satisfies the run-sql contract", () => {
    const request = buildDatasetPreviewRequest(
      "SELECT TOP (100) CLIENT_ID FROM dbo.CLIENTS",
      "Client census",
      now,
    );

    expect(request).toEqual({
      sql: "SELECT TOP (100) CLIENT_ID FROM dbo.CLIENTS",
      report_name: "Client census preview",
      start_date: "2026-05-19",
      end_date: "2026-08-17",
    });
    expect(RunSqlBodySchema.safeParse(request).success).toBe(true);
  });

  it("returns ordered ISO dates spanning exactly 90 days", () => {
    const range = getDatasetPreviewDateRange(now);
    expect(range.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${range.end_date}T00:00:00.000Z`).getTime() - new Date(`${range.start_date}T00:00:00.000Z`).getTime()).toBe(90 * 86_400_000);
  });

  it("surfaces the first field-specific validation detail", () => {
    expect(formatRequestError("Invalid request body", {
      start_date: ["Must be ISO date YYYY-MM-DD"],
    })).toBe("Invalid request body: start_date Must be ISO date YYYY-MM-DD");
    expect(formatRequestError("Query failed security validation", [
      "Query must reference @StartDate parameter",
    ])).toBe("Query failed security validation: Query must reference @StartDate parameter");
    expect(formatRequestError("Execution failed")).toBe("Execution failed");
  });
});
