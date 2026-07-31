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
episodes AS
(
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        e.epi_RecertFlag,
        db.branch_name AS bucket,

        -- recreate bucket_sort
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        CASE 
            WHEN UPPER(LTRIM(RTRIM(e.epi_RecertFlag))) IN ('Y','1','R','RECERT','TRUE')
            THEN 1 ELSE 0
        END AS is_recert

    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'RECERTIFIED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
)

SELECT
    ISNULL(bucket, '(unmapped)')      AS bucket,
    MIN(bucket_sort)                  AS bucket_sort,
    @StartDate                        AS window_start,
    @EndDate                          AS window_end,
    SUM(is_recert)                    AS recert_count,
    COUNT(*)                          AS total_cert_count,
    CAST(
        CASE WHEN COUNT(*) > 0
             THEN SUM(is_recert) * 100.0 / COUNT(*)
             ELSE NULL
        END AS decimal(5,1)
    ) AS recert_pct
FROM episodes
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
episodes AS
(
    SELECT  
        e.epi_id,
        e.epi_SocDate,
        e.epi_DischargeDate,
        db.branch_name AS bucket,

        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        CASE 
            WHEN UPPER(LTRIM(RTRIM(e.epi_RecertFlag))) IN ('Y','1','R','RECERT','TRUE')
             AND CAST(e.epi_SocDate AS date) BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_recert_in_window

    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE e.epi_status <> 'RECERTIFIED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS date) <= @EndDate
      AND (e.epi_DischargeDate IS NULL OR CAST(e.epi_DischargeDate AS date) >= @StartDate)
)

SELECT
    ISNULL(bucket, '(unmapped)')      AS bucket,
    MIN(bucket_sort)                  AS bucket_sort,
    @StartDate                        AS window_start,
    @EndDate                          AS window_end,
    SUM(is_recert_in_window)          AS recert_count,
    COUNT(*)                          AS total_episode_count,
    CAST(
        CASE WHEN COUNT(*) > 0
             THEN SUM(is_recert_in_window) * 100.0 / COUNT(*)
             ELSE NULL
        END AS decimal(5,1)
    ) AS recert_pct_of_episodes
FROM episodes
GROUP BY bucket
ORDER BY bucket_sort, bucket;

