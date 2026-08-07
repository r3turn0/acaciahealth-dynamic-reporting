import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const workbookPath = path.resolve("data/KPI-Scorecard-67-ad39de.xlsx");
const workbook = XLSX.readFile(workbookPath, { cellDates: true });

const noise = /^(kpi|metric|measure|target|actual|goal|benchmark|notes?|category|department|owner|status|month|period|total|scorecard)$/i;
const kpiSignal = /(rate|ratio|days?|hours?|census|admission|discharge|revenue|margin|referral|conversion|length of stay|los|adc|rpd|lupa|productivity|compliance|timeliness|turnover|vacancy|quality|visit|patient|claim|billing|receivable|unbilled|incident|infection|fall|satisfaction)/i;
const aliases = {
  "average daily census": ["ADC"],
  "revenue per patient day": ["RPD"],
  "length of stay": ["LOS"],
  "not taken under care": ["NTUC"],
  "accounts receivable": ["AR"],
};

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/^[-–—:]+|[-–—:]+$/g, "").trim();
}

function slug(value) {
  return normalize(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function categoryFor(sheet, label) {
  const text = `${sheet} ${label}`.toLowerCase();
  if (/(revenue|margin|billing|receivable|financial|lupa|unbilled)/.test(text)) return "Financial Performance";
  if (/(workforce|employee|staff|productivity|turnover|vacancy)/.test(text)) return "Workforce Performance";
  if (/(quality|compliance|timeliness|infection|fall|incident|satisfaction|qa)/.test(text)) return "Clinical Quality";
  if (/(referral|conversion|ntuc)/.test(text)) return "Referral Management";
  if (/(administrator|executive|scorecard)/.test(text)) return "Executive";
  return "Operations";
}

const candidates = [];
for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: false });
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < Math.min(row.length, 5); columnIndex++) {
      const label = normalize(row[columnIndex]);
      if (!label || label.length < 4 || label.length > 120 || noise.test(label) || !kpiSignal.test(label)) continue;
      const values = row.slice(columnIndex + 1).map(normalize).filter(Boolean);
      const benchmark = values.find((value) => /[%$]|\b(day|hour|target|goal)\b/i.test(value)) ?? null;
      const normalizedLabel = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
      candidates.push({
        id: slug(normalizedLabel),
        label: normalizedLabel,
        category: categoryFor(sheetName, normalizedLabel),
        status: "Draft",
        discoveryState: "Discovered",
        formula: "Pending governed formula validation",
        source: "CLIENT_EPISODES_ALL",
        sourceColumns: [],
        dimensions: ["Service Line", "Branch Code", "Branch Name"],
        cadence: /month/i.test(values.join(" ")) ? "Monthly" : "Scorecard cadence",
        benchmark,
        aliases: aliases[normalizedLabel.toLowerCase()] ?? [],
        provenance: { sourceFile: path.basename(workbookPath), worksheet: sheetName, row: rowIndex + 1 },
        validation: { status: "unverified", confidence: 0, variance: null, reason: "Discovered label; formula and source mapping require steward validation." },
      });
      break;
    }
  }
}

const deduped = new Map();
for (const candidate of candidates) {
  const key = candidate.id.replace(/^(total|average|avg)_/, "");
  const existing = deduped.get(key);
  if (!existing) deduped.set(key, candidate);
  else {
    existing.aliases = [...new Set([...existing.aliases, candidate.label])];
    existing.provenance = { ...existing.provenance, worksheets: [...new Set([existing.provenance.worksheet, candidate.provenance.worksheet])] };
  }
}

const artifact = {
  correlationId: "acacia-reporting-enhancement-v1",
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(workbookPath),
  worksheetCount: workbook.SheetNames.length,
  worksheets: workbook.SheetNames,
  candidateCount: deduped.size,
  candidates: [...deduped.values()].sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label)),
};
fs.writeFileSync(path.resolve("lib/config/scorecardDiscovery.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Generated ${artifact.candidateCount} candidates from ${artifact.worksheetCount} worksheets.`);
