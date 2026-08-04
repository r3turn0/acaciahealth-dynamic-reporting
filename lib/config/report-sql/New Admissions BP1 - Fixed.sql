USE HCHB_AcaciaHealth;

DECLARE @EndDate   DATE = CAST(GETDATE() AS DATE);
DECLARE @StartDate DATE = DATEADD(DAY, -14, @EndDate);

-- =========================================
-- STEP 1: Admissions in Reporting Window
-- =========================================
WITH admissions AS
(
    SELECT
        e.epi_id,
        e.epi_SocDate
    FROM dbo.CLIENT_EPISODES_ALL e
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),

-- =========================================
-- STEP 2: First SOC/BP1 Visit
-- =========================================
bp1_visits AS
(
    SELECT
        v.cev_epiid AS epi_id,
        MIN(v.cev_visitdate) AS bp1_date
    FROM dbo.CLIENT_EPISODE_VISITS v
    WHERE v.cev_setsocdateflag = 'Y'
    GROUP BY v.cev_epiid
),

-- =========================================
-- STEP 3: Compliance Evaluation
-- =========================================
kpi_calc AS
(
    SELECT
        a.epi_id,
        a.epi_SocDate,
        b.bp1_date,

        CASE
            WHEN b.bp1_date IS NOT NULL
             AND DATEDIFF(HOUR,
                          a.epi_SocDate,
                          b.bp1_date) <= 48
            THEN 1
            ELSE 0
        END AS bp1_within_48hrs

    FROM admissions a
    LEFT JOIN bp1_visits b
        ON b.epi_id = a.epi_id
)

-- =========================================
-- FINAL KPI OUTPUT
-- =========================================
SELECT
    COUNT(*) AS total_admissions,

    SUM(bp1_within_48hrs) AS bp1_compliant,

    CAST(
        ROUND(
            100.0 * SUM(bp1_within_48hrs)
            / NULLIF(COUNT(*), 0),
            2
        )
        AS DECIMAL(10,2)
    ) AS bp1_compliance_percent,

    CASE
        WHEN (
            100.0 * SUM(bp1_within_48hrs)
            / NULLIF(COUNT(*), 0)
        ) >= 80
        THEN '✅ Meets KPI (>=80%)'
        ELSE '❌ Below KPI'
    END AS kpi_status

FROM kpi_calc;

WITH admissions AS
(
    SELECT
        e.epi_id,
        e.epi_SocDate
    FROM dbo.CLIENT_EPISODES_ALL e
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),
bp1_visits AS
(
    SELECT
        v.cev_epiid,
        MIN(v.cev_visitdate) AS bp1_date
    FROM dbo.CLIENT_EPISODE_VISITS v
    WHERE v.cev_setsocdateflag = 'Y'
    GROUP BY v.cev_epiid
)
SELECT
    a.epi_id,
    a.epi_SocDate,
    b.bp1_date,
    DATEDIFF(HOUR,a.epi_SocDate,b.bp1_date) AS hours_to_bp1,

    CASE
        WHEN b.bp1_date IS NULL THEN 'No BP1'
        WHEN DATEDIFF(HOUR,a.epi_SocDate,b.bp1_date) <= 48 THEN 'Compliant'
        ELSE 'Late'
    END AS bp1_status

FROM admissions a
LEFT JOIN bp1_visits b
    ON b.cev_epiid = a.epi_id
ORDER BY a.epi_SocDate;