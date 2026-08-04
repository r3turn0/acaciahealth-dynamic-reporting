USE HCHB_AcaciaHealth;

DECLARE @EndDate   DATE = CAST(GETDATE() AS DATE);
DECLARE @StartDate DATE = DATEADD(DAY, -14, @EndDate);

;WITH bucket_map AS
(
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
        ('HOSPICE', 2, 'SO2', 'ACACIA HOSPICE AND PALLIATIVE OF LA - OC'),

        -- Replace bucket name once ZV1 is identified
        ('HOSPICE', 2, 'ZV1', 'ACACIA HOSPICE UNKNOWN ZV1')
    ) m(service_line, service_line_id, branch_code, bucket)
),
episodes AS
(
    SELECT
        e.epi_id,
        e.epi_DateOfReferral,
        e.epi_SocDate,
        e.epi_NonAdmitDate,

        bm.bucket,

        CASE
            WHEN bm.service_line = 'HOME HEALTH' THEN 1
            WHEN bm.service_line = 'HOSPICE'     THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN bucket_map bm
        ON bm.service_line_id = e.epi_slid
       AND bm.branch_code     = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
),
flags AS
(
    SELECT
        bucket,
        bucket_sort,

        CASE
            WHEN CAST(epi_DateOfReferral AS DATE)
                 BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_referral,

        CASE
            WHEN CAST(epi_SocDate AS DATE)
                 BETWEEN @StartDate AND @EndDate
                 AND epi_NonAdmitDate IS NULL
            THEN 1 ELSE 0
        END AS is_admission,

        CASE
            WHEN epi_NonAdmitDate IS NOT NULL
                 AND CAST(epi_NonAdmitDate AS DATE)
                     BETWEEN @StartDate AND @EndDate
            THEN 1 ELSE 0
        END AS is_nonadmit
    FROM episodes
)

SELECT
    ISNULL(bucket,'(unmapped)') AS bucket,
    MIN(bucket_sort)            AS bucket_sort,
    @StartDate                  AS window_start,
    @EndDate                    AS window_end,

    SUM(is_referral)            AS referrals,
    SUM(is_admission)           AS admissions,
    SUM(is_nonadmit)            AS non_admits,

    CAST(
        CASE
            WHEN SUM(is_referral) > 0
            THEN SUM(is_nonadmit) * 100.0 / SUM(is_referral)
        END
        AS DECIMAL(5,1)
    ) AS ntuc_pct,

    CAST(
        CASE
            WHEN SUM(is_referral) > 0
            THEN SUM(is_admission) * 100.0 / SUM(is_referral)
        END
        AS DECIMAL(5,1)
    ) AS conversion_pct

FROM flags
WHERE is_referral = 1
   OR is_admission = 1
   OR is_nonadmit = 1
GROUP BY bucket
ORDER BY bucket_sort, bucket;

;WITH bucket_map AS
(
    SELECT *
    FROM (VALUES
        ('HOME HEALTH',1,'PO1','ACACIA HOME HEALTH AND PALLIATIVE'),
        ('HOME HEALTH',1,'HL1','ACACIA HOME HEALTH SERVICES'),

        ('HOSPICE',2,'XO1','ACACIA HOSPICE AND PALLIATIVE SERVICES OC'),
        ('HOSPICE',2,'XD1','ACACIA HOSPICE OF THE DESERT D'),
        ('HOSPICE',2,'ZI1','ACACIA HOSPICE AND PALLIATIVE SERVICES IE'),
        ('HOSPICE',2,'ZD1','ACACIA HOSPICE AND PALLIATIVE SERVICES D'),
        ('HOSPICE',2,'ZS1','ACACIA HOSPICE AND PALLIATIVE SERVICES SGV'),
        ('HOSPICE',2,'SO1','ACACIA HOSPICE OF LOS ANGELES OC'),
        ('HOSPICE',2,'XS1','ACACIA HOSPICE OF LOS ANGELES'),
        ('HOSPICE',2,'SD1','ACACIA HOSPICE OF LOS ANGELES LD'),
        ('HOSPICE',2,'SI1','ACACIA HOSPICE OF LOS ANGELES IE'),
        ('HOSPICE',2,'LI1','ACACIA HOSPICE OF THE DESERT IE'),
        ('HOSPICE',2,'LS1','ACACIA HOSPICE OF THE DESERT SGV'),
        ('HOSPICE',2,'XS2','ACACIA HOSPICE AND PALLIATIVE OF LOS ANGELES'),
        ('HOSPICE',2,'LO1','ACACIA HOSPICE OF THE DESERT OC'),
        ('HOSPICE',2,'SO2','ACACIA HOSPICE AND PALLIATIVE OF LA - OC'),
        ('HOSPICE',2,'ZV1','ACACIA HOSPICE UNKNOWN ZV1')
    ) v(sl_name, sl_id, branch_code, bucket)
),
nonadmit_reason_dedup AS
(
    SELECT
        nac_code,
        MIN(nac_desc) AS nac_desc,
        CAST(MAX(CAST(nac_refusalofservice AS INT)) AS BIT) AS nac_refusalofservice
    FROM dbo.NONADMIT_REASONS
    GROUP BY nac_code
),
nonadmits AS
(
    SELECT
        e.epi_id,
        e.epi_NonAdmitCode,

        bm.bucket,

        CASE
            WHEN bm.sl_name = 'HOME HEALTH' THEN 1
            WHEN bm.sl_name = 'HOSPICE'     THEN 2
            ELSE 99
        END AS bucket_sort
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN bucket_map bm
        ON bm.sl_id       = e.epi_slid
       AND bm.branch_code = e.epi_branchcode
    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NOT NULL
      AND CAST(e.epi_NonAdmitDate AS DATE)
          BETWEEN @StartDate AND @EndDate
)

SELECT
    ISNULL(na.bucket,'(unmapped)') AS bucket,
    MIN(na.bucket_sort)            AS bucket_sort,
    @StartDate                     AS window_start,
    @EndDate                       AS window_end,

    na.epi_NonAdmitCode            AS nonadmit_code,

    ISNULL(nd.nac_desc,'(unknown reason)') AS nonadmit_reason,
    nd.nac_refusalofservice        AS refusal_of_service,

    COUNT(*)                       AS non_admit_count

FROM nonadmits na
LEFT JOIN nonadmit_reason_dedup nd
    ON nd.nac_code = na.epi_NonAdmitCode

GROUP BY
    na.bucket,
    na.epi_NonAdmitCode,
    nd.nac_desc,
    nd.nac_refusalofservice

ORDER BY
    MIN(na.bucket_sort),
    COUNT(*) DESC;