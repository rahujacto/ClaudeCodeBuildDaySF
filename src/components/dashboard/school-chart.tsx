"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SchoolRow } from "@/lib/schools";

function fmtMoney(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
}

export function SchoolChart({ data }: { data: SchoolRow[] }) {
  const rows = data.slice(0, 8);
  const height = Math.max(180, rows.length * 40);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke="currentColor"
            strokeDasharray="3 3"
            className="text-zinc-200 dark:text-zinc-800"
          />
          <XAxis
            type="number"
            tickFormatter={fmtMoney}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-zinc-400"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="school"
            width={150}
            tick={{ fontSize: 12 }}
            stroke="currentColor"
            className="text-zinc-600 dark:text-zinc-300"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "currentColor", className: "text-zinc-100 dark:text-zinc-800" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as SchoolRow;
              return (
                <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="font-medium">{r.school}</div>
                  <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                    ${r.revenue.toLocaleString()} · {r.units} units
                  </div>
                  <div className="text-blue-600 dark:text-blue-400">
                    {r.pageviews.toLocaleString()} product-page views
                  </div>
                  {r.revenuePerView !== null && (
                    <div className="text-zinc-500">
                      ${r.revenuePerView.toFixed(2)} revenue / view
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={20}>
            {rows.map((r) => (
              <Cell key={r.key} fill="#10b981" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
