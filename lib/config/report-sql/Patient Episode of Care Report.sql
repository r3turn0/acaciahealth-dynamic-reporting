SELECT epi.epi_StartOfEpisode, epi.epi_SocDate, epi.epi_DischargeDate, epi.epi_paid, epi.epi_status, epi.epi_AdmitType, b.branch_name, sl.sl_id, sl.sl_desc FROM CLIENT_EPISODE_VISITS cev 
JOIN CLIENT_EPISODES_ALL epi ON cev.CEV_EPIID = epi.epi_id
JOIN BRANCHES b ON epi.epi_branchcode = b.branch_code
JOIN SERVICE_LINES sl ON epi.epi_slid = sl.sl_id;