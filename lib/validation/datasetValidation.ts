export type ValidationCategory = "Schema" | "Relationships" | "Business Mapping" | "KPI Readiness" | "Data Quality";
export type ValidationCheck = { id: string; category: ValidationCategory; label: string; status: "pass" | "warning" | "fail"; score: number; detail: string };
export type DatasetValidation = { validationId: string; datasetId: string; score: number; status: "Passed" | "Warning" | "Failed"; checks: ValidationCheck[]; detectedKpis: string[]; missingInputs: string[]; createdDate: string };

type Input = { datasetId: string; tables: Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPk: boolean }> }>; relationshipCount: number };
export function validateDataset(input: Input): DatasetValidation {
  const names = input.tables.flatMap((table) => table.columns.map((column) => column.name.toLowerCase()));
  const has = (...terms: string[]) => names.some((name) => terms.some((term) => name.includes(term)));
  const checks: ValidationCheck[] = [
    { id: "column-names", category: "Schema", label: "Column names are defined", status: names.length ? "pass" : "fail", score: names.length ? 100 : 0, detail: `${names.length} columns inspected` },
    { id: "primary-keys", category: "Schema", label: "Primary keys are present", status: input.tables.every((table) => table.columns.some((column) => column.isPk)) ? "pass" : "warning", score: input.tables.every((table) => table.columns.some((column) => column.isPk)) ? 100 : 75, detail: "Each source table should expose a stable business key" },
    { id: "relationships", category: "Relationships", label: "Source relationships are mapped", status: input.tables.length <= 1 || input.relationshipCount > 0 ? "pass" : "fail", score: input.tables.length <= 1 || input.relationshipCount > 0 ? 100 : 40, detail: `${input.relationshipCount} accepted relationships` },
    { id: "branch-mapping", category: "Business Mapping", label: "Branch mapping exists", status: has("branch") ? "pass" : "warning", score: has("branch") ? 100 : 70, detail: has("branch") ? "Branch dimension detected" : "Add BranchId or BranchCode" },
    { id: "episode-mapping", category: "Business Mapping", label: "Episode or patient mapping exists", status: has("episode", "epi_", "patient", "client") ? "pass" : "warning", score: has("episode", "epi_", "patient", "client") ? 100 : 70, detail: "Required for patient-level KPI reconciliation" },
    { id: "adc-readiness", category: "KPI Readiness", label: "Census and ADC inputs", status: has("census", "patientdays", "patient_days", "service_date") ? "pass" : "warning", score: has("census", "patientdays", "patient_days", "service_date") ? 100 : 72, detail: "Patient Days or daily census grain enables ADC" },
    { id: "admission-readiness", category: "KPI Readiness", label: "Admissions date input", status: has("admissiondate", "admission_date", "socdate", "startofcare") ? "pass" : "warning", score: has("admissiondate", "admission_date", "socdate", "startofcare") ? 100 : 65, detail: "Admissions requires an admission or start-of-care date" },
    { id: "nullability", category: "Data Quality", label: "Required fields are non-nullable", status: input.tables.some((table) => table.columns.some((column) => !column.nullable)) ? "pass" : "warning", score: 92, detail: "Nullability profile inspected" },
  ];
  const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
  const detectedKpis = [has("census", "patientdays", "service_date") && "Census", has("patientdays", "patient_days", "service_date") && "ADC", has("admissiondate", "socdate", "startofcare") && "Admissions", has("recert") && "Recertification"].filter(Boolean) as string[];
  const missingInputs = [!has("admissiondate", "socdate", "startofcare") && "Admissions Date", !has("revenue", "amount") && "Revenue Amount", !has("branch") && "Branch Mapping"].filter(Boolean) as string[];
  return { validationId: crypto.randomUUID(), datasetId: input.datasetId, score, status: score >= 90 ? "Passed" : score >= 70 ? "Warning" : "Failed", checks, detectedKpis, missingInputs, createdDate: new Date().toISOString() };
}
