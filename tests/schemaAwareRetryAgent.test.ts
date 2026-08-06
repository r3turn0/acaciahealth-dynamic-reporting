import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, recordQueryAttemptMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  recordQueryAttemptMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@/lib/ai/gateway", () => ({
  getModel: () => "test-model",
  isAiConfigured: () => true,
}));
vi.mock("@/lib/agents/schemaAgent", () => ({
  inferQueryContext: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai/insightAgentPrompt", () => ({
  buildCompactCorrectionPrompt: () => ({
    systemPrompt: "Correct the query",
    apcsMetrics: { compressed: false, originalTokens: 0, compactedTokens: 0, reductionPct: 0, layersApplied: [] },
  }),
}));
vi.mock("@/lib/services/queryHistoryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/queryHistoryStore")>();
  return {
    ...actual,
    getAttemptsForRequest: vi.fn().mockResolvedValue([]),
    getSimilarHistoricalRepairs: vi.fn().mockResolvedValue([]),
    recordQueryAttempt: recordQueryAttemptMock,
    upsertLearnedMapping: vi.fn().mockResolvedValue(undefined),
    learnFromSuccess: vi.fn().mockResolvedValue(undefined),
    learnFromFailure: vi.fn().mockResolvedValue(undefined),
    suggestMappingsForError: vi.fn().mockResolvedValue([]),
    getLearnedMappings: vi.fn().mockResolvedValue([]),
  };
});

import {
  buildProgressiveRemediationStrategy,
  retryWithSchemaIntelligence,
} from "@/lib/agents/SchemaAwareRetryAgent";

const originalSql = "SELECT TOP 10000 epi.epi_id FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK) WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate";
const alternateSql = "SELECT TOP 10000 b.branch_code FROM BRANCHES b WITH (NOLOCK) WHERE b.branch_code IS NOT NULL AND @StartDate <= @EndDate";
const successfulSql = "SELECT TOP 10000 epi.epi_branchcode FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK) WHERE epi.epi_SocDate >= @StartDate AND epi.epi_SocDate <= @EndDate";

function aiResponse(sql: string, explanation: string) {
  return { text: JSON.stringify({ sql, explanation, confidence: 0.9, changed_element: "filter" }) };
}

describe("SchemaAwareRetryAgent", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    recordQueryAttemptMock.mockClear();
  });

  it("uses a distinct remediation strategy at each bounded attempt", () => {
    const strategies = [1, 2, 3].map((attempt) =>
      buildProgressiveRemediationStrategy("JOIN_FAILURE", attempt, "join failed", [])
    );
    expect(new Set(strategies).size).toBe(3);
  });

  it("continues after a duplicate, feeds back runtime errors, and returns only verified SQL", async () => {
    generateTextMock
      .mockResolvedValueOnce(aiResponse(originalSql, "unchanged"))
      .mockResolvedValueOnce(aiResponse(alternateSql, "alternate source"))
      .mockResolvedValueOnce(aiResponse(successfulSql, "simplified source"));

    const verifier = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "Invalid column name branch_code" })
      .mockResolvedValueOnce({ ok: true, execution: { rows: [{ branch: "A" }] } });

    const result = await retryWithSchemaIntelligence(
      {
        userRequest: "Admissions by branch",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        failedSql: originalSql,
        errorMessage: "Invalid object name",
      },
      verifier
    );

    expect(result.succeeded).toBe(true);
    expect(result.correctedSql).toBe(successfulSql);
    expect(result.verifiedExecution).toEqual({ rows: [{ branch: "A" }] });
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].duplicateRejected).toBe(true);
    expect(result.attempts[1].runtimeError).toContain("Invalid column");
    expect(verifier).toHaveBeenCalledTimes(2);

    const thirdPrompt = generateTextMock.mock.calls[2][0].prompt as string;
    expect(thirdPrompt).toContain(alternateSql);
    expect(thirdPrompt).toContain("Invalid column name branch_code");
  });

  it("never runtime-verifies unsafe generated SQL", async () => {
    generateTextMock.mockResolvedValue(aiResponse("DELETE FROM BRANCHES WHERE @StartDate <= @EndDate", "unsafe"));
    const verifier = vi.fn();

    const result = await retryWithSchemaIntelligence(
      {
        userRequest: "Delete branches",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        failedSql: originalSql,
        errorMessage: "Syntax error",
      },
      verifier
    );

    expect(result.succeeded).toBe(false);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.every((attempt) => attempt.validationErrors.length > 0)).toBe(true);
    expect(verifier).not.toHaveBeenCalled();
  });
});
