import { describe, expect, it } from "vitest";
import { getAnalyticsError, isAnalyticsResponse } from "@/lib/contracts/analytics";

const validResponse = {
  intent: { type: "SUMMARY" },
  response: { type: "SUMMARY_TEXT", text: "Summary" },
  metadata: { source: "in_memory_dataset", confidence: 0.8 },
};

describe("analytics response contract", () => {
  it("accepts a complete analytics response", () => {
    expect(isAnalyticsResponse(validResponse)).toBe(true);
  });

  it("rejects a successful HTTP payload without a response object", () => {
    expect(isAnalyticsResponse({ error: "upstream failure" })).toBe(false);
    expect(isAnalyticsResponse({ intent: { type: "SUMMARY" }, metadata: validResponse.metadata })).toBe(false);
  });

  it("rejects unsupported response and intent types", () => {
    expect(isAnalyticsResponse({ ...validResponse, response: { type: "UNKNOWN" } })).toBe(false);
    expect(isAnalyticsResponse({ ...validResponse, intent: { type: "UNKNOWN" } })).toBe(false);
  });

  it("rejects malformed nested data before it reaches a renderer", () => {
    expect(isAnalyticsResponse({ ...validResponse, response: { type: "TABLE", data: "not-an-array" } })).toBe(false);
    expect(isAnalyticsResponse({ ...validResponse, transformation: { steps: ["valid", 42] } })).toBe(false);
    expect(isAnalyticsResponse({ ...validResponse, response: { type: "CHART", presentation: { chartType: "scatter" } } })).toBe(false);
  });

  it("extracts safe API errors with a fallback", () => {
    expect(getAnalyticsError({ error: "Rate limit exceeded" })).toBe("Rate limit exceeded");
    expect(getAnalyticsError(null)).toBe("Request failed");
  });
});
