-------------------------------------------------------------------------------
-- CURRENT CENSUS
-------------------------------------------------------------------------------

SELECT
    sl.sl_desc AS service_line,
    b.branch_code,
    b.branch_name,
    @AsOfDate AS as_of_date,
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
ORDER BY
    sl.sl_desc,
    b.branch_name;
