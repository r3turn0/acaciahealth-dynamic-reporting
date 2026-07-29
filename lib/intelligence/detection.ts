import { intelligenceStore } from "./store";
import type { ActivityEvent, DetectionResult, IntelligenceAlert, KpiDefinition, Severity } from "./types";

const classifiers = [
  { name: "New Admissions", category: "Growth", terms: ["admission", "admit", "startofcare", "socdate"] },
  { name: "Average Daily Census", category: "Clinical Operations", terms: ["census", "adc", "patientdays"] },
  { name: "Length of Stay", category: "Clinical Operations", terms: ["lengthofstay", "episodedays", "los"] },
  { name: "Recertification Rate", category: "Clinical Operations", terms: ["recert", "recertificationdate"] },
  { name: "Referral Conversion", category: "Growth", terms: ["referral", "nonadmit", "ntuc"] },
  { name: "Revenue Per Patient Day", category: "Revenue Cycle", terms: ["revenueamount", "revenue", "patientday"] },
  { name: "AR Over 90 Days", category: "Revenue Cycle", terms: ["araging", "age90", "collections"] },
  { name: "QA Compliance", category: "Quality", terms: ["qa", "compliance", "documentationtimeliness", "auditcompletion"] },
  { name: "Source Reconciliation", category: "Data Quality", terms: ["missingbranch", "duplicate", "missingcensus", "reconciliation"] },
];

const severityFor = (eventType: string): Severity => {
  const value = eventType.toLowerCase();
  if (value.includes("security") || value.includes("outage") || value.includes("calculation changed")) return "critical";
  if (value.includes("failed") || value.includes("quality")) return "error";
  if (value.includes("detected") || value.includes("modified") || value.includes("changed")) return "warning";
  if (value.includes("completed") || value.includes("success")) return "success";
  return "info";
};

export function analyzeEvent(event: ActivityEvent): DetectionResult {
  const snapshot = intelligenceStore.snapshot();
  const searchable = `${event.eventType} ${event.entityName} ${JSON.stringify(event.metadata)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const detected: KpiDefinition[] = [];
  const matched: KpiDefinition[] = [];
  for (const classifier of classifiers) {
    const hits = classifier.terms.filter((term) => searchable.includes(term));
    if (!hits.length) continue;
    const existing = snapshot.kpis.find((k) => k.name === classifier.name || k.aliases.some((alias) => searchable.includes(alias.toLowerCase().replace(/[^a-z0-9]/g, ""))));
    if (existing) { matched.push(existing); continue; }
    detected.push({ id: crypto.randomUUID(), name: classifier.name, businessCategory: classifier.category, description: `Detected from ${event.entityName} metadata.`, sourceDatasetId: event.entityType === "dataset" ? event.entityId : undefined, sourceReportId: event.entityType === "report" ? event.entityId : undefined, formula: "Pending analyst approval", thresholds: {}, isAIRecommended: true, confidence: Math.min(0.99, 0.78 + hits.length * 0.07), status: "detected", aliases: hits, lineage: [event.sourceSystem, event.entityName, classifier.name], createdAt: new Date().toISOString() });
  }
  const impacted = [...matched, ...detected].map((k) => k.name);
  const alerts: IntelligenceAlert[] = impacted.length ? [{ id: crypto.randomUUID(), title: detected.length ? `${detected.length} potential KPI${detected.length > 1 ? "s" : ""} detected` : `${impacted.length} KPI${impacted.length > 1 ? "s" : ""} impacted`, description: `${event.entityName} triggered KPI intelligence analysis.`, severity: severityFor(event.eventType), category: event.entityType === "dataset" ? "datasets" : "kpi", status: "open", entityType: event.entityType, entityId: event.entityId, entityName: event.entityName, sourceSystem: "KPI Detection Agent", correlationKey: `${event.entityType}:${event.entityId}`, impactedAssets: impacted, resolutionActions: detected.length ? ["Review recommendations", "Approve KPI", "Configure thresholds"] : ["Review impact analysis", "Validate KPI calculations"], metadata: { eventId: event.id, confidence: detected[0]?.confidence }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] : [];
  detected.forEach((kpi) => intelligenceStore.addKpi(kpi));
  alerts.forEach((alert) => intelligenceStore.addAlert(alert));
  return { eventId: event.id, detected, matched, alerts };
}

export function ingestEvent(input: Omit<ActivityEvent, "id" | "eventDate"> & Partial<Pick<ActivityEvent, "id" | "eventDate">>): DetectionResult {
  const event: ActivityEvent = { ...input, id: input.id ?? crypto.randomUUID(), eventDate: input.eventDate ?? new Date().toISOString() };
  intelligenceStore.addActivity(event);
  return analyzeEvent(event);
}
