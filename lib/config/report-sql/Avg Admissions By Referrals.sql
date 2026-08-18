/*
    Definition
        Use all valid admissions
        Referral date required
        Measure referral-to-SOC performance
        Do not use this population to calculate admission volume
*/

;WITH admissions AS
(
    SELECT
        sl.sl_id AS service_line_id,
        sl.sl_desc AS service_line,
        b.branch_code,
        b.branch_name,
        DATEDIFF(
            DAY,
            CAST(e.epi_DateOfReferral AS DATE),
            CAST(e.epi_SocDate AS DATE)
        ) AS days_to_admit
    FROM dbo.CLIENT_EPISODES_ALL e
    INNER JOIN dbo.SERVICE_LINES sl
        ON sl.sl_id = e.epi_slid
    INNER JOIN dbo.BRANCHES b
        ON RTRIM(b.branch_code) = RTRIM(e.epi_branchcode)
    WHERE
        e.epi_AdmitType IN ('NEW ADMISSION','READMISSION')
        AND e.epi_NonAdmitDate IS NULL
        AND e.epi_DateOfReferral IS NOT NULL
        AND e.epi_SocDate IS NOT NULL
        AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
        AND CAST(e.epi_SocDate AS DATE)
            >= CAST(e.epi_DateOfReferral AS DATE)
)
SELECT
    service_line_id,
    service_line,
    branch_code,
    branch_name,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS admissions_with_referral,
    CAST(AVG(days_to_admit * 1.0) AS DECIMAL(10,2)) AS avg_days_to_admit,
    CAST(
        SUM(CASE WHEN days_to_admit <= 2 THEN 1 ELSE 0 END)
        * 100.0 / COUNT(*)
        AS DECIMAL(5,2)
    ) AS pct_within_2_days
FROM admissions
GROUP BY service_line_id, service_line, branch_code, branch_name
ORDER BY service_line, branch_name;
