"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

export type SparklinePoint = { date: string; value: number };

/**
 * Minimal trend line for a KPI card — no axes, no grid, no tooltip, just
 * direction. Zero new data cost: every call site already has the daily
 * series loaded for its totals, this just renders it.
 */
export function Sparkline({ data, className = "h-6" }: { data: SparklinePoint[]; className?: string }) {
  if (data.length < 2) return null;
  return (
    <div className={`w-full ${className}`} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-brand)"
            strokeWidth={1.5}
            fill="var(--color-brand)"
            fillOpacity={0.15}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
