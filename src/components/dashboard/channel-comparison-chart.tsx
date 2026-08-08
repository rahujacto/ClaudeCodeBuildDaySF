"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChannelComparisonPoint = {
  channel: string;
  /** null when this channel has no ad spend (e.g. Email, Social — organic). */
  spend: number | null;
  /** Revenue for Shopify/ads; null when the source reports no revenue figure. */
  value: number | null;
};

function fmtMoney(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${n}`;
}

/**
 * "Where is money going in vs. coming out" across every connected channel at
 * once — a grouped (not stacked) horizontal bar chart, since Email/Social
 * have no spend figure to plot at all and a scatter would leave them
 * un-plottable. Bars for a null series simply don't render for that channel.
 */
export function ChannelComparisonChart({ data }: { data: ChannelComparisonPoint[] }) {
  const height = Math.max(160, data.length * 48);

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-chart-3" />
          Spend
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-chart-1" />
          Revenue / value
        </span>
      </div>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="currentColor" strokeDasharray="3 3" className="text-border" />
            <XAxis
              type="number"
              tickFormatter={fmtMoney}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="channel"
              width={100}
              tick={{ fontSize: 12 }}
              stroke="currentColor"
              className="text-foreground"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "currentColor", className: "text-muted" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ChannelComparisonPoint;
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
                    <div className="font-medium">{p.channel}</div>
                    {p.spend !== null && (
                      <div className="mt-1 text-chart-3">${Math.round(p.spend).toLocaleString()} spend</div>
                    )}
                    {p.value !== null && (
                      <div className="text-brand">${Math.round(p.value).toLocaleString()} revenue / value</div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="spend" fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} barSize={10} />
            <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
