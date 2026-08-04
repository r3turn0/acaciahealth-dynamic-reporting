DECLARE @EndDate   date = CAST(GETDATE() AS date);       -- today
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);   -- last 14 days

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
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
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),
lupa_codes AS
(
    SELECT * FROM (VALUES
        ('LUPA'),
        ('L')
    ) AS c(code)
),
periods AS
(
    SELECT
        pp.pp_id,
        db.branch_name AS bucket,

        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        CASE WHEN lc.code IS NOT NULL THEN 1 ELSE 0 END AS is_lupa

    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    INNER JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = fs.cefs_epiid

    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode

    LEFT JOIN lupa_codes lc
        ON LTRIM(RTRIM(pp.pp_reimbursementType)) = lc.code

    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
      AND e.epi_status <> 'DELETED'
)

SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(is_lupa) AS lupa_periods,
    COUNT(*) AS total_periods,
    CAST(
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE SUM(is_lupa) * 100.0 / COUNT(*)
        END AS decimal(6,2)
    ) AS lupa_pct
FROM periods
GROUP BY bucket
ORDER BY bucket_sort, bucket;

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name
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
    ) AS v(service_line, epi_slid, epi_branchcode, branch_name)
),

period_visits AS
(
    SELECT  
        pp.pp_id,
        COUNT(v.CEV_ID) AS visit_count
    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    LEFT JOIN dbo.CLIENT_EPISODE_VISITS_ALL v
        ON v.CEV_EPIID = fs.cefs_epiid
       AND v.cev_deleted = 0
       AND v.CEV_BILLABLE = 1
       AND CAST(v.CEV_VISITDATE AS date)
            BETWEEN pp.pp_startDate AND pp.pp_endDate
    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
    GROUP BY pp.pp_id
),

periods AS
(
    SELECT
        pp.pp_id,
        db.branch_name AS bucket,

        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        pv.visit_count,
        hp.ph_lupaThreshold,

        CASE 
            WHEN hp.ph_lupaThreshold IS NOT NULL
             AND pv.visit_count < hp.ph_lupaThreshold
            THEN 1 ELSE 0
        END AS is_lupa

    FROM PDGM.PDGM_PERIOD pp
    INNER JOIN dbo.CLIENT_EPISODE_FS fs ON fs.cefs_id = pp.pp_cefsId
    INNER JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = fs.cefs_epiid

    LEFT JOIN period_visits pv ON pv.pp_id = pp.pp_id
    LEFT JOIN dbo.PDGM_HIPPS hp
        ON hp.ph_hipps = LTRIM(RTRIM(pp.pp_currentHipps))

    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode

    WHERE pp.pp_deleted = 0
      AND pp.pp_periodEnded = 1
      AND pp.pp_endDate BETWEEN @StartDate AND @EndDate
      AND e.epi_status <> 'DELETED'
)

SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(is_lupa) AS lupa_periods,
    COUNT(*) AS total_periods,
    CAST(
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE SUM(is_lupa) * 100.0 / COUNT(*)
        END AS decimal(6,2)
    ) AS lupa_pct
FROM periods
GROUP BY bucket
ORDER BY bucket_sort, bucket;
