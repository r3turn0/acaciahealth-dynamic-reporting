import { describe, expect, it } from "vitest";
import {
  normalizeIntelligenceRequest,
  requestSimilarity,
  resolveQueryIntelligence,
  type IntelligenceCandidate,
} from "@/lib/services/queryIntelligence";

const SQL = `SELECT COUNT(epi_id) AS admissions
FROM CLIENT_EPISODES_ALL
WHERE epi_SocDate BETWEEN @StartDate AND @EndDate`;

function candidate(overrides: Partial<IntelligenceCandidate>): IntelligenceCandidate {
  return {
    id: "candidate",
    source: "saved_report",
    name: "Weekly Admissions",
    description: "Governed admissions by week",
    sql: SQL,
    tags: ["admissions", "weekly"],
    version: 1,
    successRate: 1,
    avgExecutionMs: 100,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("query intelligence", () => {
  it("normalizes healthcare aliases to canonical terms", () => {
    expect(normalizeIntelligenceRequest("Show average daily census WTD"))
      .toBe("show adc wtd");
    expect(normalizeIntelligenceRequest("payer mix and case load"))
      .toBe("payer_mix and caseload");
  });

  it("scores equivalent healthcare terminology highly", () => {
    expect(requestSimilarity("average daily census", "ADC by branch")).toBeGreaterThan(0.8);
  });

  it("prioritizes a published saved report over equivalent memory", async () => {
    const result = await resolveQueryIntelligence("weekly admissions", {
      candidates: [
        candidate({ id: "memory", source: "query_memory" }),
        candidate({ id: "report", source: "saved_report" }),
      ],
    });
    expect(result.reusable).toBe(true);
    expect(result.source).toBe("saved_report");
    expect(result.candidate?.id).toBe("report");
  });

  it("falls back to generation below the quality threshold", async () => {
    const result = await resolveQueryIntelligence("accounts receivable aging", {
      candidates: [candidate({ name: "Weekly Admissions" })],
      threshold: 0.8,
    });
    expect(result.source).toBe("generated");
    expect(result.sql).toBeNull();
  });

  it("never reuses a matching candidate whose SQL fails governance", async () => {
    const result = await resolveQueryIntelligence("weekly admissions", {
      candidates: [candidate({ sql: "DELETE FROM CLIENT_EPISODES_ALL" })],
    });
    expect(result.reusable).toBe(false);
    expect(result.rationale.join(" ")).toMatch(/DELETE|read-only/i);
  });

  it("recognizes datasets but does not execute them as SQL", async () => {
    const result = await resolveQueryIntelligence("weekly admissions", {
      candidates: [candidate({ source: "dataset", sql: null })],
    });
    expect(result.source).toBe("generated");
    expect(result.candidate?.source).toBe("dataset");
  });
});
