"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AggregationResult } from "@/lib/bi/kpiService";
import type { ChartType } from "@/lib/bi/types";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface Props {
  result: AggregationResult;
  chart: ChartType;
  /** metricKey → human label */
  labels: Record<string, string>;
}

export function ChartRenderer({ result, chart, labels }: Props) {
  const { data, metricKeys, dimensionKey } = result;

  if (!data.length || !dimensionKey) {
    return (
      <div className="flex items-center justify-center h-full min-h-48 text-sm text-muted-foreground">
        Add a metric to preview a chart.
      </div>
    );
  }

  const config: ChartConfig = metricKeys.reduce((acc, key, i) => {
    acc[key] = { label: labels[key] ?? key, color: PALETTE[i % PALETTE.length] };
    return acc;
  }, {} as ChartConfig);

  // ── Table ────────────────────────────────────────────────────────────────────
  if (chart === "table") {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="px-3 py-2 font-medium text-muted-foreground">{dimensionKey}</th>
              {metricKeys.map((k) => (
                <th key={k} className="px-3 py-2 font-medium text-muted-foreground text-right">
                  {labels[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 text-foreground">{String(row[dimensionKey])}</td>
                {metricKeys.map((k) => (
                  <td key={k} className="px-3 py-2 text-right font-mono tabular-nums text-foreground">
                    {Number(row[k]).toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Pie (first metric only) ──────────────────────────────────────────────────
  if (chart === "pie") {
    const key = metricKeys[0];
    return (
      <ChartContainer config={config} className="min-h-64 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={dimensionKey} />} />
          <Pie data={data} dataKey={key} nameKey={dimensionKey} innerRadius={50} strokeWidth={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey={dimensionKey} />} />
        </PieChart>
      </ChartContainer>
    );
  }

  // ── Line ───────────────────────────────────────────────────────────────────
  if (chart === "line") {
    return (
      <ChartContainer config={config} className="min-h-64 w-full">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={dimensionKey} tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {metricKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  // ── Bar (default) ─────────────────────────────────────────────────────────────
  return (
    <ChartContainer config={config} className="min-h-64 w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={dimensionKey} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {metricKeys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
