/*
    Definition
        Count Home Health admissions occurring during the reporting window
        Include New Admissions and Readmissions
        Exclude Non-Admits
        Group by authoritative service line, branch, and primary care type
*/

;WITH episodes AS (
    SELECT
        e.epi_id,
        e.epi_SocDate,
        sl.sl_id AS service_line_id,
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    INNER JOIN dbo.SERVICE_LINES sl
        ON sl.sl_id = e.epi_slid
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(b.branch_code) = RTRIM(e.epi_branchcode)
    WHERE
        e.epi_AdmitType IN ('NEW ADMISSION','READMISSION')
        AND e.epi_NonAdmitDate IS NULL
        AND e.epi_SocDate IS NOT NULL
        AND UPPER(RTRIM(LTRIM(sl.sl_desc))) = 'HOME HEALTH'
)
SELECT
    e.service_line_id,
    e.service_line,
    e.branch_code,
    e.branch_name,
    ISNULL(ct.ctype_description,'(no primary care type)') AS care_type,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admission_count
FROM episodes e
LEFT JOIN dbo.CLIENT_EPISODE_CARE_TYPES cect
    ON cect.cect_epiid = e.epi_id
    AND cect.cect_primary = 'Y'
LEFT JOIN dbo.CARE_TYPES ct
    ON ct.ctype_id = cect.cect_ctypeid
WHERE CAST(e.epi_SocDate AS DATE)
      BETWEEN @StartDate AND @EndDate
GROUP BY
    e.service_line_id,
    e.service_line,
    e.branch_code,
    e.branch_name,
    ISNULL(ct.ctype_description,'(no primary care type)')
ORDER BY
    e.branch_name,
    care_type;
