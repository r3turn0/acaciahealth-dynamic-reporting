DECLARE @EndDate   date = CAST(GETDATE() AS date);       -- today
DECLARE @StartDate date = DATEADD(DAY, -14, @EndDate);   -- last 14 days

/* ---- SLA cutoff (3 days after window end) ---- */
DECLARE @SLA_Cutoff date = DATEADD(DAY, 3, @EndDate);

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

/* ---- Identify HOLD line items in last 14 days ---- */
billing_holds AS
(
    SELECT
        li.li_id,
        li.li_calculatedamount,
        li.li_servicedate,
        COALESCE(i.i_branchcode, e.epi_branchcode) AS branch_code,
        i.i_status,
        li.li_ediexportdate

    FROM Billing.LINE_ITEMS li
    LEFT JOIN Billing.INVOICES i
        ON i.i_id = li.li_iid
    LEFT JOIN dbo.CLIENT_EPISODES_ALL e
        ON e.epi_id = li.li_epiid

    WHERE li.li_deleted = 0
      AND li.li_void = 0
      AND li.li_includeonclaim = 1

      -- 14-day window
      AND CAST(li.li_servicedate AS date) BETWEEN @StartDate AND @EndDate

      -- HOLD definition (same logic as original)
      AND (
            li.li_ediexportdate IS NULL
            OR i.i_status IN ('HOLD','HELD')
          )
),

/* ---- Determine SLA performance ---- */
classified AS
(
    SELECT
        bh.branch_code,
        bh.li_id,
        bh.li_calculatedamount,

        CASE
            WHEN bh.li_ediexportdate IS NOT NULL
             AND CAST(bh.li_ediexportdate AS date) <= @SLA_Cutoff
            THEN 1 ELSE 0
        END AS cleared_by_sla

    FROM billing_holds bh
)

SELECT
    ISNULL(db.branch_name,
           ISNULL(NULLIF(LTRIM(RTRIM(c.branch_code)),''),'(no branch)')
    ) AS bucket,

    CASE 
        WHEN db.service_line = 'HOME HEALTH' THEN 1
        WHEN db.service_line = 'HOSPICE' THEN 2
        ELSE 99
    END AS bucket_sort,

    c.branch_code,
    @StartDate AS window_start,
    @EndDate AS window_end,
    @SLA_Cutoff AS sla_cutoff_date,

    COUNT(*) AS total_holds,
    SUM(cleared_by_sla) AS cleared_by_sla,

    CAST(
        SUM(cleared_by_sla) * 100.0 / NULLIF(COUNT(*), 0)
        AS decimal(5,1)
    ) AS pct_cleared_by_sla,

    SUM(c.li_calculatedamount) AS total_hold_amount,

    SUM(
        CASE WHEN cleared_by_sla = 1
             THEN c.li_calculatedamount
             ELSE 0
        END
    ) AS cleared_amount

FROM classified c
LEFT JOIN dim_branch db
    ON db.epi_branchcode = c.branch_code

GROUP BY c.branch_code, db.branch_name, db.service_line
ORDER BY bucket_sort, c.branch_code;