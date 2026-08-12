
;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),
CensusData AS
(
    SELECT
        d.CensusDate,
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name,
        COUNT(DISTINCT e.epi_paid) AS current_census
    FROM Dates d
    INNER JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_status = 'CURRENT'
       AND e.epi_NonAdmitDate IS NULL
       AND e.epi_SocDate <= d.CensusDate
       AND (
            e.epi_DischargeDate IS NULL
            OR e.epi_DischargeDate > d.CensusDate
           )
    INNER JOIN dbo.SERVICE_LINES sl
        ON e.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(e.epi_branchcode) = RTRIM(b.branch_code)
    GROUP BY
        d.CensusDate,
        sl.sl_desc,
        b.branch_code,
        b.branch_name
)

SELECT
    CensusDate,
    service_line,
    branch_code,
    branch_name,
    current_census,
    LAG(current_census) OVER (
        PARTITION BY branch_code, branch_name, service_line
        ORDER BY CensusDate
    ) AS prior_day_census,
    current_census -
        LAG(current_census) OVER (
            PARTITION BY branch_code, branch_name, service_line
            ORDER BY CensusDate
        ) AS variance
FROM CensusData
ORDER BY
    CensusDate,
    service_line,
    branch_code,
    branch_name
OPTION (MAXRECURSION 32767);

;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),
CensusData AS
(
    SELECT
        d.CensusDate,
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name,
        COUNT(DISTINCT e.epi_paid) AS current_census
    FROM Dates d
    INNER JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_status = 'CURRENT'
       AND e.epi_NonAdmitDate IS NULL
       AND e.epi_SocDate <= d.CensusDate
       AND (
            e.epi_DischargeDate IS NULL
            OR e.epi_DischargeDate > d.CensusDate
           )
    INNER JOIN dbo.SERVICE_LINES sl
        ON e.epi_slid = sl.sl_id
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(e.epi_branchcode) = RTRIM(b.branch_code)
    GROUP BY
        d.CensusDate,
        sl.sl_desc,
        b.branch_code,
        b.branch_name
)

SELECT
    CensusDate,
    service_line,
    branch_code,
    branch_name,
    current_census,
    LAG(current_census) OVER (
        PARTITION BY branch_code, branch_name, service_line
        ORDER BY CensusDate
    ) AS prior_day_census,
    current_census -
        LAG(current_census) OVER (
            PARTITION BY branch_code, branch_name, service_line
            ORDER BY CensusDate
        ) AS variance,
        ROUND(
    (
        (current_census -
            LAG(current_census) OVER (
                PARTITION BY branch_code, branch_name, service_line
                ORDER BY CensusDate
            )
        ) * 100.0
    ) /
    NULLIF(
        LAG(current_census) OVER (
            PARTITION BY branch_code, branch_name, service_line
            ORDER BY CensusDate
        ),
        0
    ),
    2
) AS variance_pct
FROM CensusData
ORDER BY
    CensusDate,
    service_line,
    branch_code,
    branch_name
OPTION (MAXRECURSION 32767);
