export type Severity = "critical" | "error" | "warning" | "success" | "info";
export type AlertCategory = "kpi" | "reports" | "datasets" | "agents" | "database" | "security" | "data-quality";
export type AlertStatus = "open" | "read" | "resolved";

export interface ActivityEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  entityName: string;
  actionBy: string;
  sourceSystem: string;
  metadata: Record<string, unknown>;
  eventDate: string;
}

export interface IntelligenceAlert {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: AlertCategory;
  status: AlertStatus;
  entityType: string;
  entityId: string;
  entityName: string;
  sourceSystem: string;
  correlationKey?: string;
  impactedAssets: string[];
  resolutionActions: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface KpiDefinition {
  id: string;
  name: string;
  businessCategory: string;
  description: string;
  sourceDatasetId?: string;
  sourceReportId?: string;
  formula: string;
  thresholds: { warning?: number; critical?: number; direction?: "above" | "below" | "outside" };
  isAIRecommended: boolean;
  confidence: number;
  status: "detected" | "approved" | "active" | "retired";
  aliases: string[];
  lineage: string[];
  createdAt: string;
}

export interface AgentMetric {
  id: string;
  name: string;
  executions: number;
  runtimeMs: number;
  successRate: number;
  retryRate: number;
  failureRate: number;
  averageResponseMs: number;
  cost: number;
  lastActivity: string;
  status: "healthy" | "degraded" | "failed";
}

export interface SystemMetric {
  name: string;
  value: number;
  unit: string;
  status: "healthy" | "warning" | "critical";
  trend: number;
}

export interface DetectionResult {
  eventId: string;
  detected: KpiDefinition[];
  matched: KpiDefinition[];
  alerts: IntelligenceAlert[];
}

export interface IntelligenceSnapshot {
  alerts: IntelligenceAlert[];
  kpis: KpiDefinition[];
  activity: ActivityEvent[];
  agents: AgentMetric[];
  database: SystemMetric[];
  scores: { kpiHealth: number; systemHealth: number; dataQuality: number; agentAvailability: number };
}
