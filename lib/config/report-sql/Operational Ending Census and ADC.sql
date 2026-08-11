;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY,1,CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),

DailyCensus AS
(
    SELECT
        d.CensusDate,

        sl.sl_desc AS service_line,

        CASE
            WHEN b.branch_code IN ('XD1','ZD1','LI1','LO1','LS1')
                THEN 'DESERT'
            WHEN b.branch_code = 'XO1'
                THEN 'OC'
            WHEN b.branch_code = 'ZI1'
                THEN 'IE'
            WHEN b.branch_code = 'ZS1'
                THEN 'SGV'
            ELSE b.branch_code
        END AS reporting_region,

        COUNT(DISTINCT ce.epi_paid) AS daily_census

    FROM Dates d

    INNER JOIN dbo.CLIENT_EPISODES_ALL ce
        ON ce.epi_NonAdmitDate IS NULL
       AND ce.epi_SocDate <= d.CensusDate
       AND (
                ce.epi_DischargeDate IS NULL
             OR ce.epi_DischargeDate >= d.CensusDate
           )

    INNER JOIN dbo.SERVICE_LINES sl
        ON ce.epi_slid = sl.sl_id

    INNER JOIN dbo.BRANCHES b
        ON RTRIM(ce.epi_branchcode) = RTRIM(b.branch_code)

    WHERE EXISTS
    (
        SELECT 1
        FROM dbo.CLIENT_EPISODE_VISITS_ALL cev
        WHERE cev.CEV_EPIID = ce.epi_id
          AND cev.CEV_VISITDATE <= d.CensusDate
          AND cev.CEV_BILLABLE = 1
          AND ISNULL(cev.cev_deleted,0) = 0
    )

    GROUP BY
        d.CensusDate,
        sl.sl_desc,
        CASE
            WHEN b.branch_code IN ('XD1','ZD1','LI1','LO1','LS1')
                THEN 'DESERT'
            WHEN b.branch_code = 'XO1'
                THEN 'OC'
            WHEN b.branch_code = 'ZI1'
                THEN 'IE'
            WHEN b.branch_code = 'ZS1'
                THEN 'SGV'
            ELSE b.branch_code
        END
),

RegionSummary AS
(
    SELECT
        service_line,
        reporting_region,

        SUM(daily_census) AS patient_days,

        COUNT(*) AS days_in_window,

        CAST(
            AVG(CAST(daily_census AS DECIMAL(18,2)))
            AS DECIMAL(18,2)
        ) AS adc_waar

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

    CAST(
        e.ending_census - r.adc_waar
        AS DECIMAL(18,2)
    ) AS variance,

    CAST(
        (
            (e.ending_census - r.adc_waar)
            * 100.0
        )
        /
        NULLIF(r.adc_waar,0)
        AS DECIMAL(18,2)
    ) AS variance_pct,

    CAST(
        e.ending_census * 1.0
        /
        NULLIF(r.adc_waar,0)
        AS DECIMAL(18,2)
    ) AS census_to_adc_ratio

FROM RegionSummary r
JOIN EndingCensus e
    ON r.service_line = e.service_line
   AND r.reporting_region = e.reporting_region

ORDER BY
    r.service_line,
    r.reporting_region

OPTION (MAXRECURSION 32767);
