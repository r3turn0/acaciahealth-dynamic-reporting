SELECT
    wl_id,
    wl_wkrid,
    wl_jdid,
    wl_expirationdate,
    wl_insertdate,
    wl_lastupdate
FROM WORKER_LICENSES
WHERE wl_expirationdate <= CAST(GETDATE() AS DATE);
