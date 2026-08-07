import { describe, expect, it } from "vitest";
import { analyzeWorkbookSheets, combineWorkbookSheets } from "@/lib/bi/inference";

const sheets = [
  {
    name: "Operations",
    fields: [
      { name: "Service Line", type: "string" as const },
      { name: "Visits", type: "number" as const },
    ],
    rows: [{ "Service Line": "Outpatient", Visits: 12 }],
  },
  {
    name: "Finance",
    fields: [
      { name: "Service Line", type: "string" as const },
      { name: "Revenue", type: "number" as const },
    ],
    rows: [{ "Service Line": "Outpatient", Revenue: 4500 }],
  },
];

describe("combineWorkbookSheets", () => {
  it("unions every worksheet and preserves worksheet provenance", () => {
    const combined = combineWorkbookSheets(sheets, "Executive Workbook");

    expect(combined.name).toBe("Executive Workbook");
    expect(combined.rows).toHaveLength(2);
    expect(combined.fields.map((field) => field.name)).toEqual([
      "Worksheet",
      "Service Line",
      "Visits",
      "Revenue",
    ]);
    expect(combined.rows).toEqual([
      { Worksheet: "Operations", "Service Line": "Outpatient", Visits: 12, Revenue: null },
      { Worksheet: "Finance", "Service Line": "Outpatient", Visits: null, Revenue: 4500 },
    ]);
  });
});

describe("analyzeWorkbookSheets", () => {
  it("reports worksheet coverage, shared fields, relationships, and formulas", () => {
    const analysis = analyzeWorkbookSheets(sheets, [
      { sheet: "Finance", cell: "C2", expression: "Operations!B2*10", referencedSheets: ["Operations"] },
    ]);

    expect(analysis.sheetCount).toBe(2);
    expect(analysis.totalRows).toBe(2);
    expect(analysis.sharedFields).toEqual(["Service Line"]);
    expect(analysis.relationshipCandidates).toEqual([
      { field: "Service Line", sheets: ["Operations", "Finance"] },
    ]);
    expect(analysis.formulas).toHaveLength(1);
    expect(analysis.sheets.map((sheet) => sheet.name)).toEqual(["Operations", "Finance"]);
  });
});
