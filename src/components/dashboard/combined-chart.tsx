"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ComboPoint = {
  date: string;
  revenue: number;
  sessions: number | null;
};

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

function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export function CombinedChart({
  data,
  hasGa4,
}: {
  data: ComboPoint[];
  hasGa4: boolean;
}) {
  const interval = data.length > 14 ? Math.ceil(data.length / 8) : 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" />
          Revenue
        </span>
        {hasGa4 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-sm bg-blue-500" />
            GA4 sessions
          </span>
        )}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-zinc-200 dark:text-zinc-800"
              vertical={false}
            />
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
              yAxisId="rev"
              tickFormatter={fmtMoney}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              className="text-zinc-400"
              tickLine={false}
              axisLine={false}
              width={44}
            />
            {hasGa4 && (
              <YAxis
                yAxisId="sessions"
                orientation="right"
                tickFormatter={fmtNum}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-zinc-400"
                tickLine={false}
                axisLine={false}
                width={40}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ComboPoint;
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="font-medium">{fmtDate(p.date)}</div>
                    <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                      ${p.revenue.toLocaleString()} revenue
                    </div>
                    {hasGa4 && p.sessions !== null && (
                      <div className="text-blue-600 dark:text-blue-400">
                        {p.sessions.toLocaleString()} sessions
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Area
              yAxisId="rev"
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#rev)"
            />
            {hasGa4 && (
              <Line
                yAxisId="sessions"
                type="monotone"
                dataKey="sessions"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
