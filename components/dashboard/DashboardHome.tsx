"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Pin,
  X,
  Play,
  BarChart3,
  Clock,
  Loader2,
  LayoutGrid,
  ArrowRight,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip as RechartsTooltip,
} from "recharts";
import { KpiCards } from "./KpiCards";
import { HealthStatus } from "./HealthStatus";
import {
  useDashboardPins,
  refreshPins,
  unpinItem,
  type DashboardPin,
} from "@/lib/hooks/useDashboardPins";
import { downloadDataset } from "@/lib/utils/download";

export interface OpenReportPayload {
  sql: string;
  prompt: string;
  kpi: string;
  name: string;
}

interface DashboardHomeProps {
  onNavigate: (id: string) => void;
  onOpenReport: (report: OpenReportPayload) => void;
}

interface RecentReport {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sql: string;
  kpi: string;
  created_date: string;
  last_run_date: string | null;
  run_count: number;
  last_row_count: number | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never run";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1 hour ago";
  if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? "s" : ""} ago`;
}

export function DashboardHome({ onNavigate, onOpenReport }: DashboardHomeProps) {
  const pins = useDashboardPins();
  const [recent, setRecent] = useState<RecentReport[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      const json = await res.json();
      setRecent(Array.isArray(json.reports) ? json.reports.slice(0, 5) : []);
    } catch {
      // Silent — dashboard still renders without recent list.
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  // On first mount: seed default reports + pins for all KPIs, then refresh.
  // The seed endpoint is idempotent — subsequent mounts are no-ops.
  useEffect(() => {
    async function seedAndRefresh() {
      try {
        await fetch("/api/kpi/seed-reports", { method: "POST" });
      } catch {
        // Non-critical — dashboard renders fine without seeded pins.
      }
      void refreshPins();
      void loadRecent();
    }
    void seedAndRefresh();
  }, [loadRecent]);

  function openPin(pin: DashboardPin) {
    if (pin.type === "report") {
      onOpenReport({
        sql: String(pin.meta.sql ?? ""),
        prompt: String(pin.meta.prompt ?? ""),
        kpi: pin.kpi,
        name: pin.title,
      });
    } else {
      onNavigate("kpi");
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full">
      <KpiCards />

      {/* Pinned to dashboard */}
      <PinnedBoard pins={pins} onOpen={openPin} onUnpin={(id) => unpinItem(id)} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentReportsList
            reports={recent}
            loading={loadingRecent}
            onOpen={onOpenReport}
            onViewAll={() => onNavigate("saved")}
          />
        </div>
        <div>
          <HealthStatus />
        </div>
      </div>

      <QuickStart onNavigate={onNavigate} />
    </div>
  );
}

// ── Sparkline preview ────────────────────────────────────────────────────────

function MiniSparkline({ kpi }: { kpi: string }) {
  const data = useMemo(() => {
    const base =
      kpi === "revenue" ? 65000 :
      kpi === "census"  ? 80 :
      kpi === "admissions" ? 22 : 40;
    return Array.from({ length: 7 }, (_, i) => ({
      i,
      v: Math.max(0, Math.round(base + (Math.random() - 0.45) * base * 0.3)),
    }));
  }, [kpi]);

  const last = data[data.length - 1].v;
  const prev = data[data.length - 2].v;
  const trend = last > prev ? "up" : last < prev ? "down" : "flat";

  const color =
    kpi === "revenue" ? "var(--color-chart-2)" :
    kpi === "census"  ? "var(--color-chart-3)" :
    kpi === "admissions" ? "var(--color-chart-1)" : "var(--color-primary)";

  return (
    <div className="flex items-end gap-2">
      <div className="h-10 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`sg-${kpi}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#sg-${kpi})`}
              dot={false}
              isAnimationActive={false}
            />
            <RechartsTooltip
              content={() => null}
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className={`text-[10px] font-medium flex items-center gap-0.5 shrink-0 ${
        trend === "up" ? "text-chart-2" : trend === "down" ? "text-destructive" : "text-muted-foreground"
      }`}>
        {trend === "up" ? <TrendingUp className="w-2.5 h-2.5" /> : trend === "down" ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
        {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
      </span>
    </div>
  );
}

// ── Pinned board ────────────────────────────────────────────────────────────

