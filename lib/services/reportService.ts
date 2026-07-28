/**
 * reportService — Full CRUD for saved reports, dataset snapshots, pins,
 * execution history, and versioning.
 *
 * Separation contract
 * -------------------
 *   ONLY uses AppDataClient (PostgreSQL / in-memory).
 *   NEVER imports ReadOnlyDataClient or queries the analytics data source.
 *
 * This is the authoritative layer for all application state persistence.
 * The existing lib/agents/reportRegistry.ts and lib/agents/pinsRegistry.ts are
 * delegated to from here for backwards-compatibility, while new callers should
 * use this service directly.
 */

import { createHash } from "crypto";
import * as AppDB from "@/lib/db/appClient";
import type { DataRow } from "./datasetService";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Visibility = "private" | "team" | "public";
export type ReportStatus = "draft" | "published" | "archived";

export interface ReportVersion {
  version: number;
  saved_at: string;
  saved_by: string;
  note: string;
  sql_snapshot: string;
  metadata_snapshot: Record<string, unknown>;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
  visibility: Visibility;
  status: ReportStatus;
  created_by: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
  version: number;
  version_history: ReportVersion[];
}

export interface DatasetSnapshot {
  id: string;
  report_id: string;
  rows: DataRow[];
  row_count: number;
  columns: string[];
  query_definition: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
}

export interface ExecutionRecord {
  id: string;
  report_id: string;
  ran_at: string;
  ran_by: string;
  row_count: number;
  execution_ms: number;
  cache_hit: boolean;
  demo_mode: boolean;
  snapshot_id: string | null;
}

const REPORT_TABLE = "saved_reports";
const SNAPSHOT_TABLE = "dataset_snapshots";
const EXEC_TABLE = "report_executions";

// ── In-memory mirrors (fallback when Postgres is not connected) ───────────────

const reportStore = new Map<string, SavedReport>();
const snapshotStore = new Map<string, DatasetSnapshot>();
const execStore = new Map<string, ExecutionRecord>();
let _seeded = false;

