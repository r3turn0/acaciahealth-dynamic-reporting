export interface ReportSummary {
  row_count: number;
  columns: string[];
  aggregates?: Record<string, number>;
}

export interface ReportOutput {
  report_name: string;
  generated_at: string;
  filters: Record<string, unknown>;
  kpi: string;
  sql_used: string;
  data: Record<string, unknown>[];
  summary: ReportSummary;
}

export function formatReport(
  reportName: string,
  filters: Record<string, unknown>,
  data: Record<string, unknown>[],
  kpi: string,
  sqlUsed: string
): ReportOutput {
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  // Compute numeric aggregates for the summary
  const aggregates: Record<string, number> = {};
  for (const col of columns) {
    const values = data.map((row) => row[col]).filter((v) => typeof v === "number") as number[];
    if (values.length === data.length && values.length > 0) {
      aggregates[`total_${col}`] = values.reduce((a, b) => a + b, 0);
      aggregates[`avg_${col}`] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      aggregates[`max_${col}`] = Math.max(...values);
      aggregates[`min_${col}`] = Math.min(...values);
    }
  }

  return {
    report_name: reportName,
    generated_at: new Date().toISOString(),
    filters,
    kpi,
    sql_used: sqlUsed,
    data,
    summary: {
      row_count: data.length,
      columns,
      aggregates: Object.keys(aggregates).length > 0 ? aggregates : undefined,
    },
  };
}
