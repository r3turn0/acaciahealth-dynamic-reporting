import { describe, expect, it } from "vitest";
import { combineWorkbookSheets } from "@/lib/bi/inference";

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
