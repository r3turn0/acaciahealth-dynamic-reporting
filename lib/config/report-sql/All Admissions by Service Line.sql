/*
    Definition
        Count all admissions occurring during the reporting window
        Include New Admissions and Readmissions
        Exclude Non-Admits
        Ignore current status
*/

SELECT
    sl.sl_id AS service_line_id,
    sl.sl_desc AS service_line,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admission_count
FROM dbo.CLIENT_EPISODES_ALL e
INNER JOIN dbo.SERVICE_LINES sl
    ON sl.sl_id = e.epi_slid
WHERE
    e.epi_AdmitType IN ('NEW ADMISSION','READMISSION')
    AND e.epi_NonAdmitDate IS NULL
    AND e.epi_SocDate IS NOT NULL
    AND CAST(e.epi_SocDate AS DATE)
        BETWEEN @StartDate AND @EndDate
GROUP BY
    sl.sl_id,
    sl.sl_desc
ORDER BY
    sl.sl_id,
    sl.sl_desc;
