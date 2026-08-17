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
        COUNT(DISTINCT epi_paid) AS daily_census
    FROM dbo.V_AL_HOSPICEDAILYCENSUSINFO
    WHERE ServiceDate BETWEEN @StartDate AND @EndDate
    GROUP BY ServiceDate, [Client Brnch]
),
Summary AS
(
    SELECT
        service_line,
        branch_code,
        branch_name,
        MAX(CASE WHEN CensusDate = @StartDate THEN daily_census END) AS start_census,
        MAX(CASE WHEN CensusDate = @EndDate THEN daily_census END) AS end_census,
        SUM(daily_census) AS patient_days,
        CAST(SUM(daily_census) * 1.0 / (DATEDIFF(DAY, @StartDate, @EndDate) + 1) AS DECIMAL(18,2)) AS adc
    FROM DailyCensus
    GROUP BY service_line, branch_code, branch_name
)
SELECT
    service_line,
    branch_code,
    branch_name,
    @StartDate AS window_start,
    @EndDate AS window_end,
    start_census,
    end_census,
    end_census - start_census AS census_change,
    patient_days,
    adc,
    CAST(end_census - adc AS DECIMAL(18,2)) AS current_vs_adc
FROM Summary
ORDER BY branch_name;
