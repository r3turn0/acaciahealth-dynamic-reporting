"use client";

/**
 * app/dashboard/page.tsx
 * Protected dashboard — requires Azure AD session (enforced by middleware).
 * Shows the authenticated user's email and fetches live data from the
 * protected API route, which validates the JWT before hitting SQL Server.
 */

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { AuthButtons } from "@/components/AuthButtons";
import { Loader2, RefreshCw, AlertCircle, Table2, ShieldCheck } from "lucide-react";

interface ReportRow {
  ReportId: number;
  ReportName: string;
  Branch: string;
  CreatedBy: string;
  CreatedAt: string;
  RowCount: number;
  Status: string;
}

interface ApiResponse {
  data: ReportRow[];
  cache_hit: boolean;
  demo_mode?: boolean;
  user?: string;
  error?: string;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchReports() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/protected/reports");
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json: ApiResponse = await res.json();
      setResponse(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchReports(); }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">AcaciaHealth</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">/ Dashboard</span>
          </div>
          <AuthButtons />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
        {/* Welcome */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Signed in as{" "}
              <span className="text-foreground font-medium">{session?.user?.email}</span>
            </p>
          </div>
          <button
            onClick={fetchReports}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Status badges */}
        {response?.demo_mode && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Demo mode — no database connected. Configure DB_HOST, DB_NAME, DB_USER, DB_PASS to show live data.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !response && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {/* Table */}
        {response?.data && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Table2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {response.data.length} reports
              </span>
              {response.cache_hit && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
                  cached
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    {["ID", "Report Name", "Branch", "Created By", "Created At", "Rows", "Status"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {response.data.map((row, i) => (
                    <tr
                      key={row.ReportId ?? i}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">{row.ReportId}</td>
                      <td className="px-4 py-2.5 text-foreground font-medium">{row.ReportName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.Branch}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.CreatedBy}</td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {new Date(row.CreatedAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">{row.RowCount?.toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium
                          ${row.Status === "Success"
                            ? "bg-chart-1/15 text-chart-1"
                            : "bg-destructive/15 text-destructive"
                          }`}>
                          {row.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
