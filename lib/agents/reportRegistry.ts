/**
 * Report Registry Agent
 * Persists saved reports to an in-process store (upgradeable to DB when SQL_CONNECTION_STRING is set).
 * Mirrors the DynamicReports table contract from the spec.
 */

import { createHash } from "crypto";

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  tags: string[];
  created_by: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
}

export interface ExecutionHistoryEntry {
  id: string;
  report_id: string;
  ran_at: string;
  row_count: number;
  execution_ms: number;
  cache_hit: boolean;
  demo_mode: boolean;
}

// ── In-memory store (replace with DB queries when SQL is live) ────────────────

const reportStore = new Map<string, SavedReport>();
const executionHistory: ExecutionHistoryEntry[] = [];

// Seed with a few demo reports on first load
function seedDemoReports() {
  if (reportStore.size > 0) return;

  const demos: Omit<SavedReport, "id">[] = [
    {
      name: "Weekly Admissions by Branch",
      description: "Counts SOC admissions per branch per week for any date range",
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
      created_by: "system",
      created_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      run_count: 14,
      last_row_count: 42,
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
      created_by: "system",
      created_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      run_count: 8,
      last_row_count: 18,
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
      created_by: "system",
      created_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      last_run_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      run_count: 3,
      last_row_count: 12,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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
      created_by: "system",
      created_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
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

// ── CRUD operations ───────────────────────────────────────────────────────────

export function listReports(): SavedReport[] {
  seedDemoReports();
  return Array.from(reportStore.values()).sort(
    (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
  );
}

export function getReport(id: string): SavedReport | null {
  seedDemoReports();
  return reportStore.get(id) ?? null;
}

export function saveReport(
  input: Omit<SavedReport, "id" | "created_date" | "run_count" | "last_row_count" | "last_run_date">
): SavedReport {
  const id = createHash("sha256")
    .update(input.name + new Date().toISOString())
    .digest("hex")
    .slice(0, 12);

  const report: SavedReport = {
    id,
    ...input,
    created_date: new Date().toISOString(),
    last_run_date: null,
    run_count: 0,
    last_row_count: null,
  };

  seedDemoReports();
  reportStore.set(id, report);
  return report;
}

export function updateReport(
  id: string,
  patch: Partial<Omit<SavedReport, "id" | "created_date">>
): SavedReport | null {
  seedDemoReports();
  const existing = reportStore.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  reportStore.set(id, updated);
  return updated;
}

export function deleteReport(id: string): boolean {
  return reportStore.delete(id);
}

export function recordExecution(entry: Omit<ExecutionHistoryEntry, "id">): void {
  const id = createHash("sha256")
    .update(entry.report_id + entry.ran_at)
    .digest("hex")
    .slice(0, 12);
  executionHistory.unshift({ id, ...entry });

  // Update report metadata
  const report = reportStore.get(entry.report_id);
  if (report) {
    reportStore.set(entry.report_id, {
      ...report,
      run_count: report.run_count + 1,
      last_run_date: entry.ran_at,
      last_row_count: entry.row_count,
    });
  }
}

export function getExecutionHistory(reportId?: string): ExecutionHistoryEntry[] {
  const history = reportId
    ? executionHistory.filter((e) => e.report_id === reportId)
    : executionHistory;
  return history.slice(0, 50);
}
