;WITH Dates AS
(
    SELECT @StartDate AS CensusDate

    UNION ALL

    SELECT DATEADD(DAY, 1, CensusDate)
    FROM Dates
    WHERE CensusDate < @EndDate
),
EligiblePatients AS
(
    SELECT DISTINCT
          ce.epi_paid
        , ce.epi_id
        , ce.epi_branchcode
        , ce.epi_SOCDate
        , ce.epi_DischargeDate
    FROM dbo.CLIENT_EPISODES_ALL ce
    WHERE ce.epi_status IN ('CURRENT', 'RECERTIFIED')
      AND ce.epi_status NOT IN ('NON-ADMIT', 'DELETED')
      AND EXISTS
      (
            SELECT 1
            FROM dbo.CLIENT_EPISODE_VISITS_ALL v
            WHERE v.CEV_EPIID = ce.epi_id
              AND ISNULL(v.CEV_deleted, 0) = 0
      )
),
DailyCensus AS
(
    SELECT
          d.CensusDate
        , ep.epi_branchcode
        , CASE
              WHEN ep.epi_branchcode = 'HL1' THEN 'HH'
              WHEN ep.epi_branchcode = 'PO1' THEN 'Palliative'
              WHEN ep.epi_branchcode = 'XO1' THEN 'Hospice OC'
              WHEN ep.epi_branchcode = 'ZI1' THEN 'Hospice IE'
              WHEN ep.epi_branchcode = 'ZS1' THEN 'Hospice SGV'
              WHEN ep.epi_branchcode IN ('XD1', 'ZD1') THEN 'Hospice Desert'
              ELSE 'Other'
          END AS KPI_ServiceLine
        , COUNT(DISTINCT ep.epi_paid) AS DailyCensus
    FROM Dates d
    INNER JOIN EligiblePatients ep
        ON ep.epi_SOCDate <= d.CensusDate
       AND (
                ep.epi_DischargeDate IS NULL
             OR ep.epi_DischargeDate > d.CensusDate
           )
    GROUP BY
          d.CensusDate
        , ep.epi_branchcode
),
BranchADC AS
(
    SELECT
          KPI_ServiceLine
        , epi_branchcode
        , SUM(DailyCensus) AS PatientDays
        , COUNT(*) AS DaysInPeriod
        , CAST(SUM(DailyCensus) AS DECIMAL(18, 2)) / COUNT(*) AS ADC
    FROM DailyCensus
    GROUP BY
          KPI_ServiceLine
        , epi_branchcode
)
SELECT
      x.KPI_ServiceLine
    , x.BranchCode
    , x.PatientDays
    , x.DaysInPeriod
    , x.ADC
    , x.HCE
    , x.SortOrder
FROM
(
    SELECT
          KPI_ServiceLine
        , epi_branchcode AS BranchCode
        , PatientDays
        , DaysInPeriod
        , ADC
        , NULL AS HCE
        , 1 AS SortOrder
    FROM BranchADC

    UNION ALL

    SELECT
          'HH + PAL' AS KPI_ServiceLine
        , NULL AS BranchCode
        , SUM(PatientDays) AS PatientDays
        , MAX(DaysInPeriod) AS DaysInPeriod
        , SUM(ADC) AS ADC
        , CASE
              WHEN SUM(ADC) IS NOT NULL THEN SUM(ADC) * 0.40
          END AS HCE
        , 2 AS SortOrder
    FROM BranchADC
    WHERE KPI_ServiceLine IN ('HH', 'Palliative')

    UNION ALL

    SELECT
          'Total Hospice' AS KPI_ServiceLine
        , NULL AS BranchCode
        , SUM(PatientDays) AS PatientDays
        , MAX(DaysInPeriod) AS DaysInPeriod
        , SUM(ADC) AS ADC
        , NULL AS HCE
        , 3 AS SortOrder
    FROM BranchADC
    WHERE KPI_ServiceLine IN
    (
        'Hospice OC',
        'Hospice IE',
        'Hospice SGV',
        'Hospice Desert'
    )
) x
ORDER BY
      x.SortOrder
    , x.KPI_ServiceLine
    , x.BranchCode
OPTION (MAXRECURSION 32767);
