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
import { CANONICAL_REPORTS } from "@/lib/config/canonicalReports";
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

  const v1 = (name: string, daysAgo = 2) => ([{
    version: 1,
    saved_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    saved_by: "system",
    note: "Initial save",
    sql_snapshot: "",
    metadata_snapshot: {},
  }]);

  const base = (daysAgo = 2) => ({
    visibility: "team" as const,
    status: "published" as const,
    created_by: "system",
    created_date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    last_run_date: null,
    run_count: 0,
    last_row_count: null,
    version: 1,
  });

  const demos: Omit<SavedReport, "id">[] = [

    // ── ADMISSIONS (file: Admissions.sql) ─────────────────────────────────────
    // Result Set 1: Admissions by Service Line
    {
      name: "Admissions by Service Line",
      description: "New admission count grouped by service line bucket for the date window.",
      prompt: "Admissions by service line for the date window",
      kpi: "admissions",
      tags: ["admissions", "service line"],
      ...base(),
      version_history: v1("Admissions by Service Line"),
      sql: `;WITH bucket_map AS (
    SELECT m.sl_name, m.sl_id, m.branch_code, m.bucket
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
    },

    // Result Set 2: Admissions by Care Type (Home Health)
    {
      name: "Admissions by Care Type (Home Health)",
      description: "New Home Health admissions broken down by primary care type for the date window.",
      prompt: "Home health admissions by care type",
      kpi: "admissions",
      tags: ["admissions", "care type", "home health"],
      ...base(),
      version_history: v1("Admissions by Care Type (Home Health)"),
      sql: `;WITH bucket_map AS (
    SELECT m.sl_name, m.sl_id, m.branch_code, m.bucket
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
    },

    // ── RECERTS (file: Recerts.sql) ────────────────────────────────────────────
    // Result Set 1: Recerts — Cert Window
    {
      name: "Recerts — Cert Window",
      description: "Recertification count and rate by branch for certifications starting within the window.",
      prompt: "Recert count and rate by branch for certs starting in the date window",
      kpi: "recerts",
      tags: ["recerts", "certification", "branch"],
      ...base(),
      version_history: v1("Recerts — Cert Window"),
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
    },

    // Result Set 2: Recerts — Active Episodes
    {
      name: "Recerts — Active Episodes",
      description: "Recertification count and rate by branch across all active episodes overlapping the window.",
      prompt: "Recert count and rate by branch across all active episodes in the date window",
      kpi: "recerts",
      tags: ["recerts", "certification", "branch", "active episodes"],
      ...base(),
      version_history: v1("Recerts — Active Episodes"),
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
    },

    // ── DISCHARGES AND LIVE DISCHARGES (file: Discharges and Live Discharges.sql)
    // Result Set 1: Discharges by Branch (total count)
    {
      name: "Discharges by Branch",
      description: "Total discharge count by branch for the date window.",
      prompt: "Total discharges by branch",
      kpi: "discharges",
      tags: ["discharges", "branch"],
      ...base(),
      version_history: v1("Discharges by Branch"),
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
dc_class AS (
    SELECT c.dr_code, c.dc_class
    FROM (VALUES
        ('DTH', 'Death'),
        ('EXP', 'Death'),
        ('REV', 'LiveDC-PatientInitiated'),
        ('TRH', 'LiveDC-PatientInitiated'),
        ('EXT', 'LiveDC-HospiceInitiated'),
        ('NLT', 'LiveDC-HospiceInitiated'),
        ('OOA', 'LiveDC-HospiceInitiated'),
        ('DFC', 'LiveDC-HospiceInitiated'),
        ('TXI', 'Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        e.epi_id,
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
    WHERE e.epi_status <> 'DISCHARGED'
      AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS total_discharges
FROM discharges
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // Result Set 2: Discharges by Branch and Class
    {
      name: "Discharges by Branch and Class",
      description: "Discharges grouped by branch and discharge class (Death, LiveDC-PatientInitiated, LiveDC-HospiceInitiated, Other) for the date window.",
      prompt: "Discharges by branch and discharge class",
      kpi: "discharges",
      tags: ["discharges", "branch", "discharge class", "death", "live discharge"],
      ...base(),
      version_history: v1("Discharges by Branch and Class"),
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
dc_class AS (
    SELECT c.dr_code, c.dc_class
    FROM (VALUES
        ('DTH','Death'),('EXP','Death'),
        ('REV','LiveDC-PatientInitiated'),('TRH','LiveDC-PatientInitiated'),
        ('EXT','LiveDC-HospiceInitiated'),('NLT','LiveDC-HospiceInitiated'),
        ('OOA','LiveDC-HospiceInitiated'),('DFC','LiveDC-HospiceInitiated'),
        ('TXI','Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        e.epi_id,
        e.epi_DcCode,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        ISNULL(cl.dc_class, 'Other') AS dc_class
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN dc_class cl
        ON RTRIM(cl.dr_code) = RTRIM(e.epi_DcCode)
    WHERE e.epi_status = 'DISCHARGED'
      AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    dc_class,
    COUNT(*) AS discharges,
    COUNT(DISTINCT RTRIM(epi_DcCode)) AS distinct_dc_codes
FROM discharges
GROUP BY bucket, dc_class
ORDER BY bucket_sort, dc_class`,
    },

    // Result Set 3: Live Discharges Summary
    {
      name: "Live Discharges Summary",
      description: "Live discharge breakdown by type (patient-initiated, hospice-initiated, death, other) pivoted by branch.",
      prompt: "Live discharge summary by branch",
      kpi: "discharges",
      tags: ["discharges", "live discharge", "branch", "death"],
      ...base(),
      version_history: v1("Live Discharges Summary"),
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
dc_class AS (
    SELECT c.dr_code, c.dc_class
    FROM (VALUES
        ('DTH','Death'),('EXP','Death'),
        ('REV','LiveDC-PatientInitiated'),('TRH','LiveDC-PatientInitiated'),
        ('EXT','LiveDC-HospiceInitiated'),('NLT','LiveDC-HospiceInitiated'),
        ('OOA','LiveDC-HospiceInitiated'),('DFC','LiveDC-HospiceInitiated'),
        ('TXI','Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        ISNULL(cl.dc_class, 'Other') AS dc_class
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN dc_class cl
        ON RTRIM(cl.dr_code) = RTRIM(e.epi_DcCode)
    WHERE e.epi_status <> 'DISCHARGED'
      AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN dc_class = 'LiveDC-PatientInitiated' THEN 1 ELSE 0 END) AS live_dc_patient_initiated,
    SUM(CASE WHEN dc_class = 'LiveDC-HospiceInitiated' THEN 1 ELSE 0 END) AS live_dc_hospice_initiated,
    SUM(CASE WHEN dc_class IN ('LiveDC-PatientInitiated','LiveDC-HospiceInitiated') THEN 1 ELSE 0 END) AS live_dc_total,
    SUM(CASE WHEN dc_class = 'Death' THEN 1 ELSE 0 END) AS deaths,
    SUM(CASE WHEN dc_class = 'Other' THEN 1 ELSE 0 END) AS other_or_unmapped
FROM discharges
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // ── AVG ADMITTANCE REFERRALS (file: Avg Admittance Referals.sql) ──────────
    {
      name: "Avg Admittance Referrals",
      description: "Average days from referral to admission and percentage admitted within 2 days, by branch.",
      prompt: "Average days from referral to admission by branch",
      kpi: "admissions",
      tags: ["admissions", "referrals", "branch", "time-to-admit"],
      ...base(),
      version_history: v1("Avg Admittance Referrals"),
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
      AND e.epi_NonAdmitDate IS NULL         -- admitted only
      AND e.epi_DateOfReferral IS NOT NULL -- referral
      AND e.epi_SocDate IS NOT NULL -- new admittance
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
      -- guard against bad data
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
    },

    // ── HOSPICE CENSUS EQUIVALENT (file: Hospice Census Equivalent.sql) ────────
    // Result Set 1: HCE per Branch
    {
      name: "Hospice Census Equivalent — by Branch",
      description: "Hospice Census Equivalent (HCE) value per branch and service line as of today. HH census multiplied by 0.40 factor.",
      prompt: "Hospice Census Equivalent by branch",
      kpi: "census",
      tags: ["census", "hce", "hospice", "home health", "branch"],
      ...base(),
      version_history: v1("Hospice Census Equivalent — by Branch"),
      sql: `WITH dim_branch AS (
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
    0.40 AS hce_factor,
    current_census AS raw_census,
    CAST(
        CASE
            WHEN service_line = 'HOME HEALTH'
                THEN current_census * 0.40
            ELSE current_census
        END AS decimal(10,2)
    ) AS hce_value
FROM census`,
    },

    // Result Set 2: HH + Palliative Combined HCE
    {
      name: "Hospice Census Equivalent — HH+Palliative",
      description: "Combined HH + Palliative Home Health census converted to HCE using 0.40 factor.",
      prompt: "HH and Palliative combined Hospice Census Equivalent",
      kpi: "census",
      tags: ["census", "hce", "home health", "palliative"],
      ...base(),
      version_history: v1("Hospice Census Equivalent — HH+Palliative"),
      sql: `;WITH dim_branch AS (
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
),
hh_pal AS (
    SELECT
        SUM(current_census) AS raw_hh_pal_census
    FROM census
    WHERE service_line = 'HOME HEALTH'
)
SELECT
    'HH+Palliative' AS bucket,
    @AsOfDate AS as_of_date,
    0.40 AS hce_factor,
    raw_hh_pal_census,
    CAST(raw_hh_pal_census * 0.40 AS decimal(10,2)) AS hce_value
FROM hh_pal`,
    },

    // Result Set 3: Total HCE (All Locations)
    {
      name: "Hospice Census Equivalent — Total",
      description: "Total Hospice Census Equivalent across all locations, combining hospice census and HH census × 0.40.",
      prompt: "Total Hospice Census Equivalent across all locations",
      kpi: "census",
      tags: ["census", "hce", "hospice", "home health", "total"],
      ...base(),
      version_history: v1("Hospice Census Equivalent — Total"),
      sql: `;WITH dim_branch AS (
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
    'ALL LOCATIONS' AS bucket,
    @AsOfDate AS as_of_date,
    0.40 AS hce_factor,
    SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) AS raw_hh_pal_census,
    SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)     AS raw_hospice_census,
    CAST(
        SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)
      + SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) * 0.40
        AS decimal(10,2)
    ) AS total_hce
FROM census`,
    },

    // ── CENSUS AND ADC BY SERVICE LINE AND BRANCH (file: Census and ADC by Service Line and Branch.sql)
    {
      name: "Census and ADC by Service Line and Branch",
      description: "Daily census by service line and branch using a recursive date spine over the last 14 days.",
      prompt: "Daily census and ADC by service line and branch over a date window",
      kpi: "census",
      tags: ["census", "ADC", "branch", "service line", "daily"],
      ...base(),
      version_history: v1("Census and ADC by Service Line and Branch"),
      sql: `;WITH dates AS
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
    },

    // ── CENSUS AND ADC (file: Census and ADC.sql) ─────────────────────────────
    // Result Set 1: Census — Current by Branch
    {
      name: "Census — Current by Branch",
      description: "Current census count by service line and branch as of today (distinct patient count).",
      prompt: "Current census by branch and service line",
      kpi: "census",
      tags: ["census", "branch", "service line"],
      ...base(),
      version_history: v1("Census — Current by Branch"),
      sql: `WITH dim_branch AS
(
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
    },

    // Result Set 2: ADC — Patient Days by Branch
    {
      name: "ADC — Patient Days by Branch",
      description: "Average Daily Census (ADC) and total patient days by service line and branch over a date window.",
      prompt: "Average daily census and patient days by branch",
      kpi: "census",
      tags: ["census", "ADC", "patient days", "branch", "service line"],
      ...base(),
      version_history: v1("ADC — Patient Days by Branch"),
      sql: `;WITH dim_branch AS
(
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
        e.epi_SocDate,
        e.epi_DischargeDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),

dates AS
(
    SELECT @StartDate AS census_date

    UNION ALL

    SELECT DATEADD(DAY, 1, census_date)
    FROM dates
    WHERE census_date < @EndDate
),

daily_census AS
(
    SELECT
        d.census_date,
        e.service_line,
        e.branch_name,

        COUNT(DISTINCT e.epi_paid) AS daily_census

    FROM dates d
    JOIN episodes e
        ON e.epi_SocDate <= d.census_date
       AND (
             e.epi_DischargeDate IS NULL
             OR e.epi_DischargeDate > d.census_date
           )

    GROUP BY
        d.census_date,
        e.service_line,
        e.branch_name
)

SELECT
    service_line,
    branch_name,
    @StartDate AS window_start,
    @EndDate   AS window_end,

    SUM(daily_census) AS patient_days,

    DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,

    CAST(
        SUM(daily_census) * 1.0
        /
        (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
        AS DECIMAL(18,2)
    ) AS adc

FROM daily_census

GROUP BY
    service_line,
    branch_name

ORDER BY
    service_line,
    branch_name

OPTION (MAXRECURSION 32767)`,
    },

    // ── DAILY CENSUS (file: Daily Census.sql) ─────────────────────────────────
    {
      name: "Daily Census",
      description: "Daily census by service line and branch over a 14-day window using a recursive date spine.",
      prompt: "Daily census by service line and branch",
      kpi: "census",
      tags: ["census", "daily", "service line", "branch"],
      ...base(),
      version_history: v1("Daily Census"),
      sql: `;WITH dates AS
(
    SELECT @StartDate AS CensusDate
    UNION ALL
    SELECT DATEADD(DAY, 1, CensusDate)
    FROM dates
    WHERE CensusDate < @EndDate
)
SELECT
    d.CensusDate,
    sl.sl_desc as service_line,
    b.branch_name as branch,
    COUNT(DISTINCT epi.epi_paid) AS DailyCensus
FROM dates d
JOIN CLIENT_EPISODES_ALL epi
    ON epi.epi_status = 'CURRENT'
   AND epi.epi_NonAdmitDate IS NULL
   AND epi.epi_SocDate <= d.CensusDate
   AND (
        epi.epi_DischargeDate IS NULL
        OR epi.epi_DischargeDate > d.CensusDate
       )
JOIN SERVICE_LINES sl
    ON epi.epi_slid = sl.sl_id
JOIN BRANCHES b
    ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
GROUP BY
    d.CensusDate,
    sl.sl_desc,
    b.branch_name
ORDER BY
    d.CensusDate,
    sl.sl_desc,
    b.branch_name
OPTION (MAXRECURSION 32767)`,
    },

    // ── CLIENT EPISODE VISIT NOTES WITH SERVICE LINES ─────────────────────────
    // Result Set 1: Client Episode Visit Notes with Service Lines
    {
      name: "Client Episode Visit Notes with Service Lines",
      description: "Visit notes joined to client episodes, returning episode identifiers, agent name, assessment, and visit narrative for episodes started within the date window.",
      prompt: "Client episode visit notes with service lines",
      kpi: "visit_notes",
      tags: ["visit notes", "episodes", "clinical"],
      ...base(),
      version_history: v1("Client Episode Visit Notes with Service Lines"),
      sql: `SELECT TOP 10000 epi.epi_id, epi.epi_firstname, epi.epi_lastname, cevn.cevn_id, cevn.cevn_epiid, cevn.cevn_AgentName, cevn.cevn_Assessment, cevn.cevn_VisitNarrative
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
JOIN CLIENT_EPISODE_VISIT_NOTES cevn ON epi.epi_id = cevn.cevn_epiid
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate`,
    },

    // ── LENGTH OF STAY ────────────────────────────────────────────────────────
    // Result Set 1: Discharged LOS by Branch
    {
      name: "Length of Stay — Discharged",
      description: "Average and median length of stay (days) for episodes discharged within the date window, grouped by branch.",
      prompt: "Average and median length of stay for discharged episodes by branch",
      kpi: "length_of_stay",
      tags: ["length of stay", "discharged", "branch"],
      ...base(),
      version_history: v1("Length of Stay — Discharged"),
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
discharged AS
(
    SELECT  
        e.epi_id,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        DATEDIFF(DAY, e.epi_SocDate, e.epi_DischargeDate) AS los_days
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_DischargeDate IS NOT NULL
      AND CAST(e.epi_DischargeDate AS date) BETWEEN @StartDate AND @EndDate
),
with_median AS
(
    SELECT  
        d.bucket,
        d.bucket_sort,
        d.los_days,
        PERCENTILE_CONT(0.5) 
        WITHIN GROUP (ORDER BY d.los_days)
        OVER (PARTITION BY d.bucket) AS median_los
    FROM discharged d
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS discharged_episodes,
    CAST(AVG(los_days * 1.0) AS decimal(10,1)) AS avg_los_days,
    CAST(MIN(median_los) AS decimal(10,1)) AS median_los_days,
    100 AS median_los_benchmark
FROM with_median
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // Result Set 2: Active LOS by Branch
    {
      name: "Length of Stay — Active",
      description: "Average current length of stay (days as of today) for all active episodes, grouped by branch.",
      prompt: "Average current length of stay for active episodes by branch",
      kpi: "length_of_stay",
      tags: ["length of stay", "active", "branch"],
      ...base(),
      version_history: v1("Length of Stay — Active"),
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
active AS
(
    SELECT  
        e.epi_id,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        DATEDIFF(DAY, e.epi_SocDate, @AsOfDate) AS los_days
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_SocDate <= @AsOfDate
      AND (e.epi_DischargeDate IS NULL OR e.epi_DischargeDate > @AsOfDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @AsOfDate AS as_of_date,
    COUNT(*) AS active_census,
    CAST(AVG(los_days * 1.0) AS decimal(10,1)) AS avg_current_los_days
FROM active
GROUP BY bucket
ORDER BY bucket`,
    },

    // ── QA COMPLIANCE ─────────────────────────────────────────────────────────
    // Result Set 1: QA Compliance by Branch
    {
      name: "QA Compliance",
      description: "Face-to-face, certification, and recertification compliance rates by branch for episodes starting in the date window.",
      prompt: "QA compliance rates by branch",
      kpi: "qa_compliance",
      tags: ["qa", "compliance", "face-to-face", "certification", "branch"],
      ...base(),
      version_history: v1("QA Compliance"),
      sql: `;WITH dim_branch AS
(
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
    ) d(service_line, epi_slid, epi_branchcode, branch_name)
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
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),
flags AS
(
    SELECT
        ep.*,
        CASE
            WHEN f2f.ceftf_f2fappliestoepiid IS NOT NULL
                 AND f2f.ceftf_active = 1
            THEN 1
            ELSE 0
        END AS is_f2f_compliant,
        CASE
            WHEN cert.ceat_epiid IS NOT NULL
            THEN 1
            ELSE 0
        END AS is_cert_compliant,
        CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(ep.epi_RecertFlag,''))))
                 IN ('Y','1','R','RECERT','TRUE')
                 AND rec.cerh_epiid IS NOT NULL
            THEN 1
            WHEN UPPER(LTRIM(RTRIM(ISNULL(ep.epi_RecertFlag,''))))
                 NOT IN ('Y','1','R','RECERT','TRUE')
            THEN 1
            ELSE 0
        END AS is_recert_compliant
    FROM episodes ep
    LEFT JOIN dbo.CLIENT_EPISODE_FACETOFACE f2f
        ON f2f.ceftf_f2fappliestoepiid = ep.epi_id
    LEFT JOIN dbo.CLIENT_EPISODE_ADMISSION_TYPES cert
        ON cert.ceat_epiid = ep.epi_id
    LEFT JOIN dbo.CLIENT_EPISODE_RECERT_HISTORY rec
        ON rec.cerh_epiid = ep.epi_id
),
scored AS
(
    SELECT
        *,
        CASE
            WHEN is_f2f_compliant = 1
             AND is_cert_compliant = 1
             AND is_recert_compliant = 1
            THEN 1
            ELSE 0
        END AS is_fully_compliant
    FROM flags
)
SELECT
    bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS total_episodes,
    SUM(is_f2f_compliant) AS f2f_compliant,
    SUM(is_cert_compliant) AS cert_compliant,
    SUM(is_recert_compliant) AS recert_compliant,
    SUM(is_fully_compliant) AS compliant_episodes,
    CAST(
        100.0 * SUM(is_fully_compliant)
        / NULLIF(COUNT(*),0)
        AS DECIMAL(5,1)
    ) AS qa_compliance_pct
FROM scored
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // ── NEW ADMISSIONS BP1 — FIXED ─────────────────────────────────────────────
    // Result Set 1: BP1 KPI Summary
    {
      name: "New Admissions BP1 — KPI Summary",
      description: "Aggregate BP1 compliance rate: count of admissions with a BP1 visit within 48 hours of SOC date vs total admissions in the window.",
      prompt: "BP1 compliance KPI summary for new admissions",
      kpi: "bp1_compliance",
      tags: ["admissions", "bp1", "compliance", "kpi"],
      ...base(),
      version_history: v1("New Admissions BP1 — KPI Summary"),
      sql: `;WITH admissions AS
(
    SELECT
        e.epi_id,
        e.epi_SocDate
    FROM dbo.CLIENT_EPISODES_ALL e
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),
bp1_visits AS
(
    SELECT
        v.cev_epiid AS epi_id,
        MIN(v.cev_visitdate) AS bp1_date
    FROM dbo.CLIENT_EPISODE_VISITS v
    WHERE v.cev_setsocdateflag = 'Y'
    GROUP BY v.cev_epiid
),
kpi_calc AS
(
    SELECT
        a.epi_id,
        a.epi_SocDate,
        b.bp1_date,
        CASE
            WHEN b.bp1_date IS NOT NULL
             AND DATEDIFF(HOUR,
                          a.epi_SocDate,
                          b.bp1_date) <= 48
            THEN 1
            ELSE 0
        END AS bp1_within_48hrs
    FROM admissions a
    LEFT JOIN bp1_visits b
        ON b.epi_id = a.epi_id
)
SELECT
    COUNT(*) AS total_admissions,
    SUM(bp1_within_48hrs) AS bp1_compliant,
    CAST(
        ROUND(
            100.0 * SUM(bp1_within_48hrs)
            / NULLIF(COUNT(*), 0),
            2
        )
        AS DECIMAL(10,2)
    ) AS bp1_compliance_percent,
    CASE
        WHEN (
            100.0 * SUM(bp1_within_48hrs)
            / NULLIF(COUNT(*), 0)
        ) >= 80
        THEN 'Meets KPI (>=80%)'
        ELSE 'Below KPI'
    END AS kpi_status
FROM kpi_calc`,
    },

    // Result Set 2: BP1 Detail per Episode
    {
      name: "New Admissions BP1 — Detail",
      description: "Per-episode detail showing SOC date, first BP1 visit date, hours to BP1, and compliance status for each admission in the window.",
      prompt: "BP1 detail by episode for new admissions",
      kpi: "bp1_compliance",
      tags: ["admissions", "bp1", "compliance", "detail"],
      ...base(),
      version_history: v1("New Admissions BP1 — Detail"),
      sql: `;WITH admissions AS
(
    SELECT
        e.epi_id,
        e.epi_SocDate
    FROM dbo.CLIENT_EPISODES_ALL e
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),
bp1_visits AS
(
    SELECT
        v.cev_epiid,
        MIN(v.cev_visitdate) AS bp1_date
    FROM dbo.CLIENT_EPISODE_VISITS v
    WHERE v.cev_setsocdateflag = 'Y'
    GROUP BY v.cev_epiid
)
SELECT
    a.epi_id,
    a.epi_SocDate,
    b.bp1_date,
    DATEDIFF(HOUR,a.epi_SocDate,b.bp1_date) AS hours_to_bp1,
    CASE
        WHEN b.bp1_date IS NULL THEN 'No BP1'
        WHEN DATEDIFF(HOUR,a.epi_SocDate,b.bp1_date) <= 48 THEN 'Compliant'
        ELSE 'Late'
    END AS bp1_status
FROM admissions a
LEFT JOIN bp1_visits b
    ON b.cev_epiid = a.epi_id
ORDER BY a.epi_SocDate`,
    },

    // ── UNBILLED AND AR ────────────────────────────────────────────────────────
    // Result Set 1: AR Aging by Branch
    {
      name: "Unbilled and AR — AR Aging",
      description: "Accounts receivable aging buckets (0-30, 31-60, 61-90, 90+) and total AR balance by branch as of the end date.",
      prompt: "AR aging by branch",
      kpi: "ar",
      tags: ["ar", "aging", "billing", "branch"],
      ...base(),
      version_history: v1("Unbilled and AR — AR Aging"),
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
ar AS
(
    SELECT
        i.i_id,
        i.i_branchcode AS branch_code,
        i.i_balance,
        DATEDIFF(DAY, i.i_postdate, @AsOfDate) AS age_days
    FROM Billing.INVOICES i
    WHERE i.i_balance > 0
      AND i.i_postdate IS NOT NULL
      AND i.i_postdate <= @AsOfDate
)
SELECT
    ISNULL(db.branch_name, ISNULL(NULLIF(LTRIM(RTRIM(ar.branch_code)),''),'(no branch)')) AS bucket,
    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,
    ar.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN age_days <= 30 THEN i_balance ELSE 0 END) AS ar_0_30,
    SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN i_balance ELSE 0 END) AS ar_31_60,
    SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN i_balance ELSE 0 END) AS ar_61_90,
    SUM(CASE WHEN age_days > 90 THEN i_balance ELSE 0 END) AS ar_over_90,
    SUM(i_balance) AS ar_total
FROM ar
LEFT JOIN dim_branch db
    ON db.epi_branchcode = ar.branch_code
GROUP BY ar.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, ar.branch_code`,
    },

    // Result Set 2: AR Over 90 Days by Branch
    {
      name: "Unbilled and AR — AR Over 90 Days",
      description: "Count and total balance of invoices aged over 90 days by branch.",
      prompt: "AR over 90 days by branch",
      kpi: "ar",
      tags: ["ar", "aging", "90 days", "billing", "branch"],
      ...base(),
      version_history: v1("Unbilled and AR — AR Over 90 Days"),
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
ar90 AS
(
    SELECT
        i.i_branchcode AS branch_code,
        i.i_balance
    FROM Billing.INVOICES i
    WHERE i.i_balance > 0
      AND DATEDIFF(DAY, i.i_postdate, @AsOfDate) > 90
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,
    ar90.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS invoices_over_90,
    SUM(ar90.i_balance) AS ar_over_90
FROM ar90
LEFT JOIN dim_branch db
    ON db.epi_branchcode = ar90.branch_code
GROUP BY ar90.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, branch_code`,
    },

    // Result Set 3: Unbilled Line Items by Branch
    {
      name: "Unbilled and AR — Unbilled Line Items",
      description: "Count and total amount of unbilled line items (not yet exported on a claim) by branch.",
      prompt: "Unbilled line items by branch",
      kpi: "ar",
      tags: ["unbilled", "line items", "billing", "branch"],
      ...base(),
      version_history: v1("Unbilled and AR — Unbilled Line Items"),
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
unbilled AS
(
    SELECT
        li.li_id,
        li.li_calculatedamount,
        COALESCE(i.i_branchcode, e.epi_branchcode) AS branch_code
    FROM Billing.LINE_ITEMS li
    LEFT JOIN Billing.INVOICES i ON i.i_id = li.li_iid
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_ediexportdate IS NULL
      AND li.li_iid IS NULL
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,
    u.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS unbilled_line_items,
    SUM(ISNULL(li_calculatedamount,0)) AS unbilled_amount
FROM unbilled u
LEFT JOIN dim_branch db
    ON db.epi_branchcode = u.branch_code
GROUP BY u.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, branch_code`,
    },

    // ── PATIENT DAYS ──────────────────────────────────────────────────────────
    // Result Set 1: Patient Days and Implied ADC by Branch
    {
      name: "Patient Days",
      description: "Total patient days and implied average daily census (ADC) by branch for the date window, calculated from episode SOC and discharge date overlap.",
      prompt: "Patient days and implied ADC by branch",
      kpi: "patient_days",
      tags: ["patient days", "adc", "branch"],
      ...base(),
      version_history: v1("Patient Days"),
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
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
),
overlap AS
(
    SELECT  
        bucket,
        bucket_sort,
        DATEDIFF(DAY,
            CASE 
                WHEN epi_SocDate > @StartDate THEN epi_SocDate 
                ELSE @StartDate 
            END,
            CASE 
                WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                    THEN DATEADD(DAY, 1, @EndDate)
                ELSE epi_DischargeDate
            END
        ) AS patient_days
    FROM episodes
    WHERE epi_SocDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days,
    DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,
    CAST(
        SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) * 1.0
        / (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
        AS decimal(10,2)
    ) AS implied_adc
FROM overlap
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // ── LUPA ──────────────────────────────────────────────────────────────────
    // Result Set 1: LUPA by Reimbursement Type Flag
    {
      name: "LUPA — by Reimbursement Type",
      description: "LUPA period count and rate by branch, identified using the PDGM period reimbursement type flag (LUPA or L).",
      prompt: "LUPA periods by branch using reimbursement type flag",
      kpi: "lupa",
      tags: ["lupa", "pdgm", "branch"],
      ...base(),
      version_history: v1("LUPA — by Reimbursement Type"),
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
lupa_codes AS
(
    SELECT c.code
    FROM (VALUES
        ('LUPA'),
        ('L')
    ) AS c(code)
),
periods AS
(
    SELECT
        pp.pp_id,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        CASE WHEN lc.code IS NOT NULL THEN 1 ELSE 0 END AS is_lupa
    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    INNER JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = fs.cefs_epiid
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN lupa_codes lc
        ON LTRIM(RTRIM(pp.pp_reimbursementType)) = lc.code
    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
      AND e.epi_status <> 'DELETED'
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(is_lupa) AS lupa_periods,
    COUNT(*) AS total_periods,
    CAST(
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE SUM(is_lupa) * 100.0 / COUNT(*)
        END AS decimal(6,2)
    ) AS lupa_pct
FROM periods
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // Result Set 2: LUPA by HIPPS Threshold
    {
      name: "LUPA — by HIPPS Threshold",
      description: "LUPA period count and rate by branch, identified by comparing actual billable visit count to the HIPPS LUPA threshold.",
      prompt: "LUPA periods by branch using HIPPS threshold",
      kpi: "lupa",
      tags: ["lupa", "pdgm", "hipps", "branch"],
      ...base(),
      version_history: v1("LUPA — by HIPPS Threshold"),
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
period_visits AS
(
    SELECT  
        pp.pp_id,
        COUNT(v.CEV_ID) AS visit_count
    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    LEFT JOIN dbo.CLIENT_EPISODE_VISITS_ALL v
        ON v.CEV_EPIID = fs.cefs_epiid
       AND v.cev_deleted = 0
       AND v.CEV_BILLABLE = 1
       AND CAST(v.CEV_VISITDATE AS date)
            BETWEEN pp.pp_startDate AND pp.pp_endDate
    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
    GROUP BY pp.pp_id
),
periods AS
(
    SELECT
        pp.pp_id,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        pv.visit_count,
        hp.ph_lupaThreshold,
        CASE 
            WHEN hp.ph_lupaThreshold IS NOT NULL
             AND pv.visit_count < hp.ph_lupaThreshold
            THEN 1 ELSE 0
        END AS is_lupa
    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    INNER JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = fs.cefs_epiid
    LEFT JOIN period_visits pv ON pv.pp_id = pp.pp_id
    LEFT JOIN dbo.PDGM_HIPPS hp
        ON hp.ph_hipps = LTRIM(RTRIM(pp.pp_currentHipps))
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
      AND e.epi_status <> 'DELETED'
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(is_lupa) AS lupa_periods,
    COUNT(*) AS total_periods,
    CAST(
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE SUM(is_lupa) * 100.0 / COUNT(*)
        END AS decimal(6,2)
    ) AS lupa_pct
FROM periods
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // ── REFERRALS AND NTUC — FIXED ─────────────────────────────────────────────
    // Result Set 1: Referrals, Admissions, Non-Admits by Branch
    {
      name: "Referrals and NTUC — Summary",
      description: "Referral, admission, and non-admit (NTUC) counts with conversion and NTUC percentages by branch for the date window.",
      prompt: "Referrals, admissions, and NTUC by branch",
      kpi: "referrals",
      tags: ["referrals", "ntuc", "admissions", "branch"],
      ...base(),
      version_history: v1("Referrals and NTUC — Summary"),
      sql: `;WITH bucket_map AS
(
    SELECT m.service_line, m.service_line_id, m.branch_code, m.bucket
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
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC'),
        ('HOSPICE', 2, 'ZV1', 'ACACIA HOSPICE UNKNOWN ZV1')
    ) m(service_line, service_line_id, branch_code, bucket)
),
episodes AS
(
    SELECT
        e.epi_id,
        e.epi_DateOfReferral,
        e.epi_SocDate,
        e.epi_NonAdmitDate,
        bm.bucket,
        CASE
            WHEN bm.service_line = 'HOME HEALTH' THEN 1
            WHEN bm.service_line = 'HOSPICE'     THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN bucket_map bm
        ON bm.service_line_id = e.epi_slid
       AND bm.branch_code     = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
),
flags AS
(
    SELECT
        bucket,
        bucket_sort,
        CASE
            WHEN CAST(epi_DateOfReferral AS DATE)
                 BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_referral,
        CASE
            WHEN CAST(epi_SocDate AS DATE)
                 BETWEEN @StartDate AND @EndDate
                 AND epi_NonAdmitDate IS NULL
            THEN 1 ELSE 0
        END AS is_admission,
        CASE
            WHEN epi_NonAdmitDate IS NOT NULL
                 AND CAST(epi_NonAdmitDate AS DATE)
                     BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_nonadmit
    FROM episodes
)
SELECT
    ISNULL(bucket,'(unmapped)') AS bucket,
    MIN(bucket_sort)            AS bucket_sort,
    @StartDate                  AS window_start,
    @EndDate                    AS window_end,
    SUM(is_referral)            AS referrals,
    SUM(is_admission)           AS admissions,
    SUM(is_nonadmit)            AS non_admits,
    CAST(
        CASE
            WHEN SUM(is_referral) > 0
            THEN SUM(is_nonadmit) * 100.0 / SUM(is_referral)
        END
        AS DECIMAL(5,1)
    ) AS ntuc_pct,
    CAST(
        CASE
            WHEN SUM(is_referral) > 0
            THEN SUM(is_admission) * 100.0 / SUM(is_referral)
        END
        AS DECIMAL(5,1)
    ) AS conversion_pct
FROM flags
WHERE is_referral = 1
   OR is_admission = 1
   OR is_nonadmit = 1
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // Result Set 2: Non-Admit Reasons by Branch
    {
      name: "Referrals and NTUC — Non-Admit Reasons",
      description: "Breakdown of non-admits by reason code and branch for the date window, including refusal-of-service flag.",
      prompt: "Non-admit reasons by branch",
      kpi: "referrals",
      tags: ["ntuc", "non-admit", "reasons", "branch"],
      ...base(),
      version_history: v1("Referrals and NTUC — Non-Admit Reasons"),
      sql: `;WITH bucket_map AS
(
    SELECT v.sl_name, v.sl_id, v.branch_code, v.bucket
    FROM (VALUES
        ('HOME HEALTH',1,'PO1','ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH',1,'HL1','ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE',2,'XO1','ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE',2,'XD1','ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE',2,'ZI1','ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE',2,'ZD1','ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE',2,'ZS1','ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE',2,'SO1','ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE',2,'XS1','ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE',2,'SD1','ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE',2,'SI1','ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE',2,'LI1','ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE',2,'LS1','ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE',2,'XS2','ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE',2,'LO1','ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE',2,'SO2','ACACIA HOSPICE AND PALLIATIVE OF LA - OC'),
        ('HOSPICE',2,'ZV1','ACACIA HOSPICE UNKNOWN ZV1')
    ) v(sl_name, sl_id, branch_code, bucket)
),
nonadmit_reason_dedup AS
(
    SELECT
        nac_code,
        MIN(nac_desc) AS nac_desc,
        CAST(MAX(CAST(nac_refusalofservice AS INT)) AS BIT) AS nac_refusalofservice
    FROM dbo.NONADMIT_REASONS
    GROUP BY nac_code
),
nonadmits AS
(
    SELECT
        e.epi_id,
        e.epi_NonAdmitCode,
        bm.bucket,
        CASE
            WHEN bm.sl_name = 'HOME HEALTH' THEN 1
            WHEN bm.sl_name = 'HOSPICE'     THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN bucket_map bm
        ON bm.sl_id       = e.epi_slid
       AND bm.branch_code = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NOT NULL
      AND CAST(e.epi_NonAdmitDate AS DATE)
          BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(na.bucket,'(unmapped)') AS bucket,
    MIN(na.bucket_sort)            AS bucket_sort,
    @StartDate                     AS window_start,
    @EndDate                       AS window_end,
    na.epi_NonAdmitCode            AS nonadmit_code,
    ISNULL(nd.nac_desc,'(unknown reason)') AS nonadmit_reason,
    nd.nac_refusalofservice        AS refusal_of_service,
    COUNT(*)                       AS non_admit_count
FROM nonadmits na
LEFT JOIN nonadmit_reason_dedup nd
    ON nd.nac_code = na.epi_NonAdmitCode
GROUP BY
    na.bucket,
    na.epi_NonAdmitCode,
    nd.nac_desc,
    nd.nac_refusalofservice
ORDER BY
    MIN(na.bucket_sort),
    COUNT(*) DESC`,
    },

    // ── REVENUE AND RPD ────────────────────────────────────────────────────────
    // Result Set 1: Revenue by Branch
    {
      name: "Revenue and RPD — Revenue",
      description: "Total billed revenue from line items by branch for the date window.",
      prompt: "Revenue by branch for the date window",
      kpi: "revenue",
      tags: ["revenue", "billing", "branch"],
      ...base(),
      version_history: v1("Revenue and RPD — Revenue"),
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
revenue AS
(
    SELECT  
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        li.li_calculatedamount AS amount
    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid
       AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db
        ON db.epi_slid = li.li_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    CAST(SUM(amount) AS decimal(18,2)) AS revenue
FROM revenue
GROUP BY bucket
ORDER BY bucket_sort, bucket`,
    },

    // Result Set 2: Revenue Per Patient Day by Branch
    {
      name: "Revenue and RPD — Revenue Per Patient Day",
      description: "Revenue per patient day (RPD) by branch, combining billed line items revenue with overlap patient day calculations.",
      prompt: "Revenue per patient day by branch",
      kpi: "revenue",
      tags: ["revenue", "rpd", "patient days", "branch"],
      ...base(),
      version_history: v1("Revenue and RPD — Revenue Per Patient Day"),
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
revenue AS
(
    SELECT  
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        SUM(li.li_calculatedamount) AS revenue
    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid
       AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db
        ON db.epi_slid = li.li_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
    GROUP BY db.branch_name, db.service_line
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
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
),
overlap AS
(
    SELECT  
        bucket,
        bucket_sort,
        DATEDIFF(DAY,
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE 
                WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                    THEN DATEADD(DAY, 1, @EndDate)
                ELSE epi_DischargeDate
            END
        ) AS patient_days
    FROM episodes
    WHERE epi_SocDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
),
patient_days AS
(
    SELECT
        bucket,
        bucket_sort,
        SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days
    FROM overlap
    GROUP BY bucket, bucket_sort
),
combined AS
(
    SELECT  
        COALESCE(r.bucket, pd.bucket) AS bucket,
        COALESCE(r.bucket_sort, pd.bucket_sort) AS bucket_sort,
        r.revenue,
        pd.patient_days
    FROM revenue r
    FULL OUTER JOIN patient_days pd
        ON pd.bucket = r.bucket
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    CAST(ISNULL(revenue, 0) AS decimal(18,2)) AS revenue,
    ISNULL(patient_days, 0) AS patient_days,
    CASE 
        WHEN ISNULL(patient_days, 0) > 0
        THEN CAST(ISNULL(revenue, 0) * 1.0 / patient_days AS decimal(18,2))
        ELSE NULL
    END AS revenue_per_patient_day
FROM combined
ORDER BY bucket_sort, bucket`,
    },

    // ── BILLING HOLDS ─────────────────────────────────────────────────────────
    // Result Set 1: Billing Holds by Branch
    {
      name: "Billing Holds",
      description: "Billing holds by branch for the date window, including total hold count, amount, SLA clearance count, and percentage cleared by SLA cutoff (3 days after window end).",
      prompt: "Billing holds by branch",
      kpi: "billing_holds",
      tags: ["billing", "holds", "sla", "branch"],
      ...base(),
      version_history: v1("Billing Holds"),
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
billing_holds AS
(
    SELECT
        li.li_id,
        li.li_calculatedamount,
        li.li_servicedate,
        COALESCE(i.i_branchcode, e.epi_branchcode) AS branch_code,
        i.i_status,
        li.li_ediexportdate
    FROM Billing.LINE_ITEMS li
    LEFT JOIN Billing.INVOICES i
        ON i.i_id = li.li_iid
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND CAST(li.li_servicedate AS date) BETWEEN @StartDate AND @EndDate
      AND (
            li.li_ediexportdate IS NULL
            OR i.i_status IN ('HOLD','HELD')
          )
),
classified AS
(
    SELECT
        bh.branch_code,
        bh.li_id,
        bh.li_calculatedamount,
        CASE
            WHEN bh.li_ediexportdate IS NOT NULL
             AND CAST(bh.li_ediexportdate AS date) <= DATEADD(DAY, 3, @EndDate)
            THEN 1 ELSE 0
        END AS cleared_by_sla
    FROM billing_holds bh
)
SELECT
    ISNULL(db.branch_name,
           ISNULL(NULLIF(LTRIM(RTRIM(c.branch_code)),''),'(no branch)')
    ) AS bucket,
    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,
    c.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    DATEADD(DAY, 3, @EndDate) AS sla_cutoff_date,
    COUNT(*) AS total_holds,
    SUM(cleared_by_sla) AS cleared_by_sla,
    CAST(
        SUM(cleared_by_sla) * 100.0 / NULLIF(COUNT(*), 0)
        AS decimal(5,1)
    ) AS pct_cleared_by_sla,
    SUM(c.li_calculatedamount) AS total_hold_amount,
    SUM(
        CASE WHEN cleared_by_sla = 1
             THEN c.li_calculatedamount
             ELSE 0
        END
    ) AS cleared_amount
FROM classified c
LEFT JOIN dim_branch db
    ON db.epi_branchcode = c.branch_code
GROUP BY c.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, c.branch_code`,
    },

    // ── CENSUS AND ADC ────────────────────────────────────────────────────────
    // Result Set 1: Census — Current by Branch (from Census and ADC.sql)
    {
      name: "Census and ADC — Current Census",
      description: "Current active patient census as of today by service line and branch.",
      prompt: "Current census by service line and branch",
      kpi: "census",
      tags: ["census", "current", "service line", "branch"],
      ...base(),
      version_history: v1("Census and ADC — Current Census"),
      sql: `;WITH dim_branch AS
(
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
    },

    // Result Set 2: ADC — Patient Days by Branch (from Census and ADC.sql)
    {
      name: "Census and ADC — Patient Days and ADC",
      description: "Patient days and average daily census (ADC) by service line and branch for the date window using a recursive date spine.",
      prompt: "Patient days and ADC by service line and branch",
      kpi: "census",
      tags: ["adc", "patient days", "service line", "branch"],
      ...base(),
      version_history: v1("Census and ADC — Patient Days and ADC"),
      sql: `;WITH dim_branch AS
(
    SELECT d.service_line, d.epi_slid, d.epi_branchcode, d.branch_name
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
        e.epi_SocDate,
        e.epi_DischargeDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),
dates AS
(
    SELECT @StartDate AS census_date
    UNION ALL
    SELECT DATEADD(DAY, 1, census_date)
    FROM dates
    WHERE census_date < @EndDate
),
daily_census AS
(
    SELECT
        d.census_date,
        e.service_line,
        e.branch_name,
        COUNT(DISTINCT e.epi_paid) AS daily_census
    FROM dates d
    JOIN episodes e
        ON e.epi_SocDate <= d.census_date
       AND (
             e.epi_DischargeDate IS NULL
             OR e.epi_DischargeDate > d.census_date
           )
    GROUP BY
        d.census_date,
        e.service_line,
        e.branch_name
)
SELECT
    service_line,
    branch_name,
    @StartDate AS window_start,
    @EndDate   AS window_end,
    SUM(daily_census) AS patient_days,
    DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,
    CAST(
        SUM(daily_census) * 1.0
        /
        (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
        AS DECIMAL(18,2)
    ) AS adc
FROM daily_census
GROUP BY
    service_line,
    branch_name
ORDER BY
    service_line,
    branch_name
OPTION (MAXRECURSION 32767)`,
    },

  ];

  // The uploaded SQL files are the sole source of truth for built-in Saved Reports.
  // The legacy inline definitions above remain only as historical source context.
  void demos;
  for (const source of CANONICAL_REPORTS) {
    const created_date = "2026-07-31T00:00:00.000Z";
    const id = createHash("sha256")
      .update(`canonical:${source.sourceFile}:${source.resultSet}`)
      .digest("hex")
      .slice(0, 12);
    reportStore.set(id, {
      id,
      name: source.name,
      description: source.description,
      prompt: source.prompt,
      sql: source.sql,
      kpi: source.kpi,
      tags: source.tags,
      visibility: "team",
      status: "published",
      created_by: "system",
      created_date,
      last_run_date: null,
      run_count: 0,
      last_row_count: null,
      version: 1,
      version_history: [{
        version: 1,
        saved_at: created_date,
        saved_by: "system",
        note: `Imported verbatim from ${source.sourceFile}, result set ${source.resultSet}`,
        sql_snapshot: source.sql,
        metadata_snapshot: {
          sourceFile: source.sourceFile,
          resultSet: source.resultSet,
          resultSetCount: source.resultSetCount,
        },
      }],
    });
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

export interface CanonicalReportSyncResult {
  created: string[];
  updated: string[];
  removedLegacy: string[];
  unchanged: string[];
}

/**
 * Reconciles system-owned Saved Reports with the uploaded SQL files.
 * Analyst-created reports are never changed or removed.
 */
export async function synchronizeCanonicalReports(): Promise<CanonicalReportSyncResult> {
  const reports = await listReports();
  const canonicalNames = new Set(CANONICAL_REPORTS.map((report) => report.name));
  const canonicalKpis = new Set(CANONICAL_REPORTS.map((report) => report.kpi));
  const result: CanonicalReportSyncResult = {
    created: [],
    updated: [],
    removedLegacy: [],
    unchanged: [],
  };

  for (const existing of reports) {
    const isLegacySystemReport = existing.created_by === "system"
      && canonicalKpis.has(existing.kpi)
      && !canonicalNames.has(existing.name);
    if (isLegacySystemReport && await deleteReport(existing.id)) {
      result.removedLegacy.push(existing.name);
    }
  }

  const remaining = (await listReports()).filter((report) => !result.removedLegacy.includes(report.name));

  for (const source of CANONICAL_REPORTS) {
    const existing = remaining.find((report) => report.name === source.name);
    if (!existing) {
      await createReport({
        name: source.name,
        description: source.description,
        prompt: source.prompt,
        sql: source.sql,
        kpi: source.kpi,
        tags: source.tags,
        visibility: "team",
        created_by: "system",
      });
      result.created.push(source.name);
      continue;
    }

    const changed = existing.sql !== source.sql
      || existing.description !== source.description
      || existing.kpi !== source.kpi
      || JSON.stringify(existing.tags) !== JSON.stringify(source.tags);

    if (!changed) {
      result.unchanged.push(source.name);
      continue;
    }

    await updateReport(existing.id, {
      description: source.description,
      sql: source.sql,
      kpi: source.kpi,
      tags: source.tags,
      visibility: "team",
      status: "published",
      versionNote: `Synchronized from ${source.sourceFile}, result set ${source.resultSet}`,
      updated_by: "system",
    });
    result.updated.push(source.name);
  }

  return result;
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
