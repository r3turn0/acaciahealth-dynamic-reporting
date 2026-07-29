import type { ActivityEvent, AgentMetric, IntelligenceAlert, IntelligenceSnapshot, KpiDefinition, SystemMetric } from "./types";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const id = () => crypto.randomUUID();

const kpis: KpiDefinition[] = [
  { id: id(), name: "Average Daily Census", businessCategory: "Clinical Operations", description: "Average number of active patients served per day.", formula: "Patient Days / Calendar Days", thresholds: { warning: 120, critical: 105, direction: "below" }, isAIRecommended: false, confidence: 1, status: "active", aliases: ["ADC", "Census"], lineage: ["HCHB", "Clinical Census Dataset", "Patient Days Measure", "ADC"], createdAt: ago(12000) },
  { id: id(), name: "New Admissions", businessCategory: "Growth", description: "Newly admitted patients during the reporting period.", formula: "COUNT(DISTINCT EpisodeId WHERE AdmissionDate in period)", thresholds: { warning: 90, critical: 75, direction: "below" }, isAIRecommended: false, confidence: 1, status: "active", aliases: ["Admissions", "Starts of Care"], lineage: ["HCHB", "Episodes", "Admissions Measure"], createdAt: ago(11000) },
  { id: id(), name: "Average Census Growth", businessCategory: "Growth", description: "Period-over-period growth in average census.", formula: "(Current ADC - Prior ADC) / Prior ADC", thresholds: { warning: 0, critical: -0.05, direction: "below" }, isAIRecommended: true, confidence: 0.96, status: "detected", aliases: ["Census Growth"], lineage: ["Clinical Census Dataset", "ADC"], createdAt: ago(42) },
  { id: id(), name: "AR Over 90 Days", businessCategory: "Revenue Cycle", description: "Accounts receivable balance aged beyond 90 days.", formula: "SUM(ARAmount WHERE AgeDays > 90)", thresholds: { warning: 15, critical: 22, direction: "above" }, isAIRecommended: false, confidence: 1, status: "active", aliases: ["AR > 90", "Aging"], lineage: ["ERP", "AR Aging", "AR > 90"], createdAt: ago(9000) },
];

const alerts: IntelligenceAlert[] = [
  { id: id(), title: "Clinical Census dataset changed", description: "Schema and measure changes were detected in the clinical census dataset.", severity: "critical", category: "datasets", status: "open", entityType: "dataset", entityId: "clinical-census", entityName: "Clinical Census", sourceSystem: "Dataset Monitor", correlationKey: "clinical-census-change", impactedAssets: ["12 reports", "6 dashboards", "Census", "ADC", "Patient Days"], resolutionActions: ["Review schema diff", "Validate impacted KPIs", "Notify dashboard owners"], metadata: { changes: 4 }, createdAt: ago(8), updatedAt: ago(8) },
  { id: id(), title: "Unexpected ADC variance", description: "Current ADC is 104; the expected operating range is 128–135.", severity: "error", category: "kpi", status: "open", entityType: "kpi", entityId: kpis[0]!.id, entityName: "Average Daily Census", sourceSystem: "KPI Detection Agent", impactedAssets: ["Executive Census Dashboard", "Patient Days Scorecard"], resolutionActions: ["Validate census source records", "Review branch exclusions"], metadata: { current: 104, expectedMin: 128, expectedMax: 135 }, createdAt: ago(16), updatedAt: ago(16) },
  { id: id(), title: "KPI Detection Agent retry rate elevated", description: "Retry rate reached 8.2% over the last hour.", severity: "warning", category: "agents", status: "read", entityType: "agent", entityId: "kpi-detection", entityName: "KPI Detection Agent", sourceSystem: "Agent Monitor", impactedAssets: ["KPI recommendations"], resolutionActions: ["Inspect gateway latency", "Review failed executions"], metadata: { retryRate: 8.2 }, createdAt: ago(34), updatedAt: ago(28) },
  { id: id(), title: "Potential KPI detected", description: "Average Census Growth was detected with 96% confidence.", severity: "warning", category: "kpi", status: "open", entityType: "kpi", entityId: kpis[2]!.id, entityName: "Average Census Growth", sourceSystem: "KPI Detection Agent", impactedAssets: ["Clinical Census Dataset"], resolutionActions: ["Approve KPI", "Edit formula", "Dismiss recommendation"], metadata: { confidence: 0.96 }, createdAt: ago(42), updatedAt: ago(42) },
  { id: id(), title: "Power BI refresh completed", description: "Operations scorecard refreshed successfully in 48 seconds.", severity: "success", category: "reports", status: "read", entityType: "dashboard", entityId: "ops-scorecard", entityName: "Operations Scorecard", sourceSystem: "Power BI", impactedAssets: [], resolutionActions: [], metadata: { runtimeSeconds: 48 }, createdAt: ago(58), updatedAt: ago(58) },
];

