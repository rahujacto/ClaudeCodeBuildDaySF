"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AGENT_LAYERS, type AgentLayers, type AgentProfile } from "@/lib/agent";
import posthog from "posthog-js";

export function AgentEditor({
  initialProfile,
  isAdmin,
  shopifyConnected,
}: {
  initialProfile: AgentProfile | null;
  isAdmin: boolean;
  shopifyConnected: boolean;
}) {
  const [layers, setLayers] = useState<AgentLayers>(initialProfile?.layers ?? {});
  const [meta, setMeta] = useState({
    generatedAt: initialProfile?.generatedAt ?? null,
    updatedAt: initialProfile?.updatedAt ?? null,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  const isEmpty = !AGENT_LAYERS.some((l) => layers[l.key]?.trim());
  const canGenerate = isAdmin && shopifyConnected;

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch("/api/agent/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generation failed.");
      setLayers(json.profile?.layers ?? {});
      setMeta({
        generatedAt: json.profile?.generatedAt ?? null,
        updatedAt: json.profile?.updatedAt ?? null,
      });
      setDirty(false);
      posthog.capture("agent_profile_generated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed.");
      setMeta({
        generatedAt: json.profile?.generatedAt ?? null,
        updatedAt: json.profile?.updatedAt ?? null,
      });
      setDirty(false);
      posthog.capture("agent_profile_saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  // First login: no profile yet → generate one automatically.
  useEffect(() => {
    if (autoRan.current || !isEmpty || !canGenerate) return;
    autoRan.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (s: string | null) =>
    s
      ? new Date(s).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">
          {busy === "generate" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Reading your website, store data, and ad performance…
            </span>
          ) : meta.generatedAt ? (
            <>
              Generated {fmt(meta.generatedAt)}
              {meta.updatedAt && meta.updatedAt !== meta.generatedAt
                ? ` · edited ${fmt(meta.updatedAt)}`
                : ""}
            </>
          ) : (
            "Not generated yet."
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canGenerate || busy !== null}
              onClick={() => {
                if (
                  isEmpty ||
                  confirm("Regenerate the system prompt? This replaces all layers, including your edits.")
                )
                  void generate();
              }}
            >
              {isEmpty ? (
                <Sparkles className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {isEmpty ? "Generate" : "Regenerate"}
            </Button>
            <Button size="sm" disabled={!dirty || busy !== null} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}
      {!shopifyConnected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Connect Shopify to generate the system prompt from your store.
        </div>
      )}

      {AGENT_LAYERS.map(({ key, title, description }) => (
        <section
          key={key}
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
          <textarea
            value={layers[key] ?? ""}
            readOnly={!isAdmin}
            placeholder={busy === "generate" ? "Generating…" : "Empty — generate or write this layer."}
            onChange={(e) => {
              setLayers((prev) => ({ ...prev, [key]: e.target.value }));
              setDirty(true);
            }}
            rows={Math.max(4, Math.min(16, (layers[key]?.split("\n").length ?? 0) + 1))}
            className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-transparent p-3 font-mono text-xs leading-5 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
          />
        </section>
      ))}
    </div>
  );
}
