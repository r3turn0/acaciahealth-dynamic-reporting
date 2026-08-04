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
revenue AS
(
    SELECT  
        db.branch_name AS bucket,

        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        li.li_calculatedamount AS amount

    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid
       AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db
        ON db.epi_slid = li.li_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
)

SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    CAST(SUM(amount) AS decimal(18,2)) AS revenue
FROM revenue
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

-- revenue aggregation
revenue AS
(
    SELECT  
        db.branch_name AS bucket,

        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,

        SUM(li.li_calculatedamount) AS revenue

    FROM Billing.LINE_ITEMS li
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid
       AND e.epi_status <> 'DELETED'
    LEFT JOIN dim_branch db
        ON db.epi_slid = li.li_slid
       AND db.epi_branchcode = e.epi_branchcode
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_servicedate BETWEEN @StartDate AND @EndDate
    GROUP BY db.branch_name, db.service_line
),

-- patient days logic (same as KPI #5)
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
            CASE WHEN epi_SocDate > @StartDate THEN epi_SocDate ELSE @StartDate END,
            CASE 
                WHEN epi_DischargeDate IS NULL OR epi_DischargeDate > @EndDate
                    THEN DATEADD(DAY, 1, @EndDate)
                ELSE epi_DischargeDate
            END
        ) AS patient_days

    FROM episodes
    WHERE epi_SocDate <= @EndDate
      AND (epi_DischargeDate IS NULL OR epi_DischargeDate > @StartDate)
),

patient_days AS
(
    SELECT
        bucket,
        bucket_sort,
        SUM(CASE WHEN patient_days > 0 THEN patient_days ELSE 0 END) AS patient_days
    FROM overlap
    GROUP BY bucket, bucket_sort
),

combined AS
(
    SELECT  
        COALESCE(r.bucket, pd.bucket) AS bucket,
        COALESCE(r.bucket_sort, pd.bucket_sort) AS bucket_sort,
        r.revenue,
        pd.patient_days
    FROM revenue r
    FULL OUTER JOIN patient_days pd
        ON pd.bucket = r.bucket
)

SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    CAST(ISNULL(revenue, 0) AS decimal(18,2)) AS revenue,
    ISNULL(patient_days, 0) AS patient_days,
    CASE 
        WHEN ISNULL(patient_days, 0) > 0
        THEN CAST(ISNULL(revenue, 0) * 1.0 / patient_days AS decimal(18,2))
        ELSE NULL
    END AS revenue_per_patient_day
FROM combined
ORDER BY bucket_sort, bucket;