const activity: ActivityEvent[] = alerts.map((a) => ({ id: id(), eventType: a.title, entityType: a.entityType, entityId: a.entityId, entityName: a.entityName, actionBy: "System", sourceSystem: a.sourceSystem, metadata: a.metadata, eventDate: a.createdAt }));
const agents: AgentMetric[] = [
  { id: "kpi-detection", name: "KPI Detection Agent", executions: 1284, runtimeMs: 1820, successRate: 96.4, retryRate: 3.1, failureRate: 0.5, averageResponseMs: 1420, cost: 18.42, lastActivity: ago(2), status: "healthy" },
  { id: "sql-generator", name: "SQL Generator Agent", executions: 3098, runtimeMs: 2340, successRate: 94.8, retryRate: 4.2, failureRate: 1, averageResponseMs: 2100, cost: 44.16, lastActivity: ago(1), status: "healthy" },
  { id: "schema-retry", name: "Schema Retry Agent", executions: 417, runtimeMs: 3210, successRate: 91.1, retryRate: 8.2, failureRate: 0.7, averageResponseMs: 2840, cost: 7.91, lastActivity: ago(6), status: "degraded" },
];
const database: SystemMetric[] = [
  { name: "SQL Runtime", value: 238, unit: "ms", status: "healthy", trend: -4.2 }, { name: "Storage Usage", value: 72, unit: "%", status: "healthy", trend: 2.1 }, { name: "Connection Count", value: 34, unit: "connections", status: "healthy", trend: 5.2 }, { name: "ETL Throughput", value: 12840, unit: "rows/min", status: "healthy", trend: 8.4 }, { name: "Blocking Sessions", value: 1, unit: "sessions", status: "warning", trend: 0 }, { name: "Replication Lag", value: 0.8, unit: "sec", status: "healthy", trend: -12 },
];

type RuntimeState = { alerts: IntelligenceAlert[]; kpis: KpiDefinition[]; activity: ActivityEvent[]; agents: AgentMetric[]; database: SystemMetric[]; subscribers: Set<(event: { type: string; payload: unknown }) => void> };
const runtime = globalThis as typeof globalThis & { __acaciaIntelligence?: RuntimeState };
const state = runtime.__acaciaIntelligence ??= { alerts, kpis, activity, agents, database, subscribers: new Set() };

export const intelligenceStore = {
  snapshot(): IntelligenceSnapshot { return { alerts: [...state.alerts], kpis: [...state.kpis], activity: [...state.activity], agents: [...state.agents], database: [...state.database], scores: { kpiHealth: 86, systemHealth: 94, dataQuality: 88, agentAvailability: 97 } }; },
  alert(alertId: string) { return state.alerts.find((a) => a.id === alertId); },
  updateAlert(alertId: string, patch: Partial<Pick<IntelligenceAlert, "status" | "resolvedAt">>) { const alert = state.alerts.find((a) => a.id === alertId); if (!alert) return; Object.assign(alert, patch, { updatedAt: new Date().toISOString() }); this.publish("alerts/updated", alert); return alert; },
  addAlert(alert: IntelligenceAlert) { state.alerts.unshift(alert); this.publish("alerts/new", alert); return alert; },
  addKpi(kpi: KpiDefinition) { state.kpis.unshift(kpi); this.publish("kpi/detected", kpi); return kpi; },
  addActivity(event: ActivityEvent) { state.activity.unshift(event); this.publish("activity/new", event); return event; },
  publish(type: string, payload: unknown) { for (const subscriber of state.subscribers) subscriber({ type, payload }); },
  subscribe(subscriber: (event: { type: string; payload: unknown }) => void) { state.subscribers.add(subscriber); return () => state.subscribers.delete(subscriber); },
};
