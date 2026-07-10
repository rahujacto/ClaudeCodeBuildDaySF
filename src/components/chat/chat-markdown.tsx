"use client";

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Minimal hast shape we read to turn a table into a chart ──────────────────
interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Pull header + body cell text out of a GFM table's hast node. */
function tableData(node: HastNode): { headers: string[]; body: string[][] } {
  const rows: HastNode[] = [];
  const walk = (n: HastNode) => {
    for (const c of n.children ?? []) {
      if (c.tagName === "tr") rows.push(c);
      else walk(c);
    }
  };
  walk(node);
  const cells = (tr: HastNode) =>
    (tr.children ?? [])
      .filter((c) => c.tagName === "th" || c.tagName === "td")
      .map((c) => textOf(c).trim());
  if (!rows.length) return { headers: [], body: [] };
  return { headers: cells(rows[0]), body: rows.slice(1).map(cells) };
}

/** Parse "$50,914", "8.94×", "11%" → a number; null if not numeric. */
function toNum(s: string): number | null {
  const cleaned = s.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the best column to chart: the last column (after the label column) where
 * most cells are numeric. Returns null when nothing chartable is present.
 */
function chartColumn(
  headers: string[],
  body: string[][],
): { index: number; header: string } | null {
  if (body.length < 2 || headers.length < 2) return null;
  for (let col = headers.length - 1; col >= 1; col--) {
    const numeric = body.filter((r) => toNum(r[col] ?? "") !== null).length;
    if (numeric >= Math.ceil(body.length * 0.6)) {
      return { index: col, header: headers[col] };
    }
  }
  return null;
}

function TableBars({
  labels,
  raw,
}: {
  labels: string[];
  raw: string[];
}) {
  const values = raw.map((s) => Math.abs(toNum(s) ?? 0));
  const max = Math.max(...values, 0) || 1;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-zinc-600 dark:text-zinc-400">
            {label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-2 rounded-full bg-emerald-500"
              style={{ width: `${Math.round((values[i] / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
            {raw[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function MarkdownTable({ node }: { node?: unknown }) {
  const { headers, body } = tableData((node as HastNode) ?? {});
  const chart = chartColumn(headers, body);
  return (
    <div className="my-2">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-zinc-600 dark:text-zinc-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-t border-zinc-100 dark:border-zinc-800/70">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`whitespace-nowrap px-2.5 py-1.5 ${
                      ci === 0
                        ? "font-medium text-zinc-700 dark:text-zinc-300"
                        : "tabular-nums text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            {chart.header}
          </div>
          <TableBars
            labels={body.map((r) => r[0])}
            raw={body.map((r) => r[chart.index])}
          />
        </div>
      )}
    </div>
  );
}

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-3 text-sm font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 text-sm font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className="leading-6">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="flex flex-col gap-1 pl-1">{children}</ul>,
  ol: ({ children }) => (
    <ol className="ml-4 flex list-decimal flex-col gap-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="relative pl-4 leading-6 marker:text-zinc-400 before:absolute before:left-0 before:text-zinc-400 before:content-['•'] [ol_&]:pl-0 [ol_&]:before:content-none">
      {children}
    </li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-800" />,
  table: MarkdownTable as Components["table"],
};

function ChatMarkdownImpl({ content }: { content: string }): ReactNode {
  return (
    <div className="flex flex-col gap-2 text-sm text-zinc-800 dark:text-zinc-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownImpl);
