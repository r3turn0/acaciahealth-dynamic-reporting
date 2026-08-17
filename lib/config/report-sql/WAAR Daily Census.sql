;WITH DailyCensus AS
(
    SELECT
        ServiceDate AS CensusDate,
        'HOSPICE' AS service_line,
        CASE
            WHEN [Client Brnch] = 'ACACIA HOSPICE AND PALLIATIVE SERVICES D' THEN 'ZD1'
            WHEN [Client Brnch] = 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE' THEN 'ZI1'
            WHEN [Client Brnch] = 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC' THEN 'XO1'
            WHEN [Client Brnch] = 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV' THEN 'ZS1'
            WHEN [Client Brnch] = 'ACACIA HOSPICE OF THE DESERT D' THEN 'XD1'
            WHEN [Client Brnch] = 'ACACIA HOSPICE OF THE DESERT IE' THEN 'LI1'
        END AS branch_code,
        [Client Brnch] AS branch_name,
        COUNT(DISTINCT epi_paid) AS current_census
    FROM dbo.V_AL_HOSPICEDAILYCENSUSINFO
    WHERE ServiceDate BETWEEN @StartDate AND @EndDate
    GROUP BY ServiceDate, [Client Brnch]
)
SELECT
    CensusDate,
    service_line,
    branch_code,
    branch_name,
    current_census,
    LAG(current_census) OVER (PARTITION BY branch_code ORDER BY CensusDate) AS prior_day_census,
    current_census - LAG(current_census) OVER (PARTITION BY branch_code ORDER BY CensusDate) AS variance,
    CAST(
        (current_census - LAG(current_census) OVER (PARTITION BY branch_code ORDER BY CensusDate)) * 100.0
        / NULLIF(LAG(current_census) OVER (PARTITION BY branch_code ORDER BY CensusDate), 0)
        AS DECIMAL(18,2)
    ) AS variance_pct
FROM DailyCensus
ORDER BY branch_code, CensusDate;
