import { intelligenceStore } from "./store";
import type { IntelligenceAlert, SystemMetric } from "./types";

export function correlateAlerts(alerts: IntelligenceAlert[]): IntelligenceAlert[] {
  const groups = new Map<string, IntelligenceAlert[]>();
  for (const alert of alerts) {
    const key = alert.correlationKey ?? alert.id;
    groups.set(key, [...(groups.get(key) ?? []), alert]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const lead = group.find((item) => item.severity === "critical") ?? group[0]!;
    return { ...lead, title: `${lead.entityName}: ${group.length} correlated alerts`, description: group.map((item) => item.title).join(" · "), impactedAssets: [...new Set(group.flatMap((item) => item.impactedAssets))], resolutionActions: [...new Set(group.flatMap((item) => item.resolutionActions))], metadata: { ...lead.metadata, correlatedAlertIds: group.map((item) => item.id) } };
  });
}

export function evaluateSystemMetrics(metrics: SystemMetric[]) {
  for (const metric of metrics) {
    if (metric.name === "Storage Usage" && metric.value >= 90) createMetricAlert(metric, "Database storage above 90%", "critical");
    if (metric.name === "Blocking Sessions" && metric.value >= 5) createMetricAlert(metric, "Database blocking sessions elevated", "error");
    if (metric.name === "Replication Lag" && metric.value >= 10) createMetricAlert(metric, "Database replication lag elevated", "warning");
  }
}

function createMetricAlert(metric: SystemMetric, title: string, severity: IntelligenceAlert["severity"]) {
  const exists = intelligenceStore.snapshot().alerts.some((alert) => alert.title === title && alert.status !== "resolved");
  if (exists) return;
  intelligenceStore.addAlert({ id: crypto.randomUUID(), title, description: `${metric.name} is ${metric.value} ${metric.unit}.`, severity, category: "database", status: "open", entityType: "database", entityId: metric.name.toLowerCase().replace(/\s+/g, "-"), entityName: metric.name, sourceSystem: "Database Monitor", correlationKey: "database-health", impactedAssets: ["Reporting database", "ETL pipelines"], resolutionActions: ["Inspect database health", "Escalate to database operations"], metadata: { metric }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
