/**
 * app/dashboard/page.tsx
 *
 * Protected dashboard route — auth enforced by middleware.ts.
 *
 * This is a thin "use client" shell that mounts DashboardHome and provides
 * the required navigation callbacks. The real application flow (Sidebar +
 * all tabs) is orchestrated by WorkspacePage / DashboardHome. When this
 * standalone route is hit directly (e.g. after login redirect), DashboardHome
 * renders the dashboard home view. Tab navigation callbacks are no-ops here
 * because deep-linking to individual tabs is handled by the Sidebar state
 * inside DashboardHome itself.
 *
 * Previous legacy: this file contained a prototype reports table with
 * useEffect + fetch. That code has been removed — use the Reports tab inside
 * DashboardHome, backed by the full QueryGateway pipeline.
 */
"use client";

import { DashboardHome } from "@/components/dashboard/DashboardHome";

// Stable no-op callbacks — satisfy the required prop types without
// triggering re-renders, since this standalone route has no Sidebar context.
function noop() {}

export default function DashboardPage() {
  return <DashboardHome onNavigate={noop} onOpenReport={noop} />;
}
