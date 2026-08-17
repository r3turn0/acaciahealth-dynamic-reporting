;WITH Dates AS
(
    SELECT @StartDate AS CensusDate
    UNION ALL
    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),
DailyCensus AS
(
    SELECT
        d.CensusDate,
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name,
        COUNT(DISTINCT e.epi_paid) AS daily_census
    FROM Dates d
    INNER JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_socdate <= d.CensusDate
       AND (e.epi_dischargedate IS NULL OR e.epi_dischargedate > d.CensusDate)
    INNER JOIN dbo.CLIENT_EPISODE_VISITS_ALL cev
        ON e.epi_id = cev.CEV_EPIID
       AND cev.CEV_VISITDATE BETWEEN @StartDate AND @EndDate
       AND cev.CEV_BILLABLE = 1
    INNER JOIN dbo.SERVICE_LINES sl
        ON e.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(e.epi_branchcode) = RTRIM(b.branch_code)
    WHERE e.epi_status IN ('CURRENT', 'RECERTIFIED', 'PENDING')
      AND e.epi_nonadmitdate IS NULL
    GROUP BY d.CensusDate, sl.sl_desc, b.branch_code, b.branch_name
),
Summary AS
(
    SELECT
        service_line,
        branch_code,
        branch_name,
        MAX(CASE WHEN CensusDate = @StartDate THEN daily_census END) AS start_census,
        MAX(CASE WHEN CensusDate = @EndDate THEN daily_census END) AS end_census,
        SUM(daily_census) AS patient_days,
        CAST(SUM(daily_census) * 1.0 / (DATEDIFF(DAY, @StartDate, @EndDate) + 1) AS DECIMAL(18,2)) AS adc
    FROM DailyCensus
    GROUP BY service_line, branch_code, branch_name
)
SELECT
    service_line,
    branch_code,
    branch_name,
    @StartDate AS window_start,
    @EndDate AS window_end,
    start_census,
    end_census,
    end_census - start_census AS census_change,
    patient_days,
    adc,
    CAST(end_census - adc AS DECIMAL(18,2)) AS current_vs_adc
FROM Summary
ORDER BY service_line
OPTION (MAXRECURSION 0);
