/**
 * sqlLibrary — Canonical SQL templates for Acacia Health KPIs.
 *
 * Each entry is the verbatim (or lightly adapted) SQL from the enterprise
 * report files uploaded by the client.  They are indexed by kpiKey so that
 * the seed-reports route can populate SavedReports with real SQL instead of
 * generated stubs.
 *
 * Parameters @StartDate / @EndDate are retained as-is; the query runner
 * substitutes them at execution time.
 */

export const SQL_LIBRARY: Record<string, string> = {

  // ── Admissions ────────────────────────────────────────────────────────────
  admissions: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
admissions AS (
    SELECT
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort,
        COUNT(DISTINCT e.epi_id) AS admissions
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_SocDate BETWEEN @StartDate AND @EndDate
    GROUP BY db.branch_name, db.service_line
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(admissions) AS admissions
FROM admissions
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Discharges and Live Discharges ────────────────────────────────────────
  total_discharges: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
discharges AS (
    SELECT
        e.epi_id,
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
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

  live_discharge_rate: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
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
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort,
        ISNULL(cl.dc_class, 'Other') AS dc_class
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN dc_class cl ON RTRIM(cl.dr_code) = RTRIM(e.epi_DcCode)
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN dc_class = 'LiveDC-PatientInitiated' THEN 1 ELSE 0 END)  AS live_dc_patient_initiated,
    SUM(CASE WHEN dc_class = 'LiveDC-HospiceInitiated' THEN 1 ELSE 0 END)  AS live_dc_hospice_initiated,
    SUM(CASE WHEN dc_class IN ('LiveDC-PatientInitiated','LiveDC-HospiceInitiated') THEN 1 ELSE 0 END) AS live_dc_total,
    SUM(CASE WHEN dc_class = 'Death' THEN 1 ELSE 0 END)  AS deaths,
    SUM(CASE WHEN dc_class = 'Other' THEN 1 ELSE 0 END)  AS other_or_unmapped
FROM discharges
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Daily Census ──────────────────────────────────────────────────────────
  daily_census: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

SELECT TOP 10000
    CAST(epi.epi_SocDate AS DATE) AS CensusDate,
    COUNT(DISTINCT epi.epi_id)    AS DailyCensus
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate
GROUP BY CAST(epi.epi_SocDate AS DATE)
ORDER BY CensusDate;`,

  // ── Census and ADC (by branch) ────────────────────────────────────────────
  average_daily_census: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT
        e.epi_id, e.epi_SocDate, e.epi_DischargeDate,
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED' AND e.epi_NonAdmitDate IS NULL
),
overlap AS (
    SELECT bucket, bucket_sort,
        DATEDIFF(DAY,
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                 THEN DATEADD(DAY, 1, @EndDate) ELSE epi_DischargeDate END
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
    CAST(SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS FLOAT) / 14.0 AS average_daily_census
FROM overlap
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Census and ADC by Service Line and Branch ─────────────────────────────
  current_census_by_service_line_branch: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT TOP 50000
    db.service_line,
    db.epi_branchcode AS branch_code,
    db.branch_name,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    COUNT(DISTINCT e.epi_id)    AS current_census,
    SUM(CASE WHEN e.epi_SocDate BETWEEN @StartDate AND @EndDate THEN 1 ELSE 0 END) AS admissions_in_window
FROM dbo.CLIENT_EPISODES_ALL e
JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND e.epi_NonAdmitDate IS NULL
  AND e.epi_SocDate <= @EndDate
  AND (e.epi_DischargeDate IS NULL OR e.epi_DischargeDate > @EndDate)
GROUP BY db.service_line, db.epi_branchcode, db.branch_name
ORDER BY bucket_sort, db.branch_name;`,

  // ── Patient Days ──────────────────────────────────────────────────────────
  patient_days: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT e.epi_id, e.epi_SocDate, e.epi_DischargeDate,
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED' AND e.epi_NonAdmitDate IS NULL
),
overlap AS (
    SELECT bucket, bucket_sort,
        DATEDIFF(DAY,
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                 THEN DATEADD(DAY, 1, @EndDate) ELSE epi_DischargeDate END
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
    SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days
FROM overlap
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Revenue and RPD ───────────────────────────────────────────────────────
  revenue: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
revenue AS (
    SELECT
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort,
        li.li_calculatedamount AS amount
    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db ON db.epi_slid = li.li_slid AND db.epi_branchcode = e.epi_branchcode
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

  revenue_per_patient_day: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
revenue AS (
    SELECT db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1 WHEN db.service_line = 'HOSPICE' THEN 2 ELSE 99 END AS bucket_sort,
        SUM(li.li_calculatedamount) AS revenue
    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db ON db.epi_slid = li.li_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0 AND li.li_void = 0 AND li.li_includeonclaim = 1
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
    GROUP BY db.branch_name, db.service_line
),
episodes AS (
    SELECT e.epi_id, e.epi_SocDate, e.epi_DischargeDate,
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1 WHEN db.service_line = 'HOSPICE' THEN 2 ELSE 99 END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED' AND e.epi_NonAdmitDate IS NULL
),
overlap AS (
    SELECT bucket, bucket_sort,
        DATEDIFF(DAY,
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate THEN DATEADD(DAY,1,@EndDate) ELSE epi_DischargeDate END
        ) AS patient_days
    FROM episodes
    WHERE epi_SocDate <= @EndDate AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
),
patient_days AS (
    SELECT bucket, bucket_sort,
        SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days
    FROM overlap GROUP BY bucket, bucket_sort
),
combined AS (
    SELECT COALESCE(r.bucket, pd.bucket) AS bucket,
        COALESCE(r.bucket_sort, pd.bucket_sort) AS bucket_sort,
        r.revenue, pd.patient_days
    FROM revenue r FULL OUTER JOIN patient_days pd ON pd.bucket = r.bucket
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    CAST(ISNULL(revenue, 0) AS decimal(18,2)) AS revenue,
    ISNULL(patient_days, 0) AS patient_days,
    CASE WHEN ISNULL(patient_days, 0) > 0
         THEN CAST(ISNULL(revenue, 0) * 1.0 / patient_days AS decimal(18,2))
         ELSE NULL END AS revenue_per_patient_day
FROM combined
ORDER BY bucket_sort, bucket;`,

  // ── Billing Holds ─────────────────────────────────────────────────────────
  billing_holds: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
holds AS (
    SELECT
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
             WHEN db.service_line = 'HOSPICE' THEN 2
             ELSE 99 END AS bucket_sort,
        li.li_hold_flag,
        li.li_hold_days
    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db ON db.epi_slid = li.li_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*)                                                   AS total_line_items,
    SUM(CASE WHEN li_hold_flag = 1 THEN 1 ELSE 0 END)         AS billing_holds,
    SUM(CASE WHEN li_hold_flag = 1 AND li_hold_days <= 5 THEN 1 ELSE 0 END) AS holds_within_sla,
    AVG(CASE WHEN li_hold_flag = 1 THEN CAST(li_hold_days AS FLOAT) END)    AS avg_hold_days
FROM holds
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── LUPA ──────────────────────────────────────────────────────────────────
  lupa_rate: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
lupa AS (
    SELECT
        db.branch_name AS bucket,
        CASE WHEN db.service_line = 'HOME HEALTH' THEN 1 ELSE 99 END AS bucket_sort,
        pdgm.lupa_indicator
    FROM PDGM_PERIOD pdgm
    JOIN dbo.CLIENT_EPISODES_ALL e ON pdgm.episode_id = e.epi_id
    JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE pdgm.period_start_date BETWEEN @StartDate AND @EndDate
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS total_periods,
    SUM(CASE WHEN lupa_indicator IN ('LUPA', 'L') THEN 1 ELSE 0 END) AS lupa_periods,
    CAST(SUM(CASE WHEN lupa_indicator IN ('LUPA','L') THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS lupa_rate_pct
FROM lupa
GROUP BY bucket
ORDER BY bucket_sort, bucket;`,

  // ── Avg Admittance / Referrals ────────────────────────────────────────────
  avg_days_referral_to_admission: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT e.epi_id) AS admissions,
    AVG(CAST(DATEDIFF(DAY, e.epi_ReferralDate, e.epi_SocDate) AS FLOAT)) AS avg_days_referral_to_admission,
    SUM(CASE WHEN DATEDIFF(DAY, e.epi_ReferralDate, e.epi_SocDate) <= 2 THEN 1 ELSE 0 END) AS admissions_within_2_days,
    CAST(SUM(CASE WHEN DATEDIFF(DAY, e.epi_ReferralDate, e.epi_SocDate) <= 2 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(DISTINCT e.epi_id), 0) * 100 AS pct_within_2_days
FROM dbo.CLIENT_EPISODES_ALL e
LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND e.epi_NonAdmitDate IS NULL
  AND e.epi_SocDate BETWEEN @StartDate AND @EndDate
  AND e.epi_ReferralDate IS NOT NULL
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

  // ── Length of Stay ────────────────────────────────────────────────────────
  avg_length_of_stay: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT e.epi_id) AS episode_count,
    AVG(CAST(DATEDIFF(DAY, e.epi_SocDate,
        ISNULL(e.epi_DischargeDate, CAST(GETDATE() AS DATE))) AS FLOAT)) AS avg_los_days,
    MIN(DATEDIFF(DAY, e.epi_SocDate, ISNULL(e.epi_DischargeDate, CAST(GETDATE() AS DATE)))) AS min_los_days,
    MAX(DATEDIFF(DAY, e.epi_SocDate, ISNULL(e.epi_DischargeDate, CAST(GETDATE() AS DATE)))) AS max_los_days
FROM dbo.CLIENT_EPISODES_ALL e
LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND e.epi_NonAdmitDate IS NULL
  AND e.epi_SocDate <= @EndDate
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

  // ── Worker Points / Productivity ─────────────────────────────────────────
  worker_productivity_achievement: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT TOP 50000
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT w.worker_id) AS worker_count,
    SUM(w.earned_points)        AS total_earned_points,
    SUM(w.expected_points)      AS total_expected_points,
    CAST(SUM(w.earned_points) AS FLOAT) / NULLIF(SUM(w.expected_points), 0) * 100 AS productivity_pct
FROM WORKER_BASE w
JOIN dbo.CLIENT_EPISODE_VISITS_ALL vis ON w.worker_id = vis.worker_id
JOIN dbo.CLIENT_EPISODES_ALL e ON vis.episode_id = e.epi_id
LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND vis.visit_date BETWEEN @StartDate AND @EndDate
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

  // ── Hospice Census Equivalent ─────────────────────────────────────────────
  hospice_census_equivalent_by_branch: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT e.epi_id, e.epi_SocDate, e.epi_DischargeDate,
        db.branch_name AS bucket, db.epi_branchcode
    FROM dbo.CLIENT_EPISODES_ALL e
    JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED' AND e.epi_NonAdmitDate IS NULL
),
overlap AS (
    SELECT bucket, epi_branchcode,
        DATEDIFF(DAY,
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                 THEN DATEADD(DAY,1,@EndDate) ELSE epi_DischargeDate END
        ) AS patient_days
    FROM episodes
    WHERE epi_SocDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    epi_branchcode AS branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS hospice_patient_days,
    SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) * 0.40 AS hce
FROM overlap
GROUP BY bucket, epi_branchcode
ORDER BY bucket;`,

  // ── Visit Notes ───────────────────────────────────────────────────────────
  visit_notes_activity: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT TOP 50000
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT vn.vn_id) AS visit_notes,
    SUM(CASE WHEN vn.vn_completed_flag = 1 THEN 1 ELSE 0 END) AS completed_notes,
    SUM(CASE WHEN vn.vn_completed_flag = 0 OR vn.vn_completed_flag IS NULL THEN 1 ELSE 0 END) AS unsigned_notes,
    CAST(SUM(CASE WHEN vn.vn_completed_flag = 1 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(DISTINCT vn.vn_id), 0) * 100 AS completion_rate_pct
FROM dbo.CLIENT_EPISODE_VISIT_NOTES vn
JOIN dbo.CLIENT_EPISODES_ALL e ON vn.vn_episode_id = e.epi_id
LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND vn.vn_visit_date BETWEEN @StartDate AND @EndDate
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

  // ── BP1 Compliance ────────────────────────────────────────────────────────
  bp1_compliance_within_48hrs: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    1 AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT pdgm.period_id) AS total_periods,
    SUM(CASE WHEN pdgm.bp1_completed_flag = 1
             AND DATEDIFF(HOUR, pdgm.period_start_date, pdgm.bp1_completed_datetime) <= 48
             THEN 1 ELSE 0 END) AS bp1_within_48hrs,
    CAST(SUM(CASE WHEN pdgm.bp1_completed_flag = 1
                  AND DATEDIFF(HOUR, pdgm.period_start_date, pdgm.bp1_completed_datetime) <= 48
                  THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(DISTINCT pdgm.period_id), 0) * 100 AS bp1_compliance_pct
FROM PDGM_PERIOD pdgm
JOIN dbo.CLIENT_EPISODES_ALL e ON pdgm.episode_id = e.epi_id
JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE pdgm.period_start_date BETWEEN @StartDate AND @EndDate
GROUP BY db.branch_name
ORDER BY bucket;`,

  // ── Recertifications ──────────────────────────────────────────────────────
  recertifications: `DECLARE @EndDate   date = CAST(GETDATE() AS date);
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(DISTINCT e.epi_id) AS recertifications
FROM dbo.CLIENT_EPISODES_ALL e
LEFT JOIN dim_branch db ON db.epi_slid = e.epi_slid AND db.epi_branchcode = e.epi_branchcode
WHERE e.epi_status <> 'DELETED'
  AND e.epi_RecertDate BETWEEN @StartDate AND @EndDate
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

  // ── Unbilled and AR ───────────────────────────────────────────────────────
  unbilled_revenue: `DECLARE @AsOfDate date = CAST(GETDATE() AS date);

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS (
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'Acacia Home Health and Palliative'),
        ('HOME HEALTH', 1, 'HL1', 'Acacia Home Health Services'),
        ('HOSPICE', 2, 'XO1', 'Acacia Hospice and Palliative Services OC'),
        ('HOSPICE', 2, 'XD1', 'Acacia Hospice of the Desert D'),
        ('HOSPICE', 2, 'ZI1', 'Acacia Hospice and Palliative Services IE'),
        ('HOSPICE', 2, 'ZD1', 'Acacia Hospice and Palliative Services D'),
        ('HOSPICE', 2, 'ZS1', 'Acacia Hospice and Palliative Services SGV'),
        ('HOSPICE', 2, 'SO1', 'Acacia Hospice of Los Angeles OC'),
        ('HOSPICE', 2, 'XS1', 'Acacia Hospice of Los Angeles'),
        ('HOSPICE', 2, 'SD1', 'Acacia Hospice of Los Angeles LD'),
        ('HOSPICE', 2, 'SI1', 'Acacia Hospice of Los Angeles IE'),
        ('HOSPICE', 2, 'LI1', 'Acacia Hospice of the Desert IE'),
        ('HOSPICE', 2, 'LS1', 'Acacia Hospice of the Desert SGV'),
        ('HOSPICE', 2, 'XS2', 'Acacia Hospice and Palliative of Los Angeles'),
        ('HOSPICE', 2, 'LO1', 'Acacia Hospice of the Desert OC'),
        ('HOSPICE', 2, 'SO2', 'Acacia Hospice and Palliative of LA - OC')
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
)
SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,
    CASE WHEN db.service_line = 'HOME HEALTH' THEN 1
         WHEN db.service_line = 'HOSPICE' THEN 2
         ELSE 99 END AS bucket_sort,
    @AsOfDate AS as_of_date,
    SUM(CASE WHEN li.li_claim_status = 'Unbilled' THEN li.li_calculatedamount ELSE 0 END) AS unbilled_revenue,
    SUM(CASE WHEN DATEDIFF(DAY, li.li_servicedate, @AsOfDate) > 90
             AND li.li_claim_status NOT IN ('Paid','Denied')
             THEN li.li_calculatedamount ELSE 0 END) AS ar_over_90,
    SUM(CASE WHEN li.li_claim_status NOT IN ('Paid','Denied')
             THEN li.li_calculatedamount ELSE 0 END) AS ar_total
FROM Billing.LINE_ITEMS li
LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid AND e.epi_status <> 'DELETED'
LEFT JOIN dim_branch db ON db.epi_slid = li.li_slid AND db.epi_branchcode = e.epi_branchcode
WHERE li.li_deleted = 0 AND li.li_void = 0
GROUP BY db.branch_name, db.service_line
ORDER BY bucket_sort, bucket;`,

};
