import type { AssetKind, AssetType } from "@/lib/discovery/catalog";

export interface CatalogNavigationAsset {
  id: string;
  type: AssetType;
  kind: AssetKind;
  name: string;
  location: string;
  lineage: string[];
}

export type CatalogNavigationAction =
  | { kind: "table"; tableLocation: string; assetName: string }
  | { kind: "discover-context"; assetId: string; assetName: string }
  | { kind: "report"; reportId: string }
  | { kind: "navigate"; destination: string };

const QUALIFIED_TABLE = /^(?:[A-Za-z_][\w$]*\.)[A-Za-z_][\w$]*$/;

function normalizeTableLocation(location: string): string {
  const normalized = location.trim().replace(/[\[\]"]/g, "").toLowerCase();
  return normalized.startsWith("dbo.") ? normalized.slice(4) : normalized;
}

export function catalogTableMatches(availableTable: string, catalogLocation: string): boolean {
  return normalizeTableLocation(availableTable) === normalizeTableLocation(catalogLocation);
}

function tableFromColumnLocation(location: string): string | null {
  const parts = location.split(".");
  if (parts.length < 3) return null;
  const table = parts.slice(0, -1).join(".");
  return QUALIFIED_TABLE.test(table) ? table : null;
}

function physicalTableFromLineage(lineage: string[]): string | null {
  return lineage.find((item) => QUALIFIED_TABLE.test(item.trim()))?.trim() ?? null;
}

export function resolveCatalogNavigation(asset: CatalogNavigationAsset): CatalogNavigationAction | null {
  switch (asset.type) {
    case "table":
      return QUALIFIED_TABLE.test(asset.location.trim())
        ? { kind: "table", tableLocation: asset.location.trim(), assetName: asset.name }
        : null;
    case "column": {
      const tableLocation = tableFromColumnLocation(asset.location.trim());
      return tableLocation ? { kind: "table", tableLocation, assetName: asset.name } : null;
    }
    case "dataset": {
      const tableLocation = physicalTableFromLineage(asset.lineage);
      return tableLocation
        ? { kind: "table", tableLocation, assetName: asset.name }
        : { kind: "discover-context", assetId: asset.id, assetName: asset.name };
    }
    case "report": {
      const reportId = asset.id.startsWith("report-") ? asset.id.slice("report-".length) : "";
      return reportId ? { kind: "report", reportId } : null;
    }
    case "kpi":
      return { kind: "navigate", destination: `kpi:interpret:${asset.name}` };
    case "validation":
      return { kind: "navigate", destination: "admin-query-history" };
    case "agent":
      return { kind: "navigate", destination: "admin-agents" };
    case "glossary":
      return { kind: "navigate", destination: "schema-glossary" };
    case "relationship":
      return { kind: "navigate", destination: "schema-lineage" };
    default:
      return null;
  }
}
