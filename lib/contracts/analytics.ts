export interface AnalyticsDataset {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface AnalyticsRequest {
  dataset: AnalyticsDataset;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface AnalyticsEvidence {
  quality: {
    score: number;
    rowCount: number;
    columnCount: number;
    completeness: number;
    duplicateRows: number;
    warnings: string[];
  };
  findings: Array<{
    id: string;
    type: "KPI" | "TREND" | "ANOMALY" | "DRIVER" | "QUALITY";
    title: string;
    summary: string;
    metric?: string;
    value?: number;
    severity: "info" | "warning" | "critical";
    evidence: string[];
  }>;
  forecast?: {
    metric: string;
    direction: "up" | "down" | "stable";
    projectedValue: number;
    horizon: string;
    method: "linear_trend";
    reliability: "low" | "moderate";
  };
  recommendations: string[];
  confidence: {
    score: number;
    level: "low" | "moderate" | "high";
    factors: string[];
  };
  trace: Array<{
    stage: "PROFILE" | "ANALYZE" | "VALIDATE" | "SYNTHESIZE";
    status: "complete" | "limited";
    detail: string;
  }>;
}

export interface AnalyticsResponse {
  intent: {
    type: "FILTER" | "GROUP_BY" | "SUMMARY" | "TOP_N" | "SORT" | "CLARIFICATION";
    operation?: string;
  };
  transformation?: {
    steps: string[];
  };
  response: {
    type: "TABLE" | "SUMMARY_TEXT" | "CHART" | "KPI" | "CLARIFICATION";
    data?: Record<string, unknown>[];
    columns?: string[];
    text?: string;
    presentation?: {
      chartType: "bar" | "line" | "pie" | "none";
      xAxis?: string;
      yAxis?: string;
      groupBy?: string[];
      limit?: number;
    };
  };
  clarification?: {
    question: string;
    options: string[];
  };
  metadata: {
    source: "in_memory_dataset";
    confidence: number;
    fallback?: boolean;
  };
  intelligence?: AnalyticsEvidence;
}

const RESPONSE_TYPES = new Set<AnalyticsResponse["response"]["type"]>([
  "TABLE",
  "SUMMARY_TEXT",
  "CHART",
  "KPI",
  "CLARIFICATION",
]);

const INTENT_TYPES = new Set<AnalyticsResponse["intent"]["type"]>([
  "FILTER",
  "GROUP_BY",
  "SUMMARY",
  "TOP_N",
  "SORT",
  "CLARIFICATION",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Runtime guard for untrusted AI and HTTP responses. */
export function isAnalyticsResponse(value: unknown): value is AnalyticsResponse {
  if (!isRecord(value) || !isRecord(value.intent) || !isRecord(value.response) || !isRecord(value.metadata)) {
    return false;
  }

  const { intent, response, metadata } = value;
  if (
    typeof intent.type !== "string" ||
    !INTENT_TYPES.has(intent.type as AnalyticsResponse["intent"]["type"]) ||
    (intent.operation !== undefined && typeof intent.operation !== "string") ||
    typeof response.type !== "string" ||
    !RESPONSE_TYPES.has(response.type as AnalyticsResponse["response"]["type"]) ||
    (response.text !== undefined && typeof response.text !== "string") ||
    (response.columns !== undefined && !isStringArray(response.columns)) ||
    (response.data !== undefined && (!Array.isArray(response.data) || !response.data.every(isRecord))) ||
    metadata.source !== "in_memory_dataset" ||
    typeof metadata.confidence !== "number" ||
    !Number.isFinite(metadata.confidence) ||
    (metadata.fallback !== undefined && typeof metadata.fallback !== "boolean")
  ) {
    return false;
  }

  if (value.transformation !== undefined) {
    if (!isRecord(value.transformation) || !isStringArray(value.transformation.steps)) return false;
  }

  if (response.presentation !== undefined) {
    if (!isRecord(response.presentation)) return false;
    const chartTypes = new Set(["bar", "line", "pie", "none"]);
    if (!chartTypes.has(String(response.presentation.chartType))) return false;
    if (response.presentation.groupBy !== undefined && !isStringArray(response.presentation.groupBy)) return false;
  }

  if (value.clarification !== undefined) {
    if (
      !isRecord(value.clarification) ||
      typeof value.clarification.question !== "string" ||
      !isStringArray(value.clarification.options)
    ) return false;
  }

  if (value.intelligence !== undefined) {
    const intelligence = value.intelligence;
    if (
      !isRecord(intelligence) ||
      !isRecord(intelligence.quality) ||
      !isRecord(intelligence.confidence) ||
      !Array.isArray(intelligence.findings) ||
      !intelligence.findings.every(isRecord) ||
      !isStringArray(intelligence.recommendations) ||
      !Array.isArray(intelligence.trace) ||
      !intelligence.trace.every(isRecord) ||
      typeof intelligence.quality.score !== "number" ||
      typeof intelligence.confidence.score !== "number"
    ) return false;
  }

  return true;
}

export function getAnalyticsError(value: unknown, fallback = "Request failed"): string {
  return isRecord(value) && typeof value.error === "string" && value.error.trim()
    ? value.error
    : fallback;
}
