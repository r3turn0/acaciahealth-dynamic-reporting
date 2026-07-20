/**
 * POST /api/kpi/seed-reports
 *
 * Idempotently creates a default SavedReport + DashboardPin for every KPI
 * defined in kpiConfig.json. Called once on application first-load.
 *
 * Idempotency: each report name is derived from the KPI key so re-calling
 * produces no duplicates — existing records are detected and skipped.
 *
 * GET  /api/kpi/seed-reports  — returns seeding status without writing anything
 */

import { NextResponse } from "next/server";
import kpiConfig from "@/lib/config/kpiConfig.json";
import { SQL_LIBRARY } from "@/lib/config/sqlLibrary";
import { listReports, createReport } from "@/lib/services/reportService";
import { addPin, listPins } from "@/lib/agents/pinsRegistry";

// ── SQL template builder ──────────────────────────────────────────────────────

interface KpiDef {
  label:           string;
  description:     string;
  category:        string;
  aggregation:     string;
  source?:         string;
  formula?:        string;
  dimensions?:     string[];
  location_key?:   string;
  service_line_field?: string;
}

/**
 * Generates a branch-grain SQL template for a KPI definition.
 * The SQL is illustrative and parameterised — it will never execute against
 * the analytics source from this route.
 */
function buildSql(kpiKey: string, def: KpiDef): string {
  const source = def.source ?? "CLIENT_EPISODES_ALL";
  const aggLabel = def.label.replace(/'/g, "''");
  const formula  = def.formula ?? `/* ${def.aggregation} — see kpiConfig.json */`;

  // Source-specific FROM + JOIN patterns
  const fromClause = source === "PDGM_PERIOD"
    ? `FROM PDGM_PERIOD pdgm
JOIN CLIENT_EPISODES_ALL epi ON pdgm.episode_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`
    : source === "CLIENT_EPISODE_VISIT_NOTES"
    ? `FROM CLIENT_EPISODE_VISIT_NOTES vn
JOIN CLIENT_EPISODES_ALL epi ON vn.vn_episode_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`
    : source === "Billing.LINE_ITEMS"
    ? `FROM Billing.LINE_ITEMS li
JOIN CLIENT_EPISODES_ALL epi ON li.li_episode_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`
    : source === "WORKER_BASE"
    ? `FROM WORKER_BASE w
JOIN CLIENT_EPISODE_VISITS_ALL vis ON w.worker_id = vis.worker_id
JOIN CLIENT_EPISODES_ALL epi ON vis.episode_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`
    : `FROM CLIENT_EPISODES_ALL epi
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)`;

  return `-- Default report: ${aggLabel}
-- KPI: ${kpiKey}  |  Category: ${def.category}  |  Schema: v${kpiConfig._meta.schemaVersion}
-- Grain: ${kpiConfig._meta.reportingGrain}  |  Location key: ${def.location_key ?? kpiConfig._meta.primaryDimensionKey}
-- ---------------------------------------------------------------
SELECT TOP 50000
    RTRIM(b.branch_code)  AS branch_code,
    RTRIM(b.branch_name)  AS branch_name,
    RTRIM(b.region)       AS region,
    RTRIM(b.state)        AS state,
    epi.epi_slid          AS service_line_id,
    DATEPART(MONTH, ${
      source === "PDGM_PERIOD"     ? "pdgm.period_start_date" :
      source === "Billing.LINE_ITEMS" ? "li.li_service_date"  :
      "epi.epi_SocDate"
    }) AS period_month,
    DATEPART(YEAR,  ${
      source === "PDGM_PERIOD"     ? "pdgm.period_start_date" :
      source === "Billing.LINE_ITEMS" ? "li.li_service_date"  :
      "epi.epi_SocDate"
    }) AS period_year,
    ${formula} AS kpi_value
${fromClause}
WHERE ${
  source === "PDGM_PERIOD"        ? "pdgm.period_start_date BETWEEN @StartDate AND @EndDate" :
  source === "Billing.LINE_ITEMS" ? "li.li_service_date BETWEEN @StartDate AND @EndDate"     :
  "epi.epi_SocDate BETWEEN @StartDate AND @EndDate"
}
  AND epi.epi_slid IN (1, 2, 3)   -- HOME HEALTH, HOSPICE, PRIVATE DUTY
GROUP BY
    RTRIM(b.branch_code), RTRIM(b.branch_name),
    RTRIM(b.region), RTRIM(b.state),
    epi.epi_slid,
    DATEPART(MONTH, ${
      source === "PDGM_PERIOD"     ? "pdgm.period_start_date" :
      source === "Billing.LINE_ITEMS" ? "li.li_service_date"  :
      "epi.epi_SocDate"
    }),
    DATEPART(YEAR,  ${
      source === "PDGM_PERIOD"     ? "pdgm.period_start_date" :
      source === "Billing.LINE_ITEMS" ? "li.li_service_date"  :
      "epi.epi_SocDate"
    })
ORDER BY period_year DESC, period_month DESC, branch_name;`;
}

// ── Canonical report name ─────────────────────────────────────────────────────

function reportName(def: KpiDef): string {
  return `${def.label} by Branch`;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET() {
  const kpis    = kpiConfig.kpis as Record<string, KpiDef>;
  const reports = await listReports();
  const pins    = listPins();

  const existingNames = new Set(reports.map((r) => r.name));
  const pinnedRefs    = new Set(pins.map((p) => `kpi:${p.refId.toLowerCase()}`));

  const status = Object.entries(kpis).map(([key, def]) => ({
    kpiKey:       key,
    reportName:   reportName(def),
    reportExists: existingNames.has(reportName(def)),
    pinExists:    pinnedRefs.has(`kpi:${key}`),
  }));

  const seeded       = status.filter((s) => s.reportExists && s.pinExists).length;
  const totalKpis    = Object.keys(kpis).length;

  return NextResponse.json({
    schemaVersion: kpiConfig._meta.schemaVersion,
    totalKpis,
    seeded,
    pending:       totalKpis - seeded,
    status,
  });
}

export async function POST() {
  const kpis    = kpiConfig.kpis as Record<string, KpiDef>;
  const reports = await listReports();
  const pins    = listPins();

  const existingNames = new Set(reports.map((r) => r.name));
  const pinnedRefs    = new Set(pins.map((p) => `kpi:${p.refId.toLowerCase()}`));

  const created:  string[] = [];
  const skipped:  string[] = [];
  const pinned:   string[] = [];
  const errors:   { kpi: string; error: string }[] = [];

  for (const [kpiKey, def] of Object.entries(kpis)) {
    const name = reportName(def);

    // ── Create saved report ──────────────────────────────────────────────────
    let reportId: string | null = null;

    if (existingNames.has(name)) {
      skipped.push(kpiKey);
      const existing = reports.find((r) => r.name === name);
      reportId = existing?.id ?? null;
    } else {
      try {
        const report = await createReport({
          name,
          description: def.description,
          prompt:      `Show ${def.label.toLowerCase()} by branch and service line`,
          sql:         SQL_LIBRARY[kpiKey] ?? buildSql(kpiKey, def),
          kpi:         kpiKey,
          tags:        [kpiKey, def.category.toLowerCase().replace(/\s+/g, "_"), "default", "seeded"],
          visibility:  "team",
          created_by:  "system",
        });
        reportId = report.id;
        created.push(kpiKey);
      } catch (err) {
        errors.push({ kpi: kpiKey, error: String(err) });
        continue;
      }
    }

    // ── Pin to dashboard ─────────────────────────────────────────────────────
    const pinKey = `kpi:${kpiKey}`;
    if (!pinnedRefs.has(pinKey) && reportId) {
      try {
        addPin({
          type:      "kpi",
          refId:     kpiKey,
          title:     def.label,
          subtitle:  def.description,
          kpi:       kpiKey,
          meta: {
            category:    def.category,
            source:      def.source ?? "CLIENT_EPISODES_ALL",
            aggregation: def.aggregation,
            reportId,
            seeded:      true,
          },
          pinned_by: "system",
        });
        pinnedRefs.add(pinKey);
        pinned.push(kpiKey);
      } catch (err) {
        errors.push({ kpi: `pin:${kpiKey}`, error: String(err) });
      }
    }
  }

  const totalKpis = Object.keys(kpis).length;

  return NextResponse.json({
    success:  errors.length === 0,
    schemaVersion: kpiConfig._meta.schemaVersion,
    totalKpis,
    summary: {
      reportsCreated: created.length,
      reportsSkipped: skipped.length,
      pinned:         pinned.length,
      errors:         errors.length,
    },
    created,
    skipped,
    pinned,
    errors,
  });
}
