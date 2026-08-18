export type AnalysisSourceType = "saved-report" | "uploaded-file" | "scorecard";
export type AnalysisExecutionMode = "live" | "cache" | "upload" | "metadata";
export type AnalysisValidationStatus = "validated" | "virtual-certified" | "unvalidated" | "failed";
export type AnalysisStage = "validated" | "parsed" | "normalized" | "failed";

export interface AnalysisResultSet {
  citationId: string;
  name: string;
  columns: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  numericSummary: Record<string, { total: number; average: number; min: number; max: number; nonNull: number }>;
  completeness: number;
  grain: string[];
  notes: string[];
}

export interface AnalysisSource {
  id: string;
  name: string;
  type: AnalysisSourceType;
  executionMode: AnalysisExecutionMode;
  validationStatus: AnalysisValidationStatus;
  executedAt: string;
  dataAgeMs: number | null;
  dateRange: { startDate: string; endDate: string } | null;
  resultSetCount: number;
  resultSets: AnalysisResultSet[];
  fallbackReason: string | null;
  diagnostics: string[];
}

export interface AnalysisFinding {
  statement: string;
  citationIds: string[];
  classification: "fact" | "hypothesis";
  impact: "high" | "medium" | "low";
}

export interface AnalysisAction {
  horizon: "immediate" | "medium-term" | "long-term";
  action: string;
  rationale: string;
  citationIds: string[];
}

export interface EvidenceGradeAnalysis {
  executiveSummary: string;
  plainLanguageSummary: string;
  evidence: AnalysisFinding[];
  keyFindings: AnalysisFinding[];
  risks: AnalysisFinding[];
  opportunities: AnalysisFinding[];
  recommendedActions: AnalysisAction[];
  sourceReportsUsed: Array<Pick<AnalysisSource, "id" | "name" | "type" | "executionMode" | "validationStatus" | "executedAt" | "dataAgeMs" | "resultSetCount" | "fallbackReason">>;
  missingEvidence: string[];
  confidence: { score: number; band: "high" | "medium" | "low"; explanation: string[] };
  generatedAt: string;
}

export interface FileIngestionResult {
  fileId: string;
  fileName: string;
  mediaType: string;
  size: number;
  stage: AnalysisStage;
  source: AnalysisSource | null;
  diagnostics: string[];
}

export interface KpiAnalysisSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  sources: AnalysisSource[];
  analysis: EvidenceGradeAnalysis | null;
  conversation: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
}
