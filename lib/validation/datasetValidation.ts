export type ValidationCategory = "Schema" | "Relationships" | "Business Mapping" | "Lineage" | "Metadata" | "KPI Readiness" | "Freshness" | "Data Quality";
export type ValidationStatus = "pass" | "warning" | "fail";
export type ValidationCheck = { id: string; category: ValidationCategory; label: string; status: ValidationStatus; score: number; detail: string; explanation: string; remediation?: string };
export type DatasetValidation = {
  validationId: string;
  datasetId: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  status: "Passed" | "Warning" | "Failed";
  checks: ValidationCheck[];
  categoryScores: Record<ValidationCategory, number>;
  detectedKpis: string[];
  missingInputs: string[];
  createdDate: string;
  expiresAt: string;
  virtual: true;
  authoritative: false;
};

type Column = { name: string; type: string; nullable: boolean; isPk: boolean; isFk?: boolean; description?: string };
type Table = { name: string; schema?: string; businessDescription?: string; columns: Column[] };
type Relationship = { sourceTable: string; targetTable: string; sourceColumn?: string; targetColumn?: string; relationshipType?: "OneToOne" | "OneToMany" | "ManyToOne" | "ManyToMany"; status?: string };
type Input = {
  datasetId: string;
  tables: Table[];
  relationshipCount: number;
  relationships?: Relationship[];
  dimensions?: string[];
  measures?: string[];
  glossaryMappings?: string[];
  businessRules?: string[];
  owner?: string;
  sourceTraceability?: string[];
  freshnessAsOf?: string;
};

const result = (id: string, category: ValidationCategory, label: string, status: ValidationStatus, score: number, detail: string, explanation: string, remediation?: string): ValidationCheck => ({ id, category, label, status, score, detail, explanation, remediation });