function seedDemos() {
  if (_seeded || reportStore.size > 0) return;
  _seeded = true;

  const now = new Date().toISOString();
  const demos: Omit<SavedReport, "id">[] = [
    {
      name: "Weekly Admissions by Branch",
      description: "SOC admissions per branch per week for any date range",
      prompt: "Show weekly admissions grouped by hospice region",
      sql: `SELECT TOP 10000
    RTRIM(b.branch_name) AS branch_name,
    DATEPART(WEEK, epi.epi_SocDate) AS week_number,
    COUNT(*) AS admissions
FROM CLIENT_EPISODES_ALL epi
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(b.branch_name), DATEPART(WEEK, epi.epi_SocDate)
ORDER BY week_number, branch_name`,
      kpi: "admissions",
      tags: ["admissions", "branch", "weekly"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 7 * 86400000).toISOString(),
      last_run_date: new Date(Date.now() - 2 * 3600000).toISOString(),
      run_count: 14,
      last_row_count: 42,
      version: 2,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 7 * 86400000).toISOString(),
          saved_by: "system", note: "Initial report",
          sql_snapshot: "SELECT * FROM CLIENT_EPISODES_ALL",
          metadata_snapshot: {},
        },
        {
          version: 2, saved_at: new Date(Date.now() - 3 * 86400000).toISOString(),
          saved_by: "analyst", note: "Added branch join and week grouping",
          sql_snapshot: "SELECT TOP 10000 RTRIM(b.branch_name)...",
          metadata_snapshot: { tags: ["admissions"] },
        },
      ],
    },
    {
      name: "Revenue WTD by Branch",
      description: "Week-to-date billed revenue grouped by branch",
      prompt: "Weekly revenue by branch for home health",
      sql: `SELECT TOP 10000
    RTRIM(b.branch_name) AS branch_name,
    DATEPART(WEEK, li.li_service_date) AS week_number,
    SUM(li.li_amount) AS revenue
FROM Billing.LINE_ITEMS li
JOIN CLIENT_EPISODES_ALL epi ON li.li_epi_id = epi.epi_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE li.li_service_date BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(b.branch_name), DATEPART(WEEK, li.li_service_date)
ORDER BY week_number, branch_name`,
      kpi: "revenue",
      tags: ["revenue", "branch", "weekly"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 3 * 86400000).toISOString(),
      last_run_date: new Date(Date.now() - 5 * 3600000).toISOString(),
      run_count: 8,
      last_row_count: 18,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 3 * 86400000).toISOString(),
          saved_by: "system", note: "Initial revenue report",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },
    {
      name: "Active Census by Care Type",
      description: "Distinct active patient count grouped by care type",
      prompt: "Active patient census by care type",
      sql: `SELECT TOP 10000
    RTRIM(ct.ct_name) AS care_type,
    COUNT(DISTINCT epi.epi_id) AS census
FROM CLIENT_EPISODES_ALL epi
JOIN CARE_TYPES ct ON epi.epi_care_type_id = ct.ct_id
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY RTRIM(ct.ct_name)
ORDER BY census DESC`,
      kpi: "census",
      tags: ["census", "care_type"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 86400000).toISOString(),
      last_run_date: new Date(Date.now() - 86400000).toISOString(),
      run_count: 3,
      last_row_count: 12,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 86400000).toISOString(),
          saved_by: "system", note: "Initial census report",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Recerts ───────────────────────────────────────────────────────────────
    {
      name: "Recerts — Cert Window",
      description: "Recertification count and rate by branch for certifications starting within the window.",
      prompt: "Recert count and rate by branch for certs starting in the date window",
      sql: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS
(
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        e.epi_RecertFlag,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        CASE 
            WHEN UPPER(LTRIM(RTRIM(e.epi_RecertFlag))) IN ('Y','1','R','RECERT','TRUE')
            THEN 1 ELSE 0
        END AS is_recert
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'RECERTIFIED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(bucket, '(unmapped)')      AS bucket,
    MIN(bucket_sort)                  AS bucket_sort,
    @StartDate                        AS window_start,
    @EndDate                          AS window_end,
    SUM(is_recert)                    AS recert_count,
    COUNT(*)                          AS total_cert_count,
    CAST(
        CASE WHEN COUNT(*) > 0
             THEN SUM(is_recert) * 100.0 / COUNT(*)
             ELSE NULL
        END AS decimal(5,1)
    ) AS recert_pct
FROM episodes
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
      kpi: "recerts",
      tags: ["recerts", "certification", "branch"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },
    {
      name: "Recerts — Active Episodes",
      description: "Recertification count and rate by branch across all active episodes overlapping the window.",
      prompt: "Recert count and rate by branch across all active episodes in the date window",
      sql: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS
(
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        CASE 
            WHEN UPPER(LTRIM(RTRIM(e.epi_RecertFlag))) IN ('Y','1','R','RECERT','TRUE')
             AND CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_recert_in_window
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'RECERTIFIED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS date) <= @EndDate
      AND (e.epi_DischargeDate IS NULL OR CAST(e.epi_DischargeDate AS date) >= @StartDate)
)
SELECT
    ISNULL(bucket, '(unmapped)')      AS bucket,
    MIN(bucket_sort)                  AS bucket_sort,
    @StartDate                        AS window_start,
    @EndDate                          AS window_end,
    SUM(is_recert_in_window)          AS recert_count,
    COUNT(*)                          AS total_episode_count,
    CAST(
        CASE WHEN COUNT(*) > 0
             THEN SUM(is_recert_in_window) * 100.0 / COUNT(*)
             ELSE NULL
        END AS decimal(5,1)
    ) AS recert_pct_of_episodes
FROM episodes
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
      kpi: "recerts",
      tags: ["recerts", "certification", "branch", "active episodes"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Hospice Census Equivalent ─────────────────────────────────────────────
    {
      name: "Hospice Census Equivalent",
      description: "HCE per branch, HH+Palliative combined HCE, and total HCE across all locations.",
      prompt: "Hospice Census Equivalent by branch and service line as of today",
      sql: `USE HCHB_AcaciaHealth;

WITH dim_branch AS (
    SELECT *
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS d(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        e.epi_NonAdmitDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status <> 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),
census AS (
    SELECT
        service_line,
        branch_name,
        COUNT(*) AS current_census
    FROM episodes
    WHERE epi_SocDate <= @AsOfDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
    GROUP BY service_line, branch_name
)
SELECT
    branch_name AS bucket,
    service_line,
    @AsOfDate AS as_of_date,
    @HceFactor AS hce_factor,
    current_census AS raw_census,
    CAST(
        CASE
            WHEN service_line = 'HOME HEALTH'
                THEN current_census * @HceFactor
            ELSE current_census
        END AS decimal(10,2)
    ) AS hce_value
FROM census`,
      kpi: "census",
      tags: ["census", "hce", "hospice", "home health", "branch"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Avg Admittance Referrals ──────────────────────────────────────────────
    {
      name: "Avg Admittance Referrals",
      description: "Average days from referral to admission and percentage admitted within 2 days, by branch.",
      prompt: "Average days from referral to admission by branch",
      sql: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS
(
    SELECT
        e.epi_id,
        e.epi_DateOfReferral,
        e.epi_SocDate,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status = 'CURRENT'
    AND e.epi_AdmitType = 'NEW ADMISSION'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_DateOfReferral IS NOT NULL
      AND e.epi_SocDate IS NOT NULL
      AND CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
),
metrics AS
(
    SELECT
        bucket,
        bucket_sort,
        DATEDIFF(DAY, epi_DateOfReferral, epi_SocDate) AS days_to_admit
    FROM episodes
    WHERE CAST(epi_SocDate AS date)
    >= CAST(epi_DateOfReferral AS date)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS branch,
    MIN(bucket_sort) AS service_line,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admissions,
    CAST(AVG(days_to_admit * 1.0) AS decimal(10,2)) AS avg_days_to_admit,
    CAST(
        SUM(CASE WHEN days_to_admit <= 2 THEN 1 ELSE 0 END) * 100.0
        / COUNT(*)
        AS decimal(5,2)
    ) AS pct_within_2_days
FROM metrics
GROUP BY bucket
ORDER BY service_line, branch`,
      kpi: "admissions",
      tags: ["admissions", "referrals", "branch", "time-to-admit"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Admissions — by Service Line ─────────────────────────────────────────
    {
      name: "Admissions by Service Line",
      description: "New admission count grouped by service line bucket for the date window.",
      prompt: "Admissions by service line for the date window",
      sql: `USE HCHB_AcaciaHealth
;WITH bucket_map AS (
    SELECT * FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS m(sl_name, sl_id, branch_code, bucket)
),
episodes AS (
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        e.epi_NonAdmitDate,
        bm.bucket,
        CASE 
            WHEN bm.sl_name = 'HOME HEALTH' THEN 1
            WHEN bm.sl_name = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN bucket_map bm
        ON bm.sl_id = e.epi_slid
       AND (bm.branch_code IS NULL OR bm.branch_code = e.epi_branchcode)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_AdmitType = 'NEW ADMISSION'
)
SELECT  
    ISNULL(bucket, '(unmapped)') AS service_line,
    MIN(bucket_sort) AS service_line_id,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admission_count
FROM episodes
WHERE CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
GROUP BY bucket
ORDER BY service_line, service_line_id`,
      kpi: "admissions",
      tags: ["admissions", "service line"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },
    {
      name: "Admissions by Care Type (Home Health)",
      description: "New Home Health admissions broken down by primary care type for the date window.",
      prompt: "Home health admissions by care type",
      sql: `USE HCHB_AcaciaHealth
;WITH bucket_map AS (
    SELECT * FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS m(sl_name, sl_id, branch_code, bucket)
),
episodes AS (
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        bm.bucket,
        CASE 
            WHEN bm.sl_name = 'HOME HEALTH' THEN 1
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    JOIN SERVICE_LINES sl ON sl.sl_id = e.epi_slid
    LEFT JOIN bucket_map bm
        ON bm.sl_id = e.epi_slid
       AND (bm.branch_code IS NULL OR bm.branch_code = e.epi_branchcode)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_AdmitType = 'NEW ADMISSION'
      AND bm.sl_name = 'HOME HEALTH'
)
SELECT  
    e.bucket as service_line,
    MIN(e.bucket_sort) AS service_line_id,
    ISNULL(ct.ctype_description, '(no primary care type)') AS care_type,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admission_count
FROM episodes e
LEFT JOIN dbo.CLIENT_EPISODE_CARE_TYPES cect
    ON cect.cect_epiid = e.epi_id
   AND cect.cect_primary = 'Y'
LEFT JOIN dbo.CARE_TYPES ct
    ON ct.ctype_id = cect.cect_ctypeid
WHERE CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
GROUP BY e.bucket, ISNULL(ct.ctype_description, '(no primary care type)')
ORDER BY care_type`,
      kpi: "admissions",
      tags: ["admissions", "care type", "home health"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Census and ADC ────────────────────────────────────────────────────────
    {
      name: "Census and ADC",
      description: "Current census by branch and service line, plus average daily census (ADC) over a date window.",
      prompt: "Current census and average daily census by branch",
      sql: `USE HCHB_AcaciaHealth;

WITH dim_branch AS
(
    SELECT *
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) d(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS
(
    SELECT
        e.epi_paid,
        e.epi_id,
        e.epi_slid,
        e.epi_branchcode,
        e.epi_SocDate,
        e.epi_DischargeDate,
        e.epi_NonAdmitDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
)
SELECT
    ISNULL(service_line,'(unmapped)') AS service_line,
    ISNULL(branch_name,'(unmapped)')  AS branch_name,
    @AsOfDate                         AS as_of_date,
    COUNT(DISTINCT epi_paid)          AS current_census
FROM episodes
WHERE epi_SocDate <= @AsOfDate
  AND (
        epi_DischargeDate IS NULL
        OR epi_DischargeDate > @AsOfDate
      )
GROUP BY
    service_line,
    branch_name
ORDER BY
    service_line,
    branch_name`,
      kpi: "census",
      tags: ["census", "ADC", "branch", "service line"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },

    // ── Census and ADC by Service Line and Branch ─────────────────────────────
    {
      name: "Census and ADC by Service Line and Branch",
      description: "Daily census by service line and branch using a recursive date spine, grouped for ADC calculation.",
      prompt: "Daily census and ADC by service line and branch over a date window",
      sql: `USE HCHB_AcaciaHealth
WITH dates AS
(
    SELECT @StartDate AS CensusDate
    UNION ALL
    SELECT DATEADD(DAY,1,CensusDate)
    FROM dates
    WHERE CensusDate < @EndDate
)
SELECT
    d.CensusDate,
    sl.sl_desc,
    b.branch_name,
    COUNT(DISTINCT epi.epi_paid) AS DailyCensus
FROM dates d
JOIN CLIENT_EPISODES_ALL epi
    ON epi.epi_status = 'CURRENT'
   AND epi.epi_SocDate <= d.CensusDate
   AND (
        epi.epi_DischargeDate IS NULL
        OR epi.epi_DischargeDate > d.CensusDate
       )
JOIN SERVICE_LINES sl
    ON epi.epi_slid = sl.sl_id
JOIN BRANCHES b
    ON RTRIM(epi.epi_branchcode)=RTRIM(b.branch_code)
GROUP BY
    d.CensusDate,
    sl.sl_desc,
    b.branch_name`,
      kpi: "census",
      tags: ["census", "ADC", "branch", "service line", "daily"],
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [
        {
          version: 1, saved_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          saved_by: "system", note: "Initial save",
          sql_snapshot: "",
          metadata_snapshot: {},
        },
      ],
    },
  ];

  for (const d of demos) {
    const id = createHash("sha256")
      .update(d.name + d.created_date)
      .digest("hex")
      .slice(0, 12);
    reportStore.set(id, { id, ...d });
  }
}

// ── CRUD: Reports ─────────────────────────────────────────────────────────────

export async function listReports(): Promise<SavedReport[]> {
  seedDemos();
  try {
    const rows = await AppDB.list<SavedReport>(REPORT_TABLE, { orderBy: "created_date" });
    if (rows.length > 0) return rows;
  } catch { /* fall through */ }
  return Array.from(reportStore.values()).sort(
    (a, b) => b.created_date.localeCompare(a.created_date)
  );
}

export async function getReport(id: string): Promise<SavedReport | null> {
  seedDemos();
  try {
    const row = await AppDB.findById<SavedReport>(REPORT_TABLE, id);
    if (row) return row;
  } catch { /* fall through */ }
  return reportStore.get(id) ?? null;
}

export interface CreateReportInput {
  name: string;
  description?: string;
  prompt?: string;
  sql: string;
  kpi?: string;
  tags?: string[];
  visibility?: Visibility;
  created_by?: string;
}

export async function createReport(input: CreateReportInput): Promise<SavedReport> {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(input.name + now + Math.random())
    .digest("hex")
    .slice(0, 12);

  const firstVersion: ReportVersion = {
    version: 1,
    saved_at: now,
    saved_by: input.created_by ?? "analyst",
    note: "Initial save",
    sql_snapshot: input.sql,
    metadata_snapshot: { kpi: input.kpi, tags: input.tags },
  };

  const report: SavedReport = {
    id,
    name: input.name,
    description: input.description ?? "",
    prompt: input.prompt ?? "",
    sql: input.sql,
    kpi: input.kpi ?? "custom",
    tags: input.tags ?? [],
    visibility: input.visibility ?? "private",
    status: "draft",
    created_by: input.created_by ?? "analyst",
    created_date: now,
    last_run_date: null,
    run_count: 0,
    last_row_count: null,
    version: 1,
    version_history: [firstVersion],
  };

  try {
    await AppDB.insert(REPORT_TABLE, report as unknown as AppDB.AppRecord);
  } catch { /* fall through */ }
  reportStore.set(id, report);

  // Mirror into the legacy reportRegistry for backwards compat with existing routes
  try {
    const { saveReport } = await import("@/lib/agents/reportRegistry");
    saveReport({
      name: report.name,
      description: report.description,
      prompt: report.prompt,
      sql: report.sql,
      kpi: report.kpi,
      tags: report.tags,
      created_by: report.created_by,
    });
  } catch { /* non-critical */ }

  return report;
}

export interface UpdateReportInput {
  name?: string;
  description?: string;
  sql?: string;
  kpi?: string;
  tags?: string[];
  visibility?: Visibility;
  status?: ReportStatus;
  /** Provide a note to create a new version history entry. */
  versionNote?: string;
  updated_by?: string;
}

export async function updateReport(
  id: string,
  patch: UpdateReportInput
): Promise<SavedReport | null> {
  seedDemos();
  const existing = reportStore.get(id) ?? (await getReport(id));
  if (!existing) return null;

  const now = new Date().toISOString();
  let { version, version_history } = existing;

  // Bump version when SQL or a version note is provided
  if (patch.sql || patch.versionNote) {
    version += 1;
    version_history = [
      ...version_history,
      {
        version,
        saved_at: now,
        saved_by: patch.updated_by ?? "analyst",
        note: patch.versionNote ?? `Version ${version}`,
        sql_snapshot: patch.sql ?? existing.sql,
        metadata_snapshot: {
          kpi: patch.kpi ?? existing.kpi,
          tags: patch.tags ?? existing.tags,
        },
      },
    ];
  }

  const updated: SavedReport = {
    ...existing,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    sql: patch.sql ?? existing.sql,
    kpi: patch.kpi ?? existing.kpi,
    tags: patch.tags ?? existing.tags,
    visibility: patch.visibility ?? existing.visibility,
    status: patch.status ?? existing.status,
    version,
    version_history,
  };

  try {
    await AppDB.update(REPORT_TABLE, id, updated as unknown as AppDB.AppRecord);
  } catch { /* fall through */ }
  reportStore.set(id, updated);
  return updated;
}

export async function deleteReport(id: string): Promise<boolean> {
  try { await AppDB.remove(REPORT_TABLE, id); } catch { /* ignore */ }
  return reportStore.delete(id);
}

// ── Dataset Snapshots ─────────────────────────────────────────────────────────

/**
 * Save a dataset snapshot for a report (the actual result rows).
 * Snapshots expire after `ttlDays` days (default 7).
 */
export async function saveDatasetSnapshot(
  reportId: string,
  rows: DataRow[],
  queryDefinition: Record<string, unknown>,
  ttlDays = 7
): Promise<DatasetSnapshot> {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`${reportId}:${now}`)
    .digest("hex")
    .slice(0, 12);

  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const snapshot: DatasetSnapshot = {
    id,
    report_id: reportId,
    rows,
    row_count: rows.length,
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    query_definition: queryDefinition,
    created_at: now,
    expires_at: expiresAt,
  };

  try {
    await AppDB.insert(SNAPSHOT_TABLE, snapshot as unknown as AppDB.AppRecord);
  } catch { /* fall through */ }
  snapshotStore.set(id, snapshot);
  return snapshot;
}

export async function getLatestSnapshot(reportId: string): Promise<DatasetSnapshot | null> {
  try {
    const rows = await AppDB.list<DatasetSnapshot>(SNAPSHOT_TABLE, {
      where: { column: "report_id", value: reportId },
      orderBy: "created_at",
      limit: 1,
    });
    if (rows[0]) return rows[0];
  } catch { /* fall through */ }
  const all = Array.from(snapshotStore.values())
    .filter((s) => s.report_id === reportId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return all[0] ?? null;
}

// ── Execution History ─────────────────────────────────────────────────────────

export async function recordExecution(
  reportId: string,
  opts: {
    rowCount: number;
    executionMs: number;
    cacheHit?: boolean;
    demoMode?: boolean;
    snapshotId?: string | null;
    ran_by?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`${reportId}:${now}`)
    .digest("hex")
    .slice(0, 12);

  const record: ExecutionRecord = {
    id,
    report_id: reportId,
    ran_at: now,
    ran_by: opts.ran_by ?? "analyst",
    row_count: opts.rowCount,
    execution_ms: opts.executionMs,
    cache_hit: opts.cacheHit ?? false,
    demo_mode: opts.demoMode ?? false,
    snapshot_id: opts.snapshotId ?? null,
  };

  try {
    await AppDB.insert(EXEC_TABLE, record as unknown as AppDB.AppRecord);
  } catch { /* fall through */ }
  execStore.set(id, record);

  // Update report metadata
  const report = reportStore.get(reportId) ?? (await getReport(reportId));
  if (report) {
    const updated: SavedReport = {
      ...report,
      run_count: report.run_count + 1,
      last_run_date: now,
      last_row_count: opts.rowCount,
    };
    reportStore.set(reportId, updated);
    try {
      await AppDB.update(REPORT_TABLE, reportId, {
        run_count: updated.run_count,
        last_run_date: now,
        last_row_count: opts.rowCount,
      } as AppDB.AppRecord);
    } catch { /* non-critical */ }
  }
}

export async function getExecutionHistory(reportId?: string): Promise<ExecutionRecord[]> {
  try {
    const rows = reportId
      ? await AppDB.list<ExecutionRecord>(EXEC_TABLE, {
          where: { column: "report_id", value: reportId },
          orderBy: "ran_at",
        })
      : await AppDB.list<ExecutionRecord>(EXEC_TABLE, { orderBy: "ran_at" });
    if (rows.length > 0) return rows;
  } catch { /* fall through */ }
  const all = Array.from(execStore.values());
  const filtered = reportId ? all.filter((r) => r.report_id === reportId) : all;
  return filtered.sort((a, b) => b.ran_at.localeCompare(a.ran_at)).slice(0, 50);
}

// ── Pins ──────────────────────────────────────────────────────────────────────
// Thin wrappers that delegate to the existing pinsRegistry but mirror to AppDB.

export async function pinReport(
  reportId: string,
  pinnedBy = "analyst"
): Promise<void> {
  const report = await getReport(reportId);
  if (!report) return;
  try {
    const { addPin } = await import("@/lib/agents/pinsRegistry");
    addPin({
      type: "report",
      refId: reportId,
      title: report.name,
      subtitle: report.description || `${report.kpi} report`,
      kpi: report.kpi,
      meta: { sql: report.sql, prompt: report.prompt },
      pinned_by: pinnedBy,
    });
  } catch { /* non-critical */ }
}

export async function unpinReport(reportId: string): Promise<void> {
  try {
    const { removePinByRef } = await import("@/lib/agents/pinsRegistry");
    removePinByRef("report", reportId);
  } catch { /* non-critical */ }
}
