;WITH E1(N) AS
(
    SELECT N
    FROM (VALUES (0),(0),(0),(0),(0),(0),(0),(0),(0),(0)) AS v(N)
),
E2(N) AS
(
    SELECT 0 FROM E1 a CROSS JOIN E1 b
),
E4(N) AS
(
    SELECT 0 FROM E2 a CROSS JOIN E2 b
),
Tally(N) AS
(
    SELECT TOP (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
    FROM E4
),
Dates AS
(
    SELECT DATEADD(DAY, N, @StartDate) AS CensusDate
    FROM Tally
),
BillableFirstVisit AS
(
    SELECT
        cev.CEV_EPIID,
        MIN(cev.CEV_VISITDATE) AS first_billable_visit_date
    FROM dbo.CLIENT_EPISODE_VISITS_ALL cev
    WHERE cev.CEV_VISITDATE <= @EndDate
      AND cev.CEV_BILLABLE = 1
      AND ISNULL(cev.cev_deleted, 0) = 0
    GROUP BY cev.CEV_EPIID
),
EligibleEpisodes AS
(
    SELECT
        ce.epi_id,
        ce.epi_paid,
        ce.epi_SocDate,
        ce.epi_DischargeDate,
        fv.first_billable_visit_date,
        sl.sl_desc AS service_line,
        CASE
            WHEN b.branch_code IN ('XD1','ZD1','LI1','LO1','LS1') THEN 'DESERT'
            WHEN b.branch_code = 'XO1' THEN 'OC'
            WHEN b.branch_code = 'ZI1' THEN 'IE'
            WHEN b.branch_code = 'ZS1' THEN 'SGV'
            ELSE b.branch_code
        END AS reporting_region
    FROM dbo.CLIENT_EPISODES_ALL ce
    INNER JOIN BillableFirstVisit fv
        ON fv.CEV_EPIID = ce.epi_id
    INNER JOIN dbo.SERVICE_LINES sl
        ON ce.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(ce.epi_branchcode) = RTRIM(b.branch_code)
    WHERE ce.epi_NonAdmitDate IS NULL
      AND ce.epi_SocDate <= @EndDate
      AND (ce.epi_DischargeDate IS NULL OR ce.epi_DischargeDate >= @StartDate)
),
DailyCensus AS
(
    SELECT
        d.CensusDate,
        ee.service_line,
        ee.reporting_region,
        COUNT(DISTINCT ee.epi_paid) AS daily_census
    FROM Dates d
    INNER JOIN EligibleEpisodes ee
        ON ee.epi_SocDate <= d.CensusDate
       AND (ee.epi_DischargeDate IS NULL OR ee.epi_DischargeDate >= d.CensusDate)
       AND ee.first_billable_visit_date <= d.CensusDate
    GROUP BY
        d.CensusDate,
        ee.service_line,
        ee.reporting_region
),
RegionSummary AS
(
    SELECT
        service_line,
        reporting_region,
        SUM(daily_census) AS patient_days,
        COUNT(*) AS days_in_window,
        CAST(AVG(CAST(daily_census AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS adc_waar
    FROM DailyCensus
    GROUP BY
        service_line,
        reporting_region
),
EndingCensus AS
(
    SELECT
        service_line,
        reporting_region,
        daily_census AS ending_census
    FROM DailyCensus
    WHERE CensusDate = @EndDate
)
SELECT
    r.service_line,
    r.reporting_region,
    @StartDate AS window_start,
    @EndDate AS window_end,
    e.ending_census,
    r.patient_days,
    r.days_in_window,
    r.adc_waar,
    CAST(e.ending_census - r.adc_waar AS DECIMAL(18,2)) AS variance,
    CAST(((e.ending_census - r.adc_waar) * 100.0) / NULLIF(r.adc_waar, 0) AS DECIMAL(18,2)) AS variance_pct,
    CAST(e.ending_census * 1.0 / NULLIF(r.adc_waar, 0) AS DECIMAL(18,2)) AS census_to_adc_ratio
FROM RegionSummary r
INNER JOIN EndingCensus e
    ON r.service_line = e.service_line
   AND r.reporting_region = e.reporting_region
ORDER BY
    r.service_line,
    r.reporting_region;