function hasCycle(relationships: Relationship[]) {
  const graph = new Map<string, string[]>();
  for (const relationship of relationships) graph.set(relationship.sourceTable, [...(graph.get(relationship.sourceTable) ?? []), relationship.targetTable]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) if (visit(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...graph.keys()].some(visit);
}

export function validateDataset(input: Input): DatasetValidation {
  const tableNames = input.tables.map((table) => table.name);
  const columns = input.tables.flatMap((table) => table.columns.map((column) => ({ ...column, table: table.name })));
  const names = columns.map((column) => column.name.toLowerCase());
  const has = (...terms: string[]) => names.some((name) => terms.some((term) => name.includes(term)));
  const duplicateFields = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  const relationships = input.relationships ?? [];
  const relatedTables = new Set(relationships.flatMap((relationship) => [relationship.sourceTable, relationship.targetTable]));
  const orphanTables = relationships.length ? tableNames.filter((table) => tableNames.length > 1 && !relatedTables.has(table)) : (tableNames.length > 1 && input.relationshipCount === 0 ? tableNames : []);
  const circular = hasCycle(relationships);
  const tableIndex = new Map(input.tables.map((table) => [table.name, new Map(table.columns.map((column) => [column.name, column]))]));
  const invalidRelationships = relationships.filter((relationship) => !tableNames.includes(relationship.sourceTable) || !tableNames.includes(relationship.targetTable));
  const missingJoinColumns = relationships.filter((relationship) => !relationship.sourceColumn || !relationship.targetColumn || !tableIndex.get(relationship.sourceTable)?.has(relationship.sourceColumn) || !tableIndex.get(relationship.targetTable)?.has(relationship.targetColumn));
  const relationshipKeys = relationships.map((relationship) => [relationship.sourceTable, relationship.sourceColumn, relationship.targetTable, relationship.targetColumn].join("::").toLowerCase());
  const duplicateRelationships = [...new Set(relationshipKeys.filter((key, index) => relationshipKeys.indexOf(key) !== index))];
  const unsupportedCardinality = relationships.filter((relationship) => {
    if (!relationship.sourceColumn || !relationship.targetColumn) return false;
    const source = tableIndex.get(relationship.sourceTable)?.get(relationship.sourceColumn);
    const target = tableIndex.get(relationship.targetTable)?.get(relationship.targetColumn);
    if (!source || !target) return false;
    return relationship.relationshipType === "OneToOne" && (!source.isPk || !target.isPk)
      || relationship.relationshipType === "ManyToOne" && !target.isPk
      || relationship.relationshipType === "OneToMany" && !source.isPk
      || relationship.relationshipType === "ManyToMany";
  });
  const metadataComplete = Boolean(input.owner?.trim()) && input.tables.every((table) => Boolean(table.businessDescription?.trim() || table.columns.some((column) => column.description?.trim())));
  const lineageComplete = (input.sourceTraceability?.length ?? 0) > 0 || input.tables.every((table) => Boolean(table.schema));
  const hasMeasure = (input.measures?.length ?? 0) > 0 || columns.some((column) => /int|decimal|number|float|money/i.test(column.type));
  const hasBusinessMapping = (input.glossaryMappings?.length ?? 0) > 0 || has("branch", "episode", "patient", "client", "service");
  const freshness = input.freshnessAsOf ? Date.parse(input.freshnessAsOf) : NaN;
  const freshnessAgeDays = Number.isFinite(freshness) ? Math.floor((Date.now() - freshness) / 86_400_000) : null;

  const checks: ValidationCheck[] = [
    result("columns", "Schema", "Columns are defined", names.length ? "pass" : "fail", names.length ? 100 : 0, `${names.length} columns inspected`, "A semantic dataset needs an explicit field contract.", "Add at least one source field."),
    result("primary-keys", "Schema", "Stable keys are present", input.tables.length > 0 && input.tables.every((table) => table.columns.some((column) => column.isPk)) ? "pass" : "warning", input.tables.every((table) => table.columns.some((column) => column.isPk)) ? 100 : 65, "Primary-key metadata checked for every source", "Stable keys prevent ambiguous joins and duplicate result grain.", "Map a governed key for each source table."),
    result("duplicates", "Schema", "Duplicate field names are resolved", duplicateFields.length ? "warning" : "pass", duplicateFields.length ? 60 : 100, duplicateFields.length ? `Duplicate names: ${duplicateFields.join(", ")}` : "No duplicate field names", "Duplicate names can make generated SQL and exported schemas ambiguous.", "Alias duplicate fields with business-safe names."),
    result("relationship-integrity", "Relationships", "Relationships reference selected tables", invalidRelationships.length ? "fail" : "pass", invalidRelationships.length ? 20 : 100, invalidRelationships.length ? `${invalidRelationships.length} invalid relationship(s)` : `${input.relationshipCount} relationship(s) inspected`, "Every join endpoint must belong to this definition.", "Remove or repair relationships with missing endpoints."),
    result("join-columns", "Relationships", "Join columns are selected", missingJoinColumns.length ? "fail" : "pass", missingJoinColumns.length ? 15 : 100, missingJoinColumns.length ? `${missingJoinColumns.length} relationship(s) reference missing selected columns` : "Every join column is selected", "Join endpoints must remain inside the governed field contract.", "Select both join columns or remove the relationship."),
    result("duplicate-relationships", "Relationships", "Duplicate relationships are resolved", duplicateRelationships.length ? "fail" : "pass", duplicateRelationships.length ? 20 : 100, duplicateRelationships.length ? `${duplicateRelationships.length} exact duplicate(s)` : "No exact duplicates", "Duplicate join edges create ambiguous query plans.", "Keep one canonical relationship per endpoint pair."),
    result("cardinality", "Relationships", "Cardinality matches key metadata", unsupportedCardinality.length ? "fail" : "pass", unsupportedCardinality.length ? 25 : 100, unsupportedCardinality.length ? `${unsupportedCardinality.length} unsupported cardinality mapping(s)` : "Cardinality is supported by selected key metadata", "Cardinality must agree with primary-key evidence; many-to-many requires an explicit bridge.", "Correct the relationship type or add a governed bridge table."),
    result("orphan-tables", "Relationships", "All tables have a join path", orphanTables.length ? "fail" : "pass", orphanTables.length ? 35 : 100, orphanTables.length ? `Orphan tables: ${orphanTables.join(", ")}` : "No orphan tables detected", "Disconnected tables can create Cartesian products or unusable fields.", "Add an accepted governed relationship for each orphan."),
    result("circular-dependencies", "Relationships", "Relationship graph is acyclic", circular ? "fail" : "pass", circular ? 20 : 100, circular ? "A circular dependency was detected" : "No circular dependency detected", "Cycles create multiple competing join paths.", "Choose one canonical path or mark an alternate relationship inactive."),
    result("business-mapping", "Business Mapping", "Business terms are mapped", hasBusinessMapping ? "pass" : "warning", hasBusinessMapping ? 100 : 62, `${input.glossaryMappings?.length ?? 0} explicit glossary mapping(s)`, "Business mappings make fields discoverable in natural-language and KPI workflows.", "Map dimensions to governed glossary terms."),
    result("business-rules", "Business Mapping", "Business rules are documented", (input.businessRules?.length ?? 0) > 0 ? "pass" : "warning", (input.businessRules?.length ?? 0) > 0 ? 100 : 70, `${input.businessRules?.length ?? 0} rule(s) documented`, "Rules explain filters, grain, exclusions, and aggregation behavior.", "Document at least one semantic business rule."),
    result("lineage", "Lineage", "Source lineage is traceable", lineageComplete ? "pass" : "warning", lineageComplete ? 100 : 60, lineageComplete ? "Governed source traceability present" : "Source traceability is incomplete", "Consumers must be able to trace virtual fields back to governed physical metadata.", "Add source schema/table lineage and rehydration source."),
    result("metadata", "Metadata", "Owner and descriptions are complete", metadataComplete ? "pass" : "warning", metadataComplete ? 100 : 68, metadataComplete ? `Owner: ${input.owner}` : "Owner or descriptions are incomplete", "Ownership and descriptions are required for accountable reuse.", "Assign an owner and describe every source or field group."),
    result("measure-readiness", "KPI Readiness", "Measures can be evaluated", hasMeasure ? "pass" : "fail", hasMeasure ? 100 : 35, `${input.measures?.length ?? 0} explicit measure(s)`, "KPI-ready datasets require a numeric source or governed measure definition.", "Add a numeric field or semantic measure."),
    result("admission-readiness", "KPI Readiness", "Admissions inputs are available", has("admissiondate", "admission_date", "socdate", "startofcare") ? "pass" : "warning", has("admissiondate", "admission_date", "socdate", "startofcare") ? 100 : 65, "Admission/start-of-care field detection", "Admissions KPIs require a governed event date.", "Map an admission or start-of-care date."),
    result("freshness", "Freshness", "Freshness metadata is current", freshnessAgeDays === null ? "warning" : freshnessAgeDays <= 7 ? "pass" : "warning", freshnessAgeDays === null ? 65 : freshnessAgeDays <= 7 ? 100 : 70, freshnessAgeDays === null ? "No freshness timestamp supplied" : `Metadata age: ${freshnessAgeDays} day(s)`, "This checks metadata freshness only; no source records are copied or persisted.", "Refresh governed source metadata before certification."),
    result("nullability", "Data Quality", "Required fields are identifiable", columns.some((column) => !column.nullable) ? "pass" : "warning", columns.some((column) => !column.nullable) ? 95 : 65, "Nullability profile inspected", "Required fields help establish expected record completeness.", "Mark keys and required KPI inputs as non-nullable where metadata supports it."),
  ];

  const categories = [...new Set(checks.map((check) => check.category))] as ValidationCategory[];
  const categoryScores = Object.fromEntries(categories.map((category) => {
    const categoryChecks = checks.filter((check) => check.category === category);
    return [category, Math.round(categoryChecks.reduce((sum, check) => sum + check.score, 0) / categoryChecks.length)];
  })) as Record<ValidationCategory, number>;
  const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
  const hardFailure = checks.some((check) => check.status === "fail");
  const status = hardFailure || score < 70 ? "Failed" : score >= 90 ? "Passed" : "Warning";
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const detectedKpis = [has("census", "patientdays", "service_date") && "Census", has("patientdays", "patient_days", "service_date") && "ADC", has("admissiondate", "socdate", "startofcare") && "Admissions", has("recert") && "Recertification", has("revenue", "amount") && "Revenue"].filter(Boolean) as string[];
  const missingInputs = [!has("admissiondate", "socdate", "startofcare") && "Admissions Date", !has("revenue", "amount") && "Revenue Amount", !has("branch") && "Branch Mapping"].filter(Boolean) as string[];
  const createdDate = new Date().toISOString();
  return { validationId: crypto.randomUUID(), datasetId: input.datasetId, score, grade, status, checks, categoryScores, detectedKpis, missingInputs, createdDate, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), virtual: true, authoritative: false };
}
