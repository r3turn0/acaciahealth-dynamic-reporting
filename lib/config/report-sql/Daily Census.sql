;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
)

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
ORDER BY
    d.CensusDate,
    sl.sl_desc,
    b.branch_code,
    b.branch_name
OPTION (MAXRECURSION 32767);
