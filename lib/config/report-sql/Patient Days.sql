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
        e.epi_DischargeDate,
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
),
overlap AS
(
    SELECT  
        bucket,
        bucket_sort,

        DATEDIFF(DAY,
            CASE 
                WHEN epi_SocDate > @StartDate THEN epi_SocDate 
                ELSE @StartDate 
            END,
            CASE 
                WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                    THEN DATEADD(DAY, 1, @EndDate)
                ELSE epi_DischargeDate
            END
        ) AS patient_days

    FROM episodes
    WHERE epi_SocDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
)

SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,

    SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days,

    DATEDIFF(DAY, @StartDate, @EndDate) + 1 AS days_in_window,

    CAST(
        SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) * 1.0
        / (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
        AS decimal(10,2)
    ) AS implied_adc

FROM overlap
GROUP BY bucket
ORDER BY bucket_sort, bucket;