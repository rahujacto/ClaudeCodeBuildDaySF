"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = { date: string; revenue: number; orders: number };

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtMoney(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${n}`;
}

export function SalesChart({ data }: { data: ChartPoint[] }) {
  const interval = data.length > 14 ? Math.ceil(data.length / 8) : 0;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            interval={interval}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-zinc-400"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={fmtMoney}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-zinc-400"
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ChartPoint;
              return (
                <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="font-medium">{fmtDate(p.date)}</div>
                  <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                    ${p.revenue.toLocaleString()} revenue
                  </div>
                  <div className="text-zinc-500">{p.orders} orders</div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#rev)"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
