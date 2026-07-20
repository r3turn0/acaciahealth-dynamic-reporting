/**
 * sqlLibrary — Canonical SQL templates for Acacia Health KPIs.
 *
 * Each entry is the verbatim SQL from the uploaded enterprise report files.
 * DECLARE @StartDate / @EndDate / @AsOfDate / @HceFactor / @SLA_Cutoff /
 * @DefaultExpectedPoints blocks are intentionally omitted here; the query
 * runner substitutes those parameters at execution time.
 *
 * Naming convention: each distinct CTE statement (WITH … SELECT) from every
 * source file is its own key. Multi-statement files are split at the
 * statement boundary (the semicolon that precedes each ;WITH).
 *
 * Keys map 1-to-1 with kpiConfig.json kpi keys used by seed-reports.
 */

export const SQL_LIBRARY: Record<string, string> = {

  // ── Admissions (Admissions-dBafK.sql — statement 1) ──────────────────────
  // bucket_map  →  episodes  →  admissions by service-line bucket
  admissions: `;WITH bucket_map AS (
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
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admission_count
FROM episodes
WHERE CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Admissions by Care Type (Admissions-dBafK.sql — statement 2) ─────────
  // bucket_map  →  episodes  →  admissions by primary HH care type
  admissions_by_care_type: `;WITH bucket_map AS (
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
    LEFT JOIN bucket_map bm
        ON bm.sl_id = e.epi_slid
       AND (bm.branch_code IS NULL OR bm.branch_code = e.epi_branchcode)
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND bm.sl_name = 'HOME HEALTH'
)
SELECT
    e.bucket,
    MIN(e.bucket_sort) AS bucket_sort,
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
ORDER BY care_type;`,

  // ── Current Census (Census-and-ADC-vyVhM.sql — statement 1) ──────────────
  // dim_branch  →  episodes  →  current patient census as of @AsOfDate
  current_census: `WITH dim_branch AS (
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
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
)
SELECT
    ISNULL(service_line, '(unmapped)') AS service_line,
    ISNULL(branch_name, '(unmapped)')  AS branch_name,
    @AsOfDate                          AS as_of_date,
    COUNT(*)                           AS current_census
FROM episodes
WHERE epi_SocDate <= @AsOfDate
  AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
GROUP BY service_line, branch_name
ORDER BY service_line, branch_name;`,

  // ── Average Daily Census (Census-and-ADC-vyVhM.sql — statement 2) ─────────
  // dim_branch  →  episodes  →  dates  →  daily_census  →  ADC
  average_daily_census: `;WITH dim_branch AS (
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
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
),
dates AS (
    SELECT @StartDate AS census_date
    UNION ALL
    SELECT DATEADD(DAY, 1, census_date)
    FROM dates
    WHERE census_date < @EndDate
),
daily_census AS (
    SELECT
        d.census_date,
        e.service_line,
        e.branch_name,
        COUNT(*) AS daily_census
    FROM dates d
    JOIN episodes e
        ON e.epi_SocDate <= d.census_date
       AND (e.epi_DischargeDate IS NULL OR e.epi_DischargeDate > d.census_date)
    GROUP BY d.census_date, e.service_line, e.branch_name
)
SELECT
    service_line,
    branch_name,
    @StartDate AS window_start,
    @EndDate   AS window_end,
    SUM(daily_census) AS patient_days,
    DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,
    CAST(SUM(daily_census) * 1.0 /
(DATEDIFF(DAY, @StartDate, @EndDate) + 1)
 AS DECIMAL(10,2)) AS adc
FROM daily_census
GROUP BY service_line, branch_name
ORDER BY service_line, branch_name
OPTION (MAXRECURSION 32767);`,

  // ── Census and ADC by Service Line and Branch (Census-and-ADC-by-Service-Line-and-Branch-Pj9oJ.sql) ──
  // Plain SELECT — daily census + window avg by service line and branch
  current_census_by_service_line_branch: `SELECT TOP 10000
    CAST(epi.epi_SocDate AS DATE) AS CensusDate,
    sl.sl_id AS ServiceLine,
    b.branch_name AS BranchName,
    COUNT(DISTINCT epi.epi_id) AS DailyCensus,
    AVG(COUNT(DISTINCT epi.epi_id)) OVER (PARTITION BY sl.sl_id, b.branch_code) AS AvgDailyCensus
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
JOIN SERVICE_LINES sl ON epi.epi_slid = sl.sl_id
JOIN BRANCHES b ON RTRIM(epi.epi_branchcode) = RTRIM(b.branch_code)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY CAST(epi.epi_SocDate AS DATE), sl.sl_id, b.branch_name, sl.sl_id, b.branch_code
ORDER BY CensusDate, ServiceLine, BranchName;`,

  // ── Daily Census (Daily-Census-qD9s2.sql) ────────────────────────────────
  // Plain SELECT — daily patient census aggregate across all branches
  daily_census: `SELECT TOP 10000
    CAST(epi.epi_SocDate AS DATE) AS CensusDate,
    COUNT(DISTINCT epi.epi_id) AS DailyCensus
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY CAST(epi.epi_SocDate AS DATE)
ORDER BY CensusDate;`,

  // ── Total Discharges (Discharges-and-Live-Discharges-RaBFX.sql — statement 1) ──
  // dim_branch  →  dc_class  →  discharges  →  total discharge count by bucket
  total_discharges: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    SELECT * FROM (VALUES
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
    WHERE e.epi_status <> 'DELETED'
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
ORDER BY bucket_sort, bucket;`,

  // ── Discharges by DC Class (Discharges-and-Live-Discharges-RaBFX.sql — statement 2) ──
  // dim_branch  →  dc_class  →  discharges  →  discharge count by bucket and class
  discharges_by_dc_class: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    SELECT * FROM (VALUES
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
    WHERE e.epi_status <> 'DELETED'
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
ORDER BY bucket_sort, dc_class;`,

  // ── Live Discharge Rate (Discharges-and-Live-Discharges-RaBFX.sql — statement 3) ──
  // dim_branch  →  dc_class  →  discharges  →  live DC breakdown by type
  live_discharge_rate: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    SELECT * FROM (VALUES
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
    WHERE e.epi_status <> 'DELETED'
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
ORDER BY bucket_sort, bucket;`,

  // ── Average / Median Length of Stay — Discharged (Length-of-Stay-05HkH.sql — statement 1) ──
  // dim_branch  →  discharged  →  with_median  →  avg/median LOS for discharged episodes
  avg_length_of_stay: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, bucket;`,

  // ── Active Length of Stay (Length-of-Stay-05HkH.sql — statement 2) ────────
  // dim_branch  →  active  →  avg current LOS for active (non-discharged) episodes
  active_length_of_stay: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket;`,

  // ── LUPA Rate — Reimbursement Type (Lupa-90WMv.sql — statement 1) ─────────
  // dim_branch  →  lupa_codes  →  periods  →  LUPA rate by reimbursement type flag
  lupa_rate: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    SELECT * FROM (VALUES
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
ORDER BY bucket_sort, bucket;`,

  // ── LUPA Rate — HIPPS Threshold (Lupa-90WMv.sql — statement 2) ────────────
  // dim_branch  →  period_visits  →  periods (HIPPS threshold)  →  LUPA rate
  lupa_rate_hipps_threshold: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, bucket;`,

  // ── New Admissions BP1 Compliance (New-Admissions-BP1-spUKs.sql) ──────────
  // admissions  →  bp1_visits  →  kpi_calc  →  BP1 visit within 48 hrs compliance
  bp1_compliance_within_48hrs: `WITH admissions AS (
    SELECT
        e.epi_id,
        e.epi_SocDate
    FROM dbo.CLIENT_EPISODES_ALL e
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE) BETWEEN @StartDate AND @EndDate
),
bp1_visits AS (
    SELECT
        v.cev_epiid AS epi_id,
        MIN(v.cev_visitdate) AS bp1_date
    FROM dbo.CLIENT_EPISODE_VISITS v
    WHERE v.cev_setsocdateflag = 'BP1'
    GROUP BY v.cev_epiid
),
kpi_calc AS (
    SELECT
        a.epi_id,
        a.epi_SocDate,
        b.bp1_date,
        CASE
            WHEN b.bp1_date IS NOT NULL
                 AND DATEDIFF(HOUR, a.epi_SocDate, b.bp1_date) <= 48
            THEN 1
            ELSE 0
        END AS bp1_within_48hrs
    FROM admissions a
    LEFT JOIN bp1_visits b
        ON a.epi_id = b.epi_id
)
SELECT
    COUNT(*) AS total_admissions,
    SUM(bp1_within_48hrs) AS bp1_compliant,
    ROUND(
        100.0 * SUM(bp1_within_48hrs) / NULLIF(COUNT(*), 0),
        2
    ) AS bp1_compliance_percent,
    CASE
        WHEN (100.0 * SUM(bp1_within_48hrs) / NULLIF(COUNT(*), 0)) >= 80
        THEN 'Meets KPI (>=80%)'
        ELSE 'Below KPI'
    END AS kpi_status
FROM kpi_calc;`,

  // ── Patient Days (Patient-Days-J0CfZ.sql) ────────────────────────────────
  // dim_branch  →  episodes  →  overlap  →  patient days and implied ADC
  patient_days: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, bucket;`,

  // ── Recertifications — Cert Window (Recerts-8Fr0K.sql — statement 1) ──────
  // dim_branch  →  episodes  →  recert count and pct of certifications in window
  recertifications: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    WHERE e.epi_status <> 'DELETED'
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
ORDER BY bucket_sort, bucket;`,

  // ── Recertifications — Active Episodes (Recerts-8Fr0K.sql — statement 2) ──
  // dim_branch  →  episodes  →  recert pct of all active episodes in window
  recertifications_of_active_episodes: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    WHERE e.epi_status <> 'DELETED'
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
ORDER BY bucket_sort, bucket;`,

  // ── Referrals and NTUC (Referrals-and-NTUC-5iqY5.sql — statement 1) ───────
  // bucket_map  →  episodes  →  flags  →  referrals, admissions, NTUC, conversion pct
  referrals_ntuc: `;WITH bucket_map AS (
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
        e.epi_DateOfReferral,
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
    WHERE e.epi_status <> 'DELETED'
),
flags AS (
    SELECT
        bucket,
        bucket_sort,
        CASE WHEN CAST(epi_DateOfReferral AS date) BETWEEN @StartDate AND @EndDate THEN 1 ELSE 0 END AS is_referral,
        CASE WHEN CAST(epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
              AND epi_NonAdmitDate IS NULL THEN 1 ELSE 0 END AS is_admission,
        CASE WHEN epi_NonAdmitDate IS NOT NULL
              AND CAST(epi_NonAdmitDate AS date) BETWEEN @StartDate AND @EndDate THEN 1 ELSE 0 END AS is_nonadmit
    FROM episodes
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(is_referral) AS referrals,
    SUM(is_admission) AS admissions,
    SUM(is_nonadmit) AS non_admits,
    CAST(CASE WHEN SUM(is_referral) > 0
              THEN SUM(is_nonadmit) * 100.0 / SUM(is_referral)
              ELSE NULL END AS decimal(5,1)) AS ntuc_pct,
    CAST(CASE WHEN SUM(is_referral) > 0
              THEN SUM(is_admission) * 100.0 / SUM(is_referral)
              ELSE NULL END AS decimal(5,1)) AS conversion_pct
FROM flags
WHERE is_referral = 1 OR is_admission = 1 OR is_nonadmit = 1
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Non-Admit by Reason (Referrals-and-NTUC-5iqY5.sql — statement 2) ──────
  // bucket_map  →  nonadmits  →  non-admit count by code and reason description
  nonadmit_by_reason: `;WITH bucket_map (sl_name, sl_id, branch_code, bucket) AS
(
    SELECT v.sl_name, v.sl_id, v.branch_code, v.bucket
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
    ) AS v(sl_name, sl_id, branch_code, bucket)
),
nonadmits AS
(
    SELECT
        e.epi_id,
        e.epi_NonAdmitCode,
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
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NOT NULL
      AND CAST(e.epi_NonAdmitDate AS date) BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(na.bucket, '(unmapped)') AS bucket,
    MIN(na.bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    na.epi_NonAdmitCode AS nonadmit_code,
    ISNULL(nac.nac_desc, '(unknown reason)') AS nonadmit_reason,
    nac.nac_refusalofservice AS refusal_of_service,
    COUNT(*) AS non_admit_count
FROM nonadmits na
LEFT JOIN dbo.NONADMIT_REASONS nac
    ON nac.nac_code = na.epi_NonAdmitCode
GROUP BY
    na.bucket,
    na.epi_NonAdmitCode,
    nac.nac_desc,
    nac.nac_refusalofservice
ORDER BY
    MIN(na.bucket_sort),
    non_admit_count DESC;`,

  // ── Revenue (Revenue-and-RPD-JpwWo.sql — statement 1) ────────────────────
  // dim_branch  →  revenue  →  total revenue by bucket
  revenue: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, bucket;`,

  // ── Revenue Per Patient Day (Revenue-and-RPD-JpwWo.sql — statement 2) ─────
  // dim_branch  →  revenue  →  episodes  →  overlap  →  patient_days  →  combined  →  RPD
  revenue_per_patient_day: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, bucket;`,

  // ── Billing Holds (Billing-Holds-P7Xy9.sql) ──────────────────────────────
  // dim_branch  →  billing_holds  →  classified  →  hold count, SLA clearance, amounts
  billing_holds: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, c.branch_code;`,

  // ── Avg Days Referral to Admission (Avg-Admittance-Referals-HPdut.sql) ────
  // dim_branch  →  episodes  →  metrics  →  avg and pct within 2 days
  avg_days_referral_to_admission: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
    WHERE e.epi_status <> 'DELETED'
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
    WHERE epi_SocDate >= epi_DateOfReferral
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
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
ORDER BY bucket_sort, bucket;`,

  // ── Hospice Census Equivalent — Per Branch (Hospice-Census-Equivalent-7Q6K1.sql — statement 1) ──
  // dim_branch  →  episodes  →  census  →  HCE value per branch/service-line
  hospice_census_equivalent_by_branch: `WITH dim_branch AS (
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
    WHERE e.epi_status <> 'DELETED'
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
FROM census;`,

  // ── Hospice Census Equivalent — HH + Palliative Combined (Hospice-Census-Equivalent-7Q6K1.sql — statement 2) ──
  // dim_branch  →  episodes  →  census  →  hh_pal  →  combined HH+Palliative HCE
  hospice_census_equivalent_hh_palliative: `;WITH dim_branch AS (
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
    WHERE e.epi_status <> 'DELETED'
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
    @HceFactor AS hce_factor,
    raw_hh_pal_census,
    CAST(raw_hh_pal_census * @HceFactor AS decimal(10,2)) AS hce_value
FROM hh_pal;`,

  // ── Hospice Census Equivalent — All Locations Total (Hospice-Census-Equivalent-7Q6K1.sql — statement 3) ──
  // dim_branch  →  episodes  →  census  →  total HCE (Hospice + HH×factor)
  hospice_census_equivalent_total: `;WITH dim_branch AS (
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
    WHERE e.epi_status <> 'DELETED'
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
    @HceFactor AS hce_factor,
    SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) AS raw_hh_pal_census,
    SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)     AS raw_hospice_census,
    CAST(
        SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)
      + SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) * @HceFactor
        AS decimal(10,2)
    ) AS total_hce
FROM census;`,

  // ── QA Compliance (QA-Compliance-2umsM.sql) ──────────────────────────────
  // dim_branch  →  episodes  →  qa_flags  →  scored  →  compliance pct
  qa_compliance: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
        e.epi_branchcode,
        e.epi_slid,
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
      AND CAST(e.epi_SocDate AS DATE) BETWEEN @StartDate AND @EndDate
),
qa_flags AS
(
    SELECT
        ep.*,
        CASE
            WHEN DATEDIFF(DAY, ep.epi_SocDate, noe.ndr_insertdate) <= 5
            THEN 1 ELSE 0
        END AS is_noe_compliant,
        CASE
            WHEN nc.ncr_active = 1 OR nc.ncr_active IS NULL
            THEN 1 ELSE 0
        END AS is_noncovered_compliant,
        CASE
            WHEN f2f.ftfs_lastupdate IS NOT NULL
            THEN 1 ELSE 0
        END AS is_f2f_compliant,
        CASE
            WHEN cert.ceat_insertdate IS NOT NULL
            THEN 1 ELSE 0
        END AS is_cert_compliant,
        CASE
            WHEN UPPER(LTRIM(RTRIM(ep.epi_RecertFlag))) IN ('Y','1','R','RECERT','TRUE')
                 AND rec.cerh_insertdate IS NOT NULL
            THEN 1
            WHEN UPPER(LTRIM(RTRIM(ep.epi_RecertFlag))) NOT IN ('Y','1','R','RECERT','TRUE')
            THEN 1
            ELSE 0
        END AS is_recert_compliant
    FROM episodes ep
    LEFT JOIN NOE_DELAY_REASON noe
        ON noe.ndr_id = ep.epi_id
    LEFT JOIN NONCOVERED_REASON nc
        ON nc.ncr_id = ep.epi_id
    LEFT JOIN FACETOFACE_STATUSES f2f
        ON f2f.ftfs_id = ep.epi_id
    LEFT JOIN CLIENT_EPISODE_ADMISSION_TYPES cert
        ON cert.ceat_epiid = ep.epi_id
    LEFT JOIN CLIENT_EPISODE_RECERT_HISTORY rec
        ON rec.cerh_epiid = ep.epi_id
),
scored AS
(
    SELECT *,
        CASE
            WHEN is_noe_compliant = 1
             AND is_noncovered_compliant = 1
             AND is_f2f_compliant = 1
             AND is_cert_compliant = 1
             AND is_recert_compliant = 1
            THEN 1 ELSE 0
        END AS is_fully_compliant
    FROM qa_flags
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS total_episodes,
    SUM(is_fully_compliant) AS compliant_episodes,
    CAST(
        SUM(is_fully_compliant) * 100.0 / NULLIF(COUNT(*), 0)
        AS decimal(5,1)
    ) AS qa_compliance_pct
FROM scored
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── AR Aging (Unbilled-and-AR-avROT.sql — statement 1) ───────────────────
  // dim_branch  →  ar  →  AR balance bucketed by aging bands (0-30, 31-60, 61-90, >90)
  ar_aging: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
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
ORDER BY bucket_sort, ar.branch_code;`,

  // ── AR Over 90 Days (Unbilled-and-AR-avROT.sql — statement 2) ────────────
  // dim_branch  →  ar90  →  invoices outstanding more than 90 days
  ar_over_90_days: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
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
ORDER BY bucket_sort, branch_code;`,

  // ── Unbilled Revenue (Unbilled-and-AR-avROT.sql — statement 3) ───────────
  // dim_branch  →  unbilled  →  line items not yet exported to EDI/invoice
  unbilled_revenue: `;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
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
ORDER BY bucket_sort, branch_code;`,

  // ── Worker Productivity — Bucket / Branch Summary (Worker-Points-y6c5L.sql — statement 1) ──
  // #bucket_map  +  #earned  +  #expected  +  #workers  +  #scored  →  branch-level summary
  worker_productivity_achievement: `DROP TABLE IF EXISTS #bucket_map;
DROP TABLE IF EXISTS #earned;
DROP TABLE IF EXISTS #expected;
DROP TABLE IF EXISTS #workers;
DROP TABLE IF EXISTS #scored;

CREATE TABLE #bucket_map
(
    branch_code varchar(10),
    bucket varchar(200),
    bucket_sort int
);

INSERT INTO #bucket_map (branch_code, bucket, bucket_sort)
VALUES
('PO1','ACACIA HOME HEALTH AND PALLIATIVE',10),
('HL1','ACACIA HOME HEALTH SERVICES',20),
('XO1','ACACIA HOSPICE AND PALLIATIVE SERVICES OC',30),
('XD1','ACACIA HOSPICE OF THE DESERT D',40),
('ZI1','ACACIA HOSPICE AND PALLIATIVE SERVICES IE',50),
('ZD1','ACACIA HOSPICE AND PALLIATIVE SERVICES D',60),
('ZS1','ACACIA HOSPICE AND PALLIATIVE SERVICES SGV',70),
('SO1','ACACIA HOSPICE OF LOS ANGELES OC',80),
('XS1','ACACIA HOSPICE OF LOS ANGELES',90),
('SD1','ACACIA HOSPICE OF LOS ANGELES LD',100),
('LI1','ACACIA HOSPICE OF THE DESERT IE',110),
('SI1','ACACIA HOSPICE OF LOS ANGELES IE',120),
('LS1','ACACIA HOSPICE OF THE DESERT SGV',130),
('XS2','ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES',140),
('LO1','ACACIA HOSPICE OF THE DESERT OC',150);

SELECT
    v.CEV_AGID AS wkr_id,
    SUM(ISNULL(sc.sc_productivitypoints,0)) AS earned_points,
    COUNT(*) AS visit_count
INTO #earned
FROM dbo.CLIENT_EPISODE_VISITS_ALL v
INNER JOIN dbo.SERVICECODES sc
    ON sc.sc_id = v.CEV_SC_ID
WHERE v.cev_deleted = 0
AND CAST(v.CEV_VISITDATE AS date)
    BETWEEN @StartDate AND @EndDate
GROUP BY v.CEV_AGID;

SELECT
    wpd_wkrid AS wkr_id,
    wpd_expectedproductivitypoints AS expected_points,
    ROW_NUMBER() OVER
    (
        PARTITION BY wpd_wkrid
        ORDER BY wpd_effectivefrom DESC
    ) AS rn
INTO #expected
FROM dbo.WORKER_BASE_PAYROLL_DETAILS
WHERE wpd_active = 'Y'
AND wpd_evaluateproductivity = 1
AND wpd_effectivefrom <= @EndDate
AND (
        wpd_effectiveto IS NULL
        OR wpd_effectiveto >= @StartDate
    );

SELECT
    w.wkr_id,
    w.wkr_fullname,
    wh.wh_homebranch AS branch_code,
    ex.expected_points,
    ISNULL(e.earned_points,0) AS earned_points,
    ISNULL(e.visit_count,0) AS visit_count
INTO #workers
FROM dbo.WORKER_BASE w
INNER JOIN #expected ex
    ON ex.wkr_id = w.wkr_id
    AND ex.rn = 1
LEFT JOIN dbo.WORKER_HOMEBRANCH wh
    ON wh.wh_wkrid = w.wkr_id
LEFT JOIN #earned e
    ON e.wkr_id = w.wkr_id
WHERE w.wkr_fulltime = 'Y'
AND w.wkr_fielduser = 'Y'
AND w.wkr_active = 'Y';

SELECT
    *,
    COALESCE(NULLIF(expected_points,0), 30.0) AS target_points,
    CASE
        WHEN earned_points >=
            COALESCE(NULLIF(expected_points,0), 30.0)
        THEN 1
        ELSE 0
    END AS is_achieving
INTO #scored
FROM #workers;

SELECT
    ISNULL(bm.bucket,'(UNMAPPED)') AS bucket,
    ISNULL(s.branch_code,'(NO BRANCH)') AS branch_code,
    MIN(bm.bucket_sort) AS bucket_sort,
    COUNT(*) AS workers_evaluated,
    SUM(s.is_achieving) AS workers_achieving,
    CAST(
        100.0 * SUM(s.is_achieving)
        / NULLIF(COUNT(*),0)
        AS decimal(6,2)
    ) AS pct_achieving,
    SUM(s.visit_count) AS visits,
    SUM(s.earned_points) AS earned_points
FROM #scored s
LEFT JOIN #bucket_map bm
    ON bm.branch_code = s.branch_code
GROUP BY
    bm.bucket,
    s.branch_code
ORDER BY
    MIN(bm.bucket_sort),
    s.branch_code;`,

  // ── Worker Productivity — Worker Detail (Worker-Points-y6c5L.sql — statement 2) ──
  // Uses same #scored / #bucket_map temp tables — individual worker rows
  worker_productivity_detail: `SELECT
    ISNULL(bm.bucket,'(UNMAPPED)') AS bucket,
    bm.bucket_sort,
    s.wkr_id,
    s.wkr_fullname,
    s.branch_code,
    s.visit_count,
    s.earned_points,
    s.expected_points,
    s.target_points,
    s.is_achieving
FROM #scored s
LEFT JOIN #bucket_map bm
    ON bm.branch_code = s.branch_code
ORDER BY
    bm.bucket_sort,
    s.wkr_fullname;`,

  // ── Client Episode Visit Notes (Client-Episode-Visit-Notes-with-Service-Lines-OYlOx.sql) ──
  // Plain SELECT — visit note content with patient and agent context
  visit_notes_activity: `SELECT TOP 10000
    epi.epi_id,
    epi.epi_firstname,
    epi.epi_lastname,
    cevn.cevn_id,
    cevn.cevn_epiid,
    cevn.cevn_AgentName,
    cevn.cevn_Assessment,
    cevn.cevn_VisitNarrative
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
JOIN CLIENT_EPISODE_VISIT_NOTES cevn ON epi.epi_id = cevn.cevn_epiid
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate;`,

  // ── Dimensions Discovery — Active Episodes by Branch and Location (Dimensions-and-Discovery-9iFAd.sql — step 1) ──
  // Discovery query: cross-tab branch_code vs loc_id to identify which column carries OC/IE/SGV/Desert
  dimensions_discovery_branch_vs_location: `SELECT
    sl.sl_desc                              AS service_line,
    e.epi_slid,
    e.epi_branchcode,
    b.branch_name,
    e.epi_locid,
    loc.loc_description                     AS ac_location,
    COUNT(*)                                AS active_episodes
FROM        dbo.CLIENT_EPISODES_ALL e
LEFT JOIN   dbo.SERVICE_LINES   sl  ON sl.sl_id      = e.epi_slid
LEFT JOIN   dbo.BRANCHES        b   ON b.branch_code = e.epi_branchcode
LEFT JOIN   dbo.AC_LOCATIONS    loc ON loc.loc_id    = e.epi_locid
WHERE   e.epi_status <> 'DELETED'
  AND   e.epi_NonAdmitDate IS NULL
  AND  (e.epi_DischargeDate IS NULL OR e.epi_DischargeDate > DATEADD(MONTH, -3, GETDATE()))
GROUP BY    sl.sl_desc, e.epi_slid, e.epi_branchcode, b.branch_name,
            e.epi_locid, loc.loc_description
ORDER BY    service_line, active_episodes DESC;`,

  // ── Dimensions Discovery — Service Lines (Dimensions-and-Discovery-9iFAd.sql — step 2A) ──
  dimensions_discovery_service_lines: `SELECT sl_id, sl_desc, sl_active
FROM   dbo.SERVICE_LINES
ORDER  BY sl_active DESC, sl_desc;`,

  // ── Dimensions Discovery — Branches (Dimensions-and-Discovery-9iFAd.sql — step 2B) ──
  dimensions_discovery_branches: `SELECT branch_code, branch_name, branch_city, branch_state, branch_active
FROM   dbo.BRANCHES
ORDER  BY branch_active DESC, branch_name;`,

  // ── Dimensions Discovery — AC Locations (Dimensions-and-Discovery-9iFAd.sql — step 2C) ──
  dimensions_discovery_ac_locations: `SELECT loc_id, loc_description, loc_type, loc_active
FROM   dbo.AC_LOCATIONS
ORDER  BY loc_active DESC, loc_description;`,

  // ── Dimensions Discovery — Care Types (Dimensions-and-Discovery-9iFAd.sql — step 2D) ──
  dimensions_discovery_care_types: `SELECT ctype_id, ctype_description, ctype_active
FROM   dbo.CARE_TYPES
ORDER  BY ctype_active DESC, ctype_description;`,

  // ── Dimensions Discovery — Discharge Reason Codes (Dimensions-and-Discovery-9iFAd.sql — step 3A) ──
  dimensions_discovery_discharge_reasons: `SELECT dr_id, dr_code, dr_desc, dr_active
FROM   dbo.DISCHARGE_REASONS
ORDER  BY dr_active DESC, dr_code;`,

  // ── Dimensions Discovery — Discharge Code Usage (Dimensions-and-Discovery-9iFAd.sql — step 3B) ──
  dimensions_discovery_discharge_code_usage: `SELECT  e.epi_DcCode, dr.dr_desc, COUNT(*) AS discharges
FROM        dbo.CLIENT_EPISODES_ALL e
LEFT JOIN   dbo.DISCHARGE_REASONS dr ON RTRIM(dr.dr_code) = RTRIM(e.epi_DcCode)
WHERE   e.epi_status <> 'DELETED'
  AND   e.epi_DischargeDate >= DATEADD(MONTH, -12, GETDATE())
GROUP BY    e.epi_DcCode, dr.dr_desc
ORDER BY    discharges DESC;`,

  // ── Dimensions Discovery — Non-Admit Reason Codes (Dimensions-and-Discovery-9iFAd.sql — step 3C) ──
  dimensions_discovery_nonadmit_reasons: `SELECT nac_id, nac_code, nac_desc, nac_refusalofservice, nac_active
FROM   dbo.NONADMIT_REASONS
ORDER  BY nac_active DESC, nac_code;`,

  // ── Dimensions Discovery — RecertFlag Values (Dimensions-and-Discovery-9iFAd.sql — step 3D) ──
  dimensions_discovery_recert_flag_values: `SELECT epi_RecertFlag, COUNT(*) AS episodes
FROM   dbo.CLIENT_EPISODES_ALL
WHERE  epi_status <> 'DELETED'
GROUP  BY epi_RecertFlag
ORDER  BY episodes DESC;`,

  // ── Dimensions Discovery — LUPA Reimbursement Types (Dimensions-and-Discovery-9iFAd.sql — step 3E) ──
  dimensions_discovery_lupa_reimbursement_types: `SELECT pp_reimbursementType, COUNT(*) AS periods
FROM   PDGM.PDGM_PERIOD
WHERE  pp_deleted = 0
GROUP  BY pp_reimbursementType
ORDER  BY periods DESC;`,

  // ── Dimensions Discovery — Medicare Payors (Dimensions-and-Discovery-9iFAd.sql — step 3F) ──
  dimensions_discovery_medicare_payors: `SELECT TOP 200 ps_id, ps_desc, ps_active, ps_IsMedicareReplacementPayor
FROM   dbo.PAYOR_SOURCES
WHERE  ps_desc LIKE '%MEDICARE%' OR ps_desc LIKE '%MCARE%' OR ps_desc LIKE '%MCR%'
ORDER  BY ps_active DESC, ps_desc;`,

  // ── Dimensions Discovery — Worker Flags (Dimensions-and-Discovery-9iFAd.sql — step 3G) ──
  dimensions_discovery_worker_flags: `SELECT  wkr_fulltime, wkr_fielduser, wkr_active, COUNT(*) AS workers
FROM    dbo.WORKER_BASE
GROUP   BY wkr_fulltime, wkr_fielduser, wkr_active
ORDER   BY workers DESC;`,

  // ── Dimensions Discovery — Invoice Status Values (Dimensions-and-Discovery-9iFAd.sql — step 3H) ──
  dimensions_discovery_invoice_status: `SELECT i_status, COUNT(*) AS invoices, SUM(i_balance) AS open_balance
FROM   Billing.INVOICES
GROUP  BY i_status
ORDER  BY invoices DESC;`,

};
