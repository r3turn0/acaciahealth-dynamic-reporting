DECLARE @EndDate   date = CAST(GETDATE() AS date);       -- today
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);   -- last 14 days
DECLARE @AsOfDate  date = @EndDate;

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
ar AS
(
    SELECT
        i.i_id,
        i.i_branchcode AS branch_code,
        i.i_balance,
        DATEDIFF(DAY, i.i_postdate, @AsOfDate) AS age_days
    FROM Billing.INVOICES i
    WHERE i.i_balance > 0
      AND i.i_postdate IS NOT NULL
      AND i.i_postdate <= @AsOfDate
)

SELECT
    ISNULL(db.branch_name, ISNULL(NULLIF(LTRIM(RTRIM(ar.branch_code)),''),'(no branch)')) AS bucket,

    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,

    ar.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,

    SUM(CASE WHEN age_days <= 30 THEN i_balance ELSE 0 END) AS ar_0_30,
    SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN i_balance ELSE 0 END) AS ar_31_60,
    SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN i_balance ELSE 0 END) AS ar_61_90,
    SUM(CASE WHEN age_days > 90 THEN i_balance ELSE 0 END) AS ar_over_90,
    SUM(i_balance) AS ar_total

FROM ar
LEFT JOIN dim_branch db
    ON db.epi_branchcode = ar.branch_code
GROUP BY ar.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, ar.branch_code;

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name FROM (VALUES
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
ar90 AS
(
    SELECT
        i.i_branchcode AS branch_code,
        i.i_balance
    FROM Billing.INVOICES i
    WHERE i.i_balance > 0
      AND DATEDIFF(DAY, i.i_postdate, @AsOfDate) > 90
)

SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,

    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,

    ar90.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS invoices_over_90,
    SUM(ar90.i_balance) AS ar_over_90

FROM ar90
LEFT JOIN dim_branch db
    ON db.epi_branchcode = ar90.branch_code
GROUP BY ar90.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, branch_code

;WITH dim_branch (service_line, epi_slid, epi_branchcode, branch_name) AS
(
    SELECT v.service_line, v.epi_slid, v.epi_branchcode, v.branch_name FROM (VALUES
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
unbilled AS
(
    SELECT
        li.li_id,
        li.li_calculatedamount,
        COALESCE(i.i_branchcode, e.epi_branchcode) AS branch_code
    FROM Billing.LINE_ITEMS li
    LEFT JOIN Billing.INVOICES i ON i.i_id = li.li_iid
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e ON e.epi_id = li.li_epiid
    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1
      AND li.li_ediexportdate IS NULL
      AND li.li_iid IS NULL
)

SELECT
    ISNULL(db.branch_name, '(unmapped)') AS bucket,

    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,

    u.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS unbilled_line_items,
    SUM(ISNULL(li_calculatedamount,0)) AS unbilled_amount

FROM unbilled u
LEFT JOIN dim_branch db
    ON db.epi_branchcode = u.branch_code
GROUP BY u.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, branch_code;
