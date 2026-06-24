"use client";

import { TrendingUp, Users, DollarSign, Activity } from "lucide-react";

interface KpiCard {
  label: string;
  value: string;
  delta: string;
  deltaPositive: boolean;
  icon: React.ElementType;
  color: string;
}

const kpis: KpiCard[] = [
  {
    label: "Weekly Admissions",
    value: "247",
    delta: "+12.4% vs last week",
    deltaPositive: true,
    icon: TrendingUp,
    color: "text-primary",
  },
  {
    label: "Active Census",
    value: "1,842",
    delta: "+3.1% vs last week",
    deltaPositive: true,
    icon: Users,
    color: "text-chart-2",
  },
  {
    label: "Billed Revenue (WTD)",
    value: "$1.24M",
    delta: "-2.8% vs last week",
    deltaPositive: false,
    icon: DollarSign,
    color: "text-chart-5",
  },
  {
    label: "Discharges",
    value: "89",
    delta: "+5.6% vs last week",
    deltaPositive: true,
    icon: Activity,
    color: "text-chart-3",
  },
];

export function KpiCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
            <div className="p-1.5 rounded-md bg-muted">
              <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
            </div>
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">{kpi.value}</p>
            <p
              className={`text-xs mt-1 ${
                kpi.deltaPositive ? "text-chart-3" : "text-destructive"
              }`}
            >
              {kpi.delta}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
