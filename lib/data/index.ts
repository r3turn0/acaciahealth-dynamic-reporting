/**
 * /lib/data/index.ts
 *
 * Single entry point for the data access layer.
 * API routes and server components import from here — never directly
 * from /lib/services/db — to keep query logic in one place and enforce
 * the architecture boundary.
 *
 * Architecture:
 *   Frontend (React)
 *     → API Routes (nodejs runtime)
 *       → /lib/data/*          ← HERE
 *         → /lib/services/db   (pool + executeQuery)
 *           → Azure VM SQL Server
 */

export {
  getAdmissionsByBranch,
  getDischargesByBranch,
  getCensusByBranch,
  getAdmissionsByCareType,
  getEpisodeById,
} from "./episodes";

export {
  getRevenueByBranch,
  getRevenueByServiceLine,
  getRevenueTrend,
} from "./billing";

export type { EpisodeMetrics, EpisodeFilters } from "./episodes";
export type { RevenueRow, BillingFilters } from "./billing";
