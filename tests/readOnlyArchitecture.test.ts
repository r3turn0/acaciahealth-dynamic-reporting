import { describe, expect, it } from "vitest";
import { buildCatalog, getCatalogIndexHealth, searchCatalog } from "@/lib/discovery/catalog";
import { validateDataset } from "@/lib/validation/datasetValidation";
import { auditReports } from "@/lib/services/reportAuditService";
import type { SavedReport } from "@/lib/services/reportService";
import { createExportEnvelope, serialiseCell, toCSV } from "@/lib/utils/download";

function report(overrides: Partial<SavedReport>): SavedReport {
  return {
    id: "report-1",
    name: "Admissions",
    description: "Admissions by branch",
    prompt: "Show admissions by branch",
    sql: "SELECT branch, COUNT(*) AS admissions FROM CLIENT_EPISODES_ALL GROUP BY branch",
    kpi: "Admissions",
    tags: ["admissions", "branch"],
    visibility: "public",
    status: "published",
    created_by: "system",
    created_date: "2026-01-01T00:00:00.000Z",
    last_run_date: null,
    run_count: 5,
    last_row_count: null,
    version: 1,
    version_history: [],
    ...overrides,
  };
}

describe("read-only semantic architecture", () => {
  it("rehydrates a governed catalog containing physical and virtual assets", async () => {
    const assets = await buildCatalog();
    const health = await getCatalogIndexHealth();
    expect(assets.some((asset) => asset.kind === "physical" && asset.type === "table")).toBe(true);
    expect(assets.some((asset) => asset.kind === "virtual" && asset.type === "dataset")).toBe(true);
    expect(assets.filter((asset) => asset.kind === "virtual").every((asset) => asset.virtualNotice?.includes("never written"))).toBe(true);
    expect(health.authoritative).toBe(false);
    expect(health.assetCount).toBe(assets.length);
  });

  it("expands business synonyms and ranks certified KPI assets", async () => {
    const results = await searchCatalog("patient census", ["kpi", "dataset"], 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => /census/i.test(`${result.name} ${result.description}`))).toBe(true);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("fails datasets with no fields or relationship path", () => {
    const validation = validateDataset({
      datasetId: "broken",
      tables: [{ name: "A", columns: [] }, { name: "B", columns: [] }],
      relationshipCount: 0,
      relationships: [],
    });
    expect(validation.status).toBe("Failed");
    expect(validation.authoritative).toBe(false);
    expect(validation.checks.some((check) => check.id === "columns" && check.status === "fail")).toBe(true);
    expect(validation.checks.some((check) => check.id === "orphan-tables" && check.status === "fail")).toBe(true);
  });

  it("groups normalized SQL duplicates without discarding versions", () => {
    const groups = auditReports([
      report({ id: "a", name: "Admissions canonical", run_count: 10 }),
      report({ id: "b", name: "Admissions variant", sql: "-- note\n SELECT branch, COUNT(*) AS admissions FROM CLIENT_EPISODES_ALL GROUP BY branch;", version: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("exact");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].canonicalReportId).toBe("a");
  });

  it("creates governed JSON envelopes and RFC-compatible CSV", () => {
    const rows = [{ branch: "ATL", value: 12, note: "line 1\nline 2" }];
    const envelope = createExportEnvelope(rows, "Admissions", { governance: "read-only", lineage: ["MSSQL", "CLIENT_EPISODES_ALL"] });
    expect(envelope.asset.authoritative).toBe(false);
    expect(envelope.asset.virtual).toBe(true);
    expect(envelope.rowCount).toBe(1);
    expect(envelope.columns).toEqual(["branch", "value", "note"]);
    expect(toCSV(rows)).toContain('"line 1\nline 2"');
    expect(serialiseCell(12)).toBe("12");
  });
});
