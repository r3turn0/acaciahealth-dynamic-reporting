let seedRequest: Promise<Response> | null = null;

/**
 * Shares one seed request across React Strict Mode effect replays and across
 * dashboard surfaces mounted during the same browser session.
 */
export function ensureKpiReportsSeeded(): Promise<Response> {
  if (!seedRequest) {
    seedRequest = fetch("/api/kpi/seed-reports", { method: "POST" }).then((response) => {
      if (!response.ok) {
        seedRequest = null;
        throw new Error(`KPI report seeding failed (${response.status})`);
      }
      return response;
    }).catch((error) => {
      seedRequest = null;
      throw error;
    });
  }

  return seedRequest;
}
