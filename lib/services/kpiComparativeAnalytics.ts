import "server-only";

import type { CompactResultSet, KpiComparativeEvidence, KpiEvidenceBundle } from "@/lib/services/kpiEvidenceService";

export interface KpiMetricObservation {
  id: string;
  nodeKey: string;
  reportId: string;
  reportName: string;
  column: string;
  label: string;
  value: number;
  citationId: string;
  completeness: number;
}

export interface KpiMetricComparison {
  id: string;
  nodeKey: string;
  reportName: string;
  label: string;
  currentValue: number;
  priorValue: number;
  absoluteVariance: number;
  percentageVariance: number | null;
  direction: "up" | "down" | "flat";
  magnitude: number;
  currentCitationId: string;
  priorCitationId: string;
  sufficient: boolean;
}

export interface KpiDriver {
  label: string;
  nodeKey: string;
  statement: string;
  direction: "up" | "down" | "flat";
  magnitude: number;
  citationIds: string[];
}

export interface KpiComparativeAnalytics {
  currentMetrics: KpiMetricObservation[];
  priorMetrics: KpiMetricObservation[];
  comparisons: KpiMetricComparison[];
  drivers: KpiDriver[];
  risks: KpiDriver[];
  opportunities: KpiDriver[];
  dataSufficiency: { comparableMetrics: number; currentMetrics: number; priorMetrics: number; sufficient: boolean };
}

const DIMENSION_PATTERN = /(^|_)(date|day|week|month|year|code|branch|region|service|line|type|class|category|status|name)(_|$)/i;
const RATE_PATTERN = /(rate|percent|percentage|pct|ratio|compliance|achievement)/i;
const AVERAGE_PATTERN = /(avg|average|mean|alos|days)/i;

function readable(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricValue(column: string, summary: CompactResultSet["numericSummary"][string]): number {
  if (RATE_PATTERN.test(column) || AVERAGE_PATTERN.test(column)) return summary.average;
  return summary.total;
}

export function normalizeKpiMetrics(bundle: KpiEvidenceBundle): KpiMetricObservation[] {
  return bundle.evidence.flatMap((report) => report.status !== "success" ? [] : report.resultSets.flatMap((set) =>
    Object.entries(set.numericSummary)
      .filter(([column, summary]) => !DIMENSION_PATTERN.test(column) && summary.nonNull > 0)
      .map(([column, summary]) => ({
        id: `${report.reportId}:${report.nodeKey}:${column.toLowerCase()}`,
        nodeKey: report.nodeKey,
        reportId: report.reportId,
        reportName: report.reportName,
        column,
        label: readable(column),
        value: metricValue(column, summary),
        citationId: set.citationId,
        completeness: set.completeness,
      }))
  ));
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compareKpiEvidence(evidence: KpiComparativeEvidence): KpiComparativeAnalytics {
  const currentMetrics = normalizeKpiMetrics(evidence.current);
  const priorMetrics = normalizeKpiMetrics(evidence.prior);
  const priorById = new Map(priorMetrics.map((metric) => [metric.id, metric]));
  const comparisons = currentMetrics.flatMap((current): KpiMetricComparison[] => {
    const prior = priorById.get(current.id);
    if (!prior) return [];
    const absoluteVariance = current.value - prior.value;
    const percentageVariance = prior.value === 0 ? null : (absoluteVariance / Math.abs(prior.value)) * 100;
    const threshold = Math.max(Math.abs(prior.value) * 0.001, 0.0001);
    const direction = absoluteVariance > threshold ? "up" : absoluteVariance < -threshold ? "down" : "flat";
    return [{
      id: current.id,
      nodeKey: current.nodeKey,
      reportName: current.reportName,
      label: current.label,
      currentValue: rounded(current.value),
      priorValue: rounded(prior.value),
      absoluteVariance: rounded(absoluteVariance),
      percentageVariance: percentageVariance == null ? null : rounded(percentageVariance),
      direction,
      magnitude: rounded(Math.abs(percentageVariance ?? absoluteVariance)),
      currentCitationId: current.citationId,
      priorCitationId: prior.citationId,
      sufficient: current.completeness >= 0.5 && prior.completeness >= 0.5,
    }];
  }).sort((a, b) => b.magnitude - a.magnitude || a.label.localeCompare(b.label));

  const drivers: KpiDriver[] = comparisons.filter((item) => item.sufficient).slice(0, 6).map((item) => ({
    label: item.label,
    nodeKey: item.nodeKey,
    statement: `${item.label} moved ${item.direction} from ${item.priorValue.toLocaleString()} to ${item.currentValue.toLocaleString()}${item.percentageVariance == null ? "" : ` (${item.percentageVariance > 0 ? "+" : ""}${item.percentageVariance}%)`}.`,
    direction: item.direction,
    magnitude: item.magnitude,
    citationIds: [item.currentCitationId, item.priorCitationId],
  }));
  const material = drivers.filter((driver) => driver.magnitude >= 10);
  const risks = material.filter((driver) => driver.direction === "down").slice(0, 3);
  const opportunities = material.filter((driver) => driver.direction === "up").slice(0, 3);
  return {
    currentMetrics,
    priorMetrics,
    comparisons,
    drivers,
    risks,
    opportunities,
    dataSufficiency: {
      comparableMetrics: comparisons.length,
      currentMetrics: currentMetrics.length,
      priorMetrics: priorMetrics.length,
      sufficient: comparisons.some((item) => item.sufficient),
    },
  };
}
