import { describe, expect, it } from "vitest";
import {
  catalogTableMatches,
  resolveCatalogNavigation,
  type CatalogNavigationAsset,
} from "@/lib/discovery/navigation";

function asset(overrides: Partial<CatalogNavigationAsset>): CatalogNavigationAsset {
  return {
    id: "asset-1",
    type: "table",
    kind: "physical",
    name: "Asset",
    location: "dbo.ASSET",
    lineage: [],
    ...overrides,
  };
}

describe("resolveCatalogNavigation", () => {
  it("uses canonical table location instead of the search index id", () => {
    expect(resolveCatalogNavigation(asset({ id: "table-dbo-service-lines", location: "dbo.SERVICE_LINES" })))
      .toEqual({ kind: "table", tableLocation: "dbo.SERVICE_LINES", assetName: "Asset" });
  });

  it("matches dbo-qualified catalog locations to unqualified explorer tables", () => {
    expect(catalogTableMatches("SERVICE_LINES", "dbo.SERVICE_LINES")).toBe(true);
    expect(catalogTableMatches("billing.LINE_ITEMS", "dbo.LINE_ITEMS")).toBe(false);
  });

  it("resolves a column to its containing table", () => {
    expect(resolveCatalogNavigation(asset({ type: "column", location: "dbo.SERVICE_LINES.service_line" })))
      .toEqual({ kind: "table", tableLocation: "dbo.SERVICE_LINES", assetName: "Asset" });
  });

  it("extracts the raw report id", () => {
    expect(resolveCatalogNavigation(asset({ id: "report-a1b2", type: "report", kind: "virtual" })))
      .toEqual({ kind: "report", reportId: "a1b2" });
  });

  it("uses governed dataset lineage when it contains a physical table", () => {
    expect(resolveCatalogNavigation(asset({ type: "dataset", kind: "virtual", lineage: ["upload", "dbo.CLIENT_EPISODES_ALL"] })))
      .toEqual({ kind: "table", tableLocation: "dbo.CLIENT_EPISODES_ALL", assetName: "Asset" });
  });

  it("preserves a virtual dataset as discovery context without inventing a table", () => {
    expect(resolveCatalogNavigation(asset({ id: "dataset-census", type: "dataset", kind: "virtual", lineage: ["csv", "census"] })))
      .toEqual({ kind: "discover-context", assetId: "dataset-census", assetName: "Asset" });
  });

  it("uses the existing KPI interpreter navigation contract", () => {
    expect(resolveCatalogNavigation(asset({ type: "kpi", kind: "virtual", name: "Average Daily Census" })))
      .toEqual({ kind: "navigate", destination: "kpi:interpret:Average Daily Census" });
  });
});
