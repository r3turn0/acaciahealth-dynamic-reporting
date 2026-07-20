import { NextRequest, NextResponse } from "next/server";
import kpiConfig from "@/lib/config/kpiConfig.json";
import bucketMap from "@/lib/config/bucketMap.json";

type KpiKey = keyof typeof kpiConfig.kpis;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kpi: string }> }
) {
  const { kpi } = await params;
  const kpis = kpiConfig.kpis as Record<string, unknown>;

  if (!(kpi in kpis)) {
    return NextResponse.json(
      {
        error: `Unknown KPI: ${kpi}`,
        available: Object.keys(kpis),
        hint: "Use /api/kpi-admin?action=list to see the full catalog",
      },
      { status: 404 }
    );
  }

  const kpiDef = kpis[kpi as KpiKey] as {
    label: string;
    description: string;
    category: string;
    aggregation: string;
    version: string;
    status: string;
    source: string;
    formula?: string;
    dimensions?: string[];
    filters?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    location_key?: string;
    service_line_field?: string;
  };

  return NextResponse.json({
    kpi,
    definition: kpiDef,
    schema: {
      version:          kpiConfig._meta.schemaVersion,
      reportingGrain:   kpiConfig._meta.reportingGrain,
      locationKey:      kpiDef.location_key ?? kpiConfig._meta.primaryDimensionKey,
      serviceLineField: kpiDef.service_line_field ?? kpiConfig._meta.serviceLineKey,
      dimensionCatalog: kpiConfig._meta.dimensionCatalog,
    },
    bucket_map: bucketMap,
    example_request: {
      report_name: `Weekly ${kpiDef.label} by Branch`,
      prompt: `Show weekly ${kpi} grouped by branch and service line`,
      filters: {
        date_range: {
          start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          end_date: new Date().toISOString().split("T")[0],
        },
        service_lines: kpiConfig._meta.serviceLines ?? ["HOME HEALTH", "HOSPICE"],
      },
    },
  });
}
