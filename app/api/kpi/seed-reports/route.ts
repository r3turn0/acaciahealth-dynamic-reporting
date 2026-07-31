export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { CANONICAL_REPORTS } from "@/lib/config/canonicalReports";
import {
  listReports,
  synchronizeCanonicalReports,
} from "@/lib/services/reportService";
import { addPin, listPins } from "@/lib/agents/pinsRegistry";

export async function GET() {
  const reports = await listReports();
  const existingNames = new Set(reports.map((report) => report.name));
  const status = CANONICAL_REPORTS.map((source) => ({
    reportName: source.name,
    sourceFile: source.sourceFile,
    resultSet: source.resultSet,
    resultSetCount: source.resultSetCount,
    reportExists: existingNames.has(source.name),
  }));

  return NextResponse.json({
    totalReports: status.length,
    seeded: status.filter((entry) => entry.reportExists).length,
    pending: status.filter((entry) => !entry.reportExists).length,
    status,
  });
}

export async function POST() {
  const sync = await synchronizeCanonicalReports();
  const reports = await listReports();
  const pins = listPins();
  const pinnedRefs = new Set(pins.map((pin) => `kpi:${pin.refId.toLowerCase()}`));
  const pinned: string[] = [];
  const errors: { report: string; error: string }[] = [];

  // Keep one dashboard pin per KPI, linked to the first canonical result set.
  for (const source of CANONICAL_REPORTS) {
    const pinKey = `kpi:${source.kpi.toLowerCase()}`;
    if (pinnedRefs.has(pinKey)) continue;
    const report = reports.find((candidate) => candidate.name === source.name);
    if (!report) continue;

    try {
      addPin({
        type: "kpi",
        refId: source.kpi,
        title: source.name,
        subtitle: source.description,
        kpi: source.kpi,
        meta: {
          reportId: report.id,
          sourceFile: source.sourceFile,
          resultSet: source.resultSet,
          canonical: true,
        },
        pinned_by: "system",
      });
      pinnedRefs.add(pinKey);
      pinned.push(source.kpi);
    } catch (error) {
      errors.push({ report: source.name, error: String(error) });
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    totalReports: CANONICAL_REPORTS.length,
    summary: {
      reportsCreated: sync.created.length,
      reportsUpdated: sync.updated.length,
      legacyReportsRemoved: sync.removedLegacy.length,
      reportsUnchanged: sync.unchanged.length,
      pinned: pinned.length,
      errors: errors.length,
    },
    ...sync,
    pinned,
    errors,
  });
}
