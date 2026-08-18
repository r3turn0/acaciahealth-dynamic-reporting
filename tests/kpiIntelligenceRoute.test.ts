import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/kpi/intelligence/route";

describe("KPI intelligence metadata route", () => {
  it("does not present static registry values as current KPI evidence", async () => {
    const response = await GET(new Request("http://localhost/api/kpi/intelligence") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kpiCards).toEqual([]);
    expect(body.recommendations).toEqual([]);
    expect(body.powerBiSchema.factKPI).toEqual([]);
    expect(body.invoicePeriod).toBe("Evidence date range required");
    expect(body.askContext).toContain("No current KPI values or recommendations");
    expect(body.domainSummaries.every((domain: { coverage: number }) => domain.coverage === 0)).toBe(true);
  });
});
