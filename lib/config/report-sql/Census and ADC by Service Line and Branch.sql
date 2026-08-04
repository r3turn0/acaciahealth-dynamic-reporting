USE HCHB_AcaciaHealth
DECLARE @EndDate   date = CAST(GETDATE() AS date);       -- today
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);   -- last 14 days
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
    b.branch_name