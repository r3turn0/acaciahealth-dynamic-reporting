/*
    Definition
        Admissions occurring in reporting period
        Must still be active/current
        Exclude Non-Admits
*/

SELECT
    sl.sl_id AS service_line_id,
    sl.sl_desc AS service_line,
    b.branch_code,
    b.branch_name,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS current_admission_count
FROM dbo.CLIENT_EPISODES_ALL e
INNER JOIN dbo.SERVICE_LINES sl
    ON sl.sl_id = e.epi_slid
INNER JOIN dbo.BRANCHES b
    ON RTRIM(b.branch_code) = RTRIM(e.epi_branchcode)
WHERE
    e.epi_status = 'CURRENT'
    AND e.epi_AdmitType IN ('NEW ADMISSION','READMISSION')
    AND e.epi_NonAdmitDate IS NULL
    AND e.epi_SocDate IS NOT NULL
    AND CAST(e.epi_SocDate AS DATE)
        BETWEEN @StartDate AND @EndDate
GROUP BY
    sl.sl_id,
    sl.sl_desc,
    b.branch_code,
    b.branch_name
ORDER BY
    sl.sl_desc,
    b.branch_name;