function PinnedBoard({
  pins,
  onOpen,
  onUnpin,
  onNavigate,
}: {
  pins: DashboardPin[];
  onOpen: (pin: DashboardPin) => void;
  onUnpin: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  function handleDownload(pin: DashboardPin) {
    const stub: Record<string, unknown>[] = [{
      title: pin.title,
      type: pin.type,
      kpi: pin.kpi,
      pinned_date: pin.pinned_date,
      sql: pin.meta.sql ?? "",
    }];
    downloadDataset(stub, pin.title + "_definition", "csv");
  }

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Pin className="w-4 h-4 text-chart-3" />
          <h2 className="text-sm font-semibold text-foreground">Pinned to Dashboard</h2>
          <span className="text-[11px] text-muted-foreground">({pins.length})</span>
        </div>
        {pins.length > 0 && (
          <button
            onClick={() => onNavigate("saved")}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            View all reports <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {pins.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground">Nothing pinned yet</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Pin a saved report or a KPI to keep it one click away. Look for the pin icon in
            Saved Reports and KPI Explorer.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => onNavigate("saved")}
              className="text-xs text-primary hover:text-primary/80 underline underline-offset-2"
            >
              Go to Saved Reports
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              onClick={() => onNavigate("kpi")}
              className="text-xs text-primary hover:text-primary/80 underline underline-offset-2"
            >
              Go to KPI Explorer
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pins.map((pin) => (
            <div
              key={pin.id}
              className="relative border border-border rounded-xl p-4 hover:border-primary/40 transition-colors flex flex-col gap-3 bg-background"
            >
              {/* Unpin */}
              <button
                onClick={() => onUnpin(pin.id)}
                className="absolute top-2.5 right-2.5 p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                title="Unpin"
                aria-label="Unpin from dashboard"
              >
                <X className="w-3 h-3" />
              </button>

              {/* Type + KPI badges */}
              <div className="flex items-center gap-1.5 flex-wrap pr-6">
                <span
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${
                    pin.type === "kpi"
                      ? "bg-chart-2/10 text-chart-2 border-chart-2/20"
                      : "bg-primary/10 text-primary border-primary/20"
                  }`}
                >
                  {pin.type === "kpi" ? <BarChart3 className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  {pin.type}
                </span>
                {pin.kpi && pin.kpi !== "custom" && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${
                    pin.kpi === "admissions" ? "bg-chart-1/10 text-chart-1 border-chart-1/20" :
                    pin.kpi === "revenue"    ? "bg-chart-2/10 text-chart-2 border-chart-2/20" :
                    pin.kpi === "census"     ? "bg-chart-3/10 text-chart-3 border-chart-3/20" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>
                    {pin.kpi}
                  </span>
                )}
              </div>

              {/* Title + subtitle */}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate leading-tight">{pin.title}</p>
                {pin.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 leading-relaxed">
                    {pin.subtitle}
                  </p>
                )}
              </div>

              {/* Sparkline preview for report pins */}
              {pin.type === "report" && pin.kpi && (
                <MiniSparkline kpi={pin.kpi} />
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-1 border-t border-border/50 mt-auto">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="w-2.5 h-2.5" />
                  {formatRelative(pin.pinned_date)}
                </span>
                <div className="flex items-center gap-1">
                  {pin.type === "report" && (
                    <button
                      onClick={() => handleDownload(pin)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Download definition"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => onOpen(pin)}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                  >
                    {pin.type === "report" ? "Open" : "View"}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recent reports ───────────────────────────────────��──────────────────────

function RecentReportsList({
  reports,
  loading,
  onOpen,
  onViewAll,
}: {
  reports: RecentReport[];
  loading: boolean;
  onOpen: (r: OpenReportPayload) => void;
  onViewAll: () => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Recent Reports</h2>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          View all
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No reports yet. Create one in Saved Reports or Report Studio.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen({ sql: r.sql, prompt: r.prompt, kpi: r.kpi, name: r.name })}
              className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 text-left hover:bg-accent/30 rounded px-1.5 -mx-1.5 transition-colors group"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
                  {r.name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {r.last_run_date ? `Ran ${formatRelative(r.last_run_date)}` : `Created ${formatRelative(r.created_date)}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {r.kpi && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize">
                    {r.kpi}
                  </span>
                )}
                {r.last_row_count !== null && (
                  <span className="text-xs text-muted-foreground">{r.last_row_count.toLocaleString()} rows</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

function QuickStart({ onNavigate }: { onNavigate: (id: string) => void }) {
  const actions = [
    { id: "data",      label: "1 · Discover Data",     desc: "Search, preview, and sample tables from the warehouse" },
    { id: "designer",  label: "2 · Dataset Designer",  desc: "Drag-and-drop PK/FK relationships, build semantic datasets" },
    { id: "kpi",       label: "3 · KPI Explorer",      desc: "Browse KPI definitions, metrics, and interpreter" },
    { id: "studio",    label: "4 · Report Studio",     desc: "Ask AI, write SQL, run queries, save and share reports" },
    { id: "schema",    label: "Schema Hub",             desc: "Schema Explorer · Metadata Engine · Schema Registry" },
    { id: "kpiadmin",  label: "KPI Schema Admin",       desc: "Author, version, validate, and deploy KPI definitions" },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {actions.map((a) => (
          <button
            key={a.id}
            onClick={() => onNavigate(a.id)}
            className="text-left border border-border rounded-lg p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <p className="text-sm font-medium text-foreground">{a.label}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
