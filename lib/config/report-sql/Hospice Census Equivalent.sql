/* =============================================================================
   02_hospice_census_equivalent.sql (REFACTORED)
============================================================================= */

USE HCHB_AcaciaHealth;

DECLARE @AsOfDate  date         = CAST(GETDATE() AS date);
DECLARE @HceFactor decimal(5,3) = 0.40;


/* ============================================================================
   DIMENSION (shared pattern)
============================================================================ */
WITH dim_branch AS (
    SELECT *
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS d(service_line, epi_slid, epi_branchcode, branch_name)
),

/* ============================================================================
   EPISODES
============================================================================ */
episodes AS (
    SELECT
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        e.epi_NonAdmitDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status <> 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),

/* ============================================================================
   CURRENT CENSUS (same logic as KPI #1)
============================================================================ */
census AS (
    SELECT
        service_line,
        branch_name,
        COUNT(*) AS current_census
    FROM episodes
    WHERE epi_SocDate <= @AsOfDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
    GROUP BY service_line, branch_name
)
/* ============================================================================
   RESULT 1: HCE per branch
============================================================================ */
SELECT
    branch_name AS bucket,
    service_line,
    @AsOfDate AS as_of_date,
    @HceFactor AS hce_factor,
    current_census AS raw_census,
    CAST(
        CASE
            WHEN service_line = 'HOME HEALTH'
                THEN current_census * @HceFactor
            ELSE current_census
        END AS decimal(10,2)
    ) AS hce_value
FROM census;
-- ============================================================================
-- RESULT 2: HH + Palliative Combined HCE
-- ============================================================================
;WITH dim_branch AS (
    SELECT *
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS d(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        e.epi_NonAdmitDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status <> 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),
/* ============================================================================
   CURRENT CENSUS (same logic as KPI #1)
============================================================================ */
census AS (
    SELECT
        service_line,
        branch_name,
        COUNT(*) AS current_census
    FROM episodes
    WHERE epi_SocDate <= @AsOfDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
    GROUP BY service_line, branch_name
),
hh_pal AS (
    SELECT
        SUM(current_census) AS raw_hh_pal_census
    FROM census
    WHERE service_line = 'HOME HEALTH'
)
SELECT
    'HH+Palliative' AS bucket,
    @AsOfDate AS as_of_date,
    @HceFactor AS hce_factor,
    raw_hh_pal_census,
    CAST(raw_hh_pal_census * @HceFactor AS decimal(10,2)) AS hce_value
FROM hh_pal;
-- ============================================================================
-- RESULT 3: TOTAL HCE (ALL LOCATIONS)
-- ============================================================================
;WITH dim_branch AS (
    SELECT *
    FROM (VALUES
        ('HOME HEALTH', 1, 'PO1', 'ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH', 1, 'HL1', 'ACACIA HOME HEALTH SERVICES'),
        ('HOSPICE', 2, 'XO1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE', 2, 'XD1', 'ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE', 2, 'ZI1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE', 2, 'ZD1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE', 2, 'ZS1', 'ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE', 2, 'SO1', 'ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE', 2, 'XS1', 'ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE', 2, 'SD1', 'ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE', 2, 'SI1', 'ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE', 2, 'LI1', 'ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE', 2, 'LS1', 'ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE', 2, 'XS2', 'ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE', 2, 'LO1', 'ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) AS d(service_line, epi_slid, epi_branchcode, branch_name)
),
episodes AS (
    SELECT
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        e.epi_NonAdmitDate,
        d.service_line,
        d.branch_name
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch d
        ON d.epi_slid = e.epi_slid
       AND RTRIM(d.epi_branchcode) = RTRIM(e.epi_branchcode)
    WHERE e.epi_status <> 'CURRENT'
      AND e.epi_NonAdmitDate IS NULL
),
/* ============================================================================
   CURRENT CENSUS (same logic as KPI #1)
============================================================================ */
census AS (
    SELECT
        service_line,
        branch_name,
        COUNT(*) AS current_census
    FROM episodes
    WHERE epi_SocDate <= @AsOfDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @AsOfDate)
    GROUP BY service_line, branch_name
)
SELECT
    'ALL LOCATIONS' AS bucket,
    @AsOfDate AS as_of_date,
    @HceFactor AS hce_factor,
    SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) AS raw_hh_pal_census,
    SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)     AS raw_hospice_census,
    CAST(
        SUM(CASE WHEN service_line = 'HOSPICE' THEN current_census ELSE 0 END)
      + SUM(CASE WHEN service_line = 'HOME HEALTH' THEN current_census ELSE 0 END) * @HceFactor
        AS decimal(10,2)
    ) AS total_hce
FROM census;