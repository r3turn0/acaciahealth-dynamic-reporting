import type { AnalyticsDataset, AnalyticsEvidence } from "@/lib/contracts/analytics";

type Scalar = string | number | null;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numericSeries(dataset: AnalyticsDataset, columnIndex: number): number[] {
  return dataset.rows
    .map((row) => row[columnIndex])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function linearSlope(values: number[]): number {
  if (values.length < 3) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function serializeRow(row: Scalar[]): string {
  return JSON.stringify(row);
}

/** Deterministic, read-only profiling and analytical evidence generation. */
export function buildAnalyticsEvidence(dataset: AnalyticsDataset): AnalyticsEvidence {
  const rowCount = dataset.rows.length;
  const columnCount = dataset.columns.length;
  const totalCells = Math.max(rowCount * columnCount, 1);
  const missingCells = dataset.rows.reduce(
    (total, row) => total + row.filter((value) => value === null || value === "").length,
    0
  );
  const completeness = 1 - missingCells / totalCells;
  const rowKeys = dataset.rows.map(serializeRow);
  const duplicateRows = rowKeys.length - new Set(rowKeys).size;
  const warnings: string[] = [];
  if (rowCount === 0) warnings.push("The result set contains no rows.");
  if (completeness < 0.95) warnings.push(`${round((1 - completeness) * 100, 1)}% of cells are missing.`);
  if (duplicateRows > 0) warnings.push(`${duplicateRows.toLocaleString()} duplicate rows may affect aggregates.`);

  const findings: AnalyticsEvidence["findings"] = [];
  const numericColumns = dataset.columns
    .map((column, index) => ({ column, index, values: numericSeries(dataset, index) }))
    .filter(({ values }) => values.length > 0);

  numericColumns.slice(0, 5).forEach(({ column, values }, metricIndex) => {
    const sum = values.reduce((total, value) => total + value, 0);
    const mean = sum / values.length;
    findings.push({
      id: `kpi-${metricIndex}`,
      type: "KPI",
      title: column.replace(/_/g, " "),
      summary: `Average ${round(mean).toLocaleString()} across ${values.length.toLocaleString()} observed values.`,
      metric: column,
      value: round(mean),
      severity: "info",
      evidence: [`Sum: ${round(sum).toLocaleString()}`, `Observed values: ${values.length.toLocaleString()}`],
    });

    const deviation = standardDeviation(values, mean);
    const anomalies = deviation === 0 ? [] : values.filter((value) => Math.abs((value - mean) / deviation) >= 3);
    if (anomalies.length > 0) {
      findings.push({
        id: `anomaly-${metricIndex}`,
        type: "ANOMALY",
        title: `Outliers in ${column.replace(/_/g, " ")}`,
        summary: `${anomalies.length} values are at least three standard deviations from the mean.`,
        metric: column,
        severity: anomalies.length / values.length > 0.05 ? "warning" : "info",
        evidence: [`Mean: ${round(mean)}`, `Standard deviation: ${round(deviation)}`, `Outlier count: ${anomalies.length}`],
      });
    }
  });

  const trendCandidate = numericColumns.find(({ values }) => values.length >= 6);
  let forecast: AnalyticsEvidence["forecast"];
  if (trendCandidate) {
    const slope = linearSlope(trendCandidate.values);
    const mean = trendCandidate.values.reduce((sum, value) => sum + value, 0) / trendCandidate.values.length;
    const relativeSlope = mean === 0 ? 0 : slope / Math.abs(mean);
    const direction = Math.abs(relativeSlope) < 0.01 ? "stable" : slope > 0 ? "up" : "down";
    findings.push({
      id: "trend-primary",
      type: "TREND",
      title: `${trendCandidate.column.replace(/_/g, " ")} trend`,
      summary: `Observed sequence is ${direction === "stable" ? "broadly stable" : `trending ${direction}`}.`,
      metric: trendCandidate.column,
      severity: "info",
      evidence: [`Linear slope: ${round(slope, 3)} per observation`, `Observations: ${trendCandidate.values.length}`],
    });
    forecast = {
      metric: trendCandidate.column,
      direction,
      projectedValue: round(trendCandidate.values.at(-1)! + slope),
      horizon: "next observation",
      method: "linear_trend",
      reliability: trendCandidate.values.length >= 12 ? "moderate" : "low",
    };
  }

  if (warnings.length > 0) {
    findings.unshift({
      id: "quality-overview",
      type: "QUALITY",
      title: "Data quality requires attention",
      summary: warnings[0],
      severity: completeness < 0.8 ? "critical" : "warning",
      evidence: warnings,
    });
  }

  const qualityScore = clamp(completeness - Math.min(duplicateRows / Math.max(rowCount, 1), 0.25));
  const volumeFactor = clamp(Math.log10(rowCount + 1) / 3);
  const confidenceScore = clamp(qualityScore * 0.65 + volumeFactor * 0.25 + (numericColumns.length > 0 ? 0.1 : 0));
  const confidenceLevel = confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.55 ? "moderate" : "low";

  return {
    quality: {
      score: round(qualityScore),
      rowCount,
      columnCount,
      completeness: round(completeness),
      duplicateRows,
      warnings,
    },
    findings: findings.slice(0, 10),
    forecast,
    recommendations: [
      ...(warnings.length ? ["Resolve quality warnings before using this result for executive decisions."] : []),
      ...(forecast?.reliability === "low" ? ["Collect at least 12 ordered observations before relying on the directional forecast."] : []),
      "Validate material findings against the governed report definition and business owner.",
    ],
    confidence: {
      score: round(confidenceScore),
      level: confidenceLevel,
      factors: [
        `${round(completeness * 100, 1)}% cell completeness`,
        `${rowCount.toLocaleString()} rows analyzed`,
        `${numericColumns.length} numeric measures detected`,
        forecast ? `${forecast.reliability} forecast reliability` : "no defensible forecast series detected",
      ],
    },
    trace: [
      { stage: "PROFILE", status: "complete", detail: `Profiled ${rowCount} rows and ${columnCount} columns.` },
      { stage: "ANALYZE", status: numericColumns.length ? "complete" : "limited", detail: `Evaluated ${numericColumns.length} numeric measures for KPIs, trends, and anomalies.` },
      { stage: "VALIDATE", status: warnings.length ? "limited" : "complete", detail: warnings.length ? `${warnings.length} quality warnings detected.` : "No material completeness or duplication warnings detected." },
      { stage: "SYNTHESIZE", status: "complete", detail: "Produced evidence-backed findings and conservative recommendations." },
    ],
  };
}

export function summarizeAnalyticsEvidence(evidence: AnalyticsEvidence): string {
  return JSON.stringify({
    quality: evidence.quality,
    findings: evidence.findings,
    forecast: evidence.forecast,
    confidence: evidence.confidence,
    recommendations: evidence.recommendations,
  });
}
