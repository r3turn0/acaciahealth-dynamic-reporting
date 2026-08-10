USE HCHB_AcaciaHealth;

DECLARE @EndDate DATE = CAST(GETDATE() AS DATE);
DECLARE @StartDate DATE = DATEADD(DAY,-14,@EndDate);

;WITH dim_branch AS
(
    SELECT
        m.service_line,
        m.epi_slid,
        m.epi_branchcode,
        m.branch_name
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
        ('HOSPICE',2,'SO2','ACACIA HOSPICE AND PALLIATIVE OF LA - OC')
    ) m(service_line, epi_slid, epi_branchcode, branch_name)
),

episodes AS
(
    SELECT
        e.epi_id,
        e.epi_SocDate,
        e.epi_RecertFlag,

        db.branch_name AS bucket,

        CASE
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort

    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode

    WHERE e.epi_status <> 'DELETED'
      AND e.epi_NonAdmitDate IS NULL
      AND CAST(e.epi_SocDate AS DATE)
            BETWEEN @StartDate AND @EndDate
),

flags AS
(
    SELECT
        ep.epi_id,
        ep.epi_SocDate,
        ep.epi_RecertFlag,
        ep.bucket,
        ep.bucket_sort,

        /* Face-to-face */

        CASE
            WHEN f2f.ceftf_f2fappliestoepiid IS NOT NULL
                 AND f2f.ceftf_active = 1
            THEN 1
            ELSE 0
        END AS is_f2f_compliant,

        /* Certification */

        CASE
            WHEN cert.ceat_epiid IS NOT NULL
            THEN 1
            ELSE 0
        END AS is_cert_compliant,

        /* Recertification */

        CASE
            WHEN UPPER(LTRIM(RTRIM(ISNULL(ep.epi_RecertFlag,''))))
                 IN ('Y','1','R','RECERT','TRUE')
                 AND rec.cerh_epiid IS NOT NULL
            THEN 1

            WHEN UPPER(LTRIM(RTRIM(ISNULL(ep.epi_RecertFlag,''))))
                 NOT IN ('Y','1','R','RECERT','TRUE')
            THEN 1

            ELSE 0
        END AS is_recert_compliant

    FROM episodes ep

    LEFT JOIN dbo.CLIENT_EPISODE_FACETOFACE f2f
        ON f2f.ceftf_f2fappliestoepiid = ep.epi_id

    LEFT JOIN dbo.CLIENT_EPISODE_ADMISSION_TYPES cert
        ON cert.ceat_epiid = ep.epi_id

    LEFT JOIN dbo.CLIENT_EPISODE_RECERT_HISTORY rec
        ON rec.cerh_epiid = ep.epi_id
),

scored AS
(
    SELECT
        flags.epi_id,
        flags.epi_SocDate,
        flags.epi_RecertFlag,
        flags.bucket,
        flags.bucket_sort,
        flags.is_f2f_compliant,
        flags.is_cert_compliant,
        flags.is_recert_compliant,

        CASE
            WHEN is_f2f_compliant = 1
             AND is_cert_compliant = 1
             AND is_recert_compliant = 1
            THEN 1
            ELSE 0
        END AS is_fully_compliant

    FROM flags
)

SELECT
    bucket,
    MIN(bucket_sort) AS bucket_sort,

    @StartDate AS window_start,
    @EndDate AS window_end,

    COUNT(*) AS total_episodes,

    SUM(is_f2f_compliant) AS f2f_compliant,
    SUM(is_cert_compliant) AS cert_compliant,
    SUM(is_recert_compliant) AS recert_compliant,

    SUM(is_fully_compliant) AS compliant_episodes,

    CAST(
        100.0 * SUM(is_fully_compliant)
        / NULLIF(COUNT(*),0)
        AS DECIMAL(5,1)
    ) AS qa_compliance_pct

FROM scored
GROUP BY bucket
ORDER BY bucket_sort, bucket;
