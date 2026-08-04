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
dc_class AS (
    SELECT * FROM (VALUES
        ('DTH', 'Death'),
        ('EXP', 'Death'),
        ('REV', 'LiveDC-PatientInitiated'),
        ('TRH', 'LiveDC-PatientInitiated'),
        ('EXT', 'LiveDC-HospiceInitiated'),
        ('NLT', 'LiveDC-HospiceInitiated'),
        ('OOA', 'LiveDC-HospiceInitiated'),
        ('DFC', 'LiveDC-HospiceInitiated'),
        ('TXI', 'Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        e.epi_id,
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
    WHERE e.epi_status <> 'DISCHARGED' 
        AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    COUNT(*) AS total_discharges
FROM discharges
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
dc_class AS (
    SELECT * FROM (VALUES
        ('DTH','Death'),('EXP','Death'),
        ('REV','LiveDC-PatientInitiated'),('TRH','LiveDC-PatientInitiated'),
        ('EXT','LiveDC-HospiceInitiated'),('NLT','LiveDC-HospiceInitiated'),
        ('OOA','LiveDC-HospiceInitiated'),('DFC','LiveDC-HospiceInitiated'),
        ('TXI','Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        e.epi_id,
        e.epi_DcCode,
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        ISNULL(cl.dc_class, 'Other') AS dc_class
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN dc_class cl
        ON RTRIM(cl.dr_code) = RTRIM(e.epi_DcCode)
    WHERE e.epi_status = 'DISCHARGED'
    AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    dc_class,
    COUNT(*) AS discharges,
    COUNT(DISTINCT RTRIM(epi_DcCode)) AS distinct_dc_codes
FROM discharges
GROUP BY bucket, dc_class
ORDER BY bucket_sort, dc_class;

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
dc_class AS (
    SELECT * FROM (VALUES
        ('DTH','Death'),('EXP','Death'),
        ('REV','LiveDC-PatientInitiated'),('TRH','LiveDC-PatientInitiated'),
        ('EXT','LiveDC-HospiceInitiated'),('NLT','LiveDC-HospiceInitiated'),
        ('OOA','LiveDC-HospiceInitiated'),('DFC','LiveDC-HospiceInitiated'),
        ('TXI','Other')
    ) AS c(dr_code, dc_class)
),
discharges AS (
    SELECT
        db.branch_name AS bucket,
        CASE 
            WHEN db.service_line = 'HOME HEALTH' THEN 1
            WHEN db.service_line = 'HOSPICE' THEN 2
            ELSE 99
        END AS bucket_sort,
        ISNULL(cl.dc_class, 'Other') AS dc_class
    FROM dbo.CLIENT_EPISODES_ALL e
    LEFT JOIN dim_branch db
        ON db.epi_slid = e.epi_slid
       AND db.epi_branchcode = e.epi_branchcode
    LEFT JOIN dc_class cl
        ON RTRIM(cl.dr_code) = RTRIM(e.epi_DcCode)
    WHERE e.epi_status <> 'DISCHARGED'
        AND e.epi_DischargeDate >= @StartDate
      AND e.epi_DischargeDate < DATEADD(DAY, 1, @EndDate)
)
SELECT
    ISNULL(bucket, '(unmapped)') AS bucket,
    MIN(bucket_sort) AS bucket_sort,
    @StartDate AS window_start,
    @EndDate AS window_end,
    SUM(CASE WHEN dc_class = 'LiveDC-PatientInitiated' THEN 1 ELSE 0 END) AS live_dc_patient_initiated,
    SUM(CASE WHEN dc_class = 'LiveDC-HospiceInitiated' THEN 1 ELSE 0 END) AS live_dc_hospice_initiated,
    SUM(CASE WHEN dc_class IN ('LiveDC-PatientInitiated','LiveDC-HospiceInitiated') THEN 1 ELSE 0 END) AS live_dc_total,
    SUM(CASE WHEN dc_class = 'Death' THEN 1 ELSE 0 END) AS deaths,
    SUM(CASE WHEN dc_class = 'Other' THEN 1 ELSE 0 END) AS other_or_unmapped
FROM discharges
GROUP BY bucket
ORDER BY bucket_sort, bucket;
