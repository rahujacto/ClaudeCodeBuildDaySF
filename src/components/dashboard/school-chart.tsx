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
            className="text-border"
          />
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
            dataKey="school"
            width={150}
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
              const r = payload[0].payload as SchoolRow;
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
                  <div className="font-medium">{r.school}</div>
                  <div className="mt-1 text-brand">
                    ${r.revenue.toLocaleString()} · {r.units} units
                  </div>
                  <div className="text-chart-2">
                    {r.pageviews.toLocaleString()} product-page views
                  </div>
                  {r.revenuePerView !== null && (
                    <div className="text-muted-foreground">
                      ${r.revenuePerView.toFixed(2)} revenue / view
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={20}>
            {rows.map((r) => (
              <Cell key={r.key} fill="var(--color-chart-1)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
