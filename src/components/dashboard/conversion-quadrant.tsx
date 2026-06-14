"use client";

import {
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { SchoolRow } from "@/lib/schools";

const SCALE = "#10b981"; // high value / low traffic → spend more
const FIX = "#f59e0b"; // high traffic / low value → fix the page
const NEUTRAL = "#a1a1aa";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Point = { x: number; y: number; z: number; school: string };

function quadrant(p: Point, xMid: number, yMid: number) {
  if (p.y >= yMid && p.x < xMid) return "scale";
  if (p.y < yMid && p.x >= xMid) return "fix";
  return "neutral";
}
const colorFor = (q: string) => (q === "scale" ? SCALE : q === "fix" ? FIX : NEUTRAL);

export function ConversionQuadrant({ data }: { data: SchoolRow[] }) {
  const points: Point[] = data
    .filter((r) => r.sessions > 0 && r.revenue > 0 && r.revenuePerSession != null)
    .slice(0, 20)
    .map((r) => ({ x: r.sessions, y: r.revenuePerSession as number, z: r.revenue, school: r.school }));

  if (points.length < 3) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
        Not enough school traffic to chart yet.
      </div>
    );
  }

  const xMid = median(points.map((p) => p.x));
  const yMid = median(points.map((p) => p.y));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: SCALE }} />
          Scale with ads — converts well, low traffic
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: FIX }} />
          Fix the page — lots of traffic, weak revenue
        </span>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 20, bottom: 24, left: 8 }}>
            <XAxis
              type="number"
              dataKey="x"
              name="Sessions"
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              className="text-zinc-400"
              tickLine={false}
              axisLine={false}
              tickFormatter={(n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`)}
              label={{ value: "Product-page sessions →", position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Rev/session"
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              className="text-zinc-400"
              tickLine={false}
              axisLine={false}
              tickFormatter={(n: number) => `$${n}`}
              label={{ value: "Revenue / session →", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="z" range={[60, 600]} name="Revenue" />
            <ReferenceLine x={xMid} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeDasharray="4 4" />
            <ReferenceLine y={yMid} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Point;
                const q = quadrant(p, xMid, yMid);
                const action = q === "scale" ? "→ Spend more here" : q === "fix" ? "→ Fix the page / price" : "";
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="font-medium">{p.school}</div>
                    <div className="mt-1 text-zinc-600 dark:text-zinc-400">
                      ${p.z.toLocaleString()} revenue · {p.x.toLocaleString()} sessions
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-400">${p.y.toFixed(2)} / session</div>
                    {action && (
                      <div className="mt-1 font-medium" style={{ color: colorFor(q) }}>
                        {action}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Scatter data={points} fillOpacity={0.8}>
              {points.map((p) => (
                <Cell key={p.school} fill={colorFor(quadrant(p, xMid, yMid))} />
              ))}
              <LabelList
                dataKey="school"
                position="top"
                style={{ fontSize: 9, fill: "currentColor" }}
                className="text-zinc-500"
                formatter={(v) => {
                  const s = String(v ?? "");
                  return s.length > 14 ? s.slice(0, 13) + "…" : s;
                }}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
