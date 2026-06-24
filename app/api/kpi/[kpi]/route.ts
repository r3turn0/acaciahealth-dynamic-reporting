import { NextRequest, NextResponse } from "next/server";
import kpiConfig from "@/lib/config/kpiConfig.json";
import bucketMap from "@/lib/config/bucketMap.json";

type KpiKey = keyof typeof kpiConfig;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kpi: string }> }
) {
  const { kpi } = await params;

  if (!(kpi in kpiConfig)) {
    return NextResponse.json(
      {
        error: `Unknown KPI: ${kpi}`,
        available: Object.keys(kpiConfig),
      },
      { status: 404 }
    );
  }

  const kpiDef = kpiConfig[kpi as KpiKey];

  return NextResponse.json({
    kpi,
    definition: kpiDef,
    bucket_map: bucketMap,
    example_request: {
      report_name: `Weekly ${kpiDef.label} by Branch`,
      prompt: `Show weekly ${kpi} grouped by hospice region`,
      filters: {
        date_range: {
          start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          end_date: new Date().toISOString().split("T")[0],
        },
      },
    },
  });
}
