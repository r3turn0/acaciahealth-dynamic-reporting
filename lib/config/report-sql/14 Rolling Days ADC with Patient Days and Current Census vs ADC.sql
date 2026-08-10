-------------------------------------------------------------------------------
-- 14-DAY ADC / PATIENT DAYS
-------------------------------------------------------------------------------

;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),

CurrentCensus AS
(
    SELECT
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name,
        COUNT(DISTINCT e.epi_paid) AS current_census
    FROM dbo.CLIENT_EPISODES_ALL e
    INNER JOIN dbo.SERVICE_LINES sl
        ON e.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(e.epi_branchcode) = RTRIM(b.branch_code)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
      AND e.epi_SocDate <= @AsOfDate
      AND (
            e.epi_DischargeDate IS NULL
            OR e.epi_DischargeDate > @AsOfDate
          )
    GROUP BY
        sl.sl_desc,
        b.branch_code,
        b.branch_name
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
        ON e.epi_SocDate <= d.CensusDate
       AND (
            e.epi_DischargeDate IS NULL
            OR e.epi_DischargeDate > d.CensusDate
           )
    INNER JOIN dbo.SERVICE_LINES sl
        ON e.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(e.epi_branchcode) = RTRIM(b.branch_code)
    WHERE e.epi_status = 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
    GROUP BY
        d.CensusDate,
        sl.sl_desc,
        b.branch_code,
        b.branch_name
),

ADC AS
(
    SELECT
        service_line,
        branch_code,
        branch_name,
        SUM(daily_census) AS patient_days,
        DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,
        CAST(
            SUM(daily_census) * 1.0 /
            (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
            AS DECIMAL(18,2)
        ) AS adc
    FROM DailyCensus
    GROUP BY
        service_line,
        branch_code,
        branch_name
)

SELECT
    c.service_line,
    c.branch_code,
    c.branch_name,
    @StartDate AS window_start,
    @EndDate AS window_end,
    c.current_census,
    a.patient_days,
    a.days_in_window,
    a.adc,
    CAST(c.current_census - a.adc AS DECIMAL(18,2)) AS current_vs_adc,
    CASE
        WHEN c.current_census > a.adc THEN 'ABOVE ADC'
        WHEN c.current_census < a.adc THEN 'BELOW ADC'
        ELSE 'AT ADC'
    END AS trend
FROM CurrentCensus c
INNER JOIN ADC a
    ON c.service_line = a.service_line
   AND c.branch_code = a.branch_code
   AND c.branch_name = a.branch_name
ORDER BY
    c.service_line,
    c.branch_name
OPTION (MAXRECURSION 32767);
