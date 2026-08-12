SELECT TOP 10000 epi.epi_id, epi.epi_firstname, epi.epi_lastname, cevn.cevn_id, cevn.cevn_epiid, cevn.cevn_AgentName, cevn.cevn_Assessment, cevn.cevn_VisitNarrative
FROM CLIENT_EPISODES_ALL epi WITH (NOLOCK)
JOIN CLIENT_EPISODE_VISIT_NOTES cevn ON epi.epi_id = cevn.cevn_epiid 
WHERE epi.epi_SocDate BETWEEN @StartDate AND @EndDate;
