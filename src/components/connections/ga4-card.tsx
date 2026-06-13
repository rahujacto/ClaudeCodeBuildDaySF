"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Candidate = { propertyId: string; displayName: string; url: string | null };

export function Ga4Card({
  connected,
  propertyId,
  displayName,
  autoMatched,
  oauthError,
}: {
  connected: boolean;
  propertyId?: string;
  displayName?: string;
  autoMatched?: boolean;
  oauthError?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "disconnected" | "detecting" | "pick" | "connected" | "error"
  >(connected ? (propertyId ? "connected" : "detecting") : "disconnected");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [message, setMessage] = useState<string | null>(
    oauthError ? "Google sign-in didn't complete. Please try again." : null,
  );
  const [prop, setProp] = useState<{
    propertyId?: string;
    displayName?: string;
    autoMatched?: boolean;
  }>({ propertyId, displayName, autoMatched });
  const [loading, setLoading] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (phase === "detecting" && !ran.current) {
      ran.current = true;
      autodetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function autodetect() {
    setMessage(null);
    try {
      const res = await fetch("/api/connections/ga4/autodetect");
      const data = await res.json();
      if (data.error) {
        setPhase("error");
        setMessage(data.error);
        return;
      }
      if (data.matched) {
        setProp({ ...data.matched, autoMatched: true });
        setPhase("connected");
        setMessage(
          `Auto-matched to your store · ${Number(data.sessions).toLocaleString()} sessions (last 7d).`,
        );
        router.refresh();
      } else {
        setCandidates(data.candidates ?? []);
        setPhase("pick");
      }
    } catch {
      setPhase("error");
      setMessage("Couldn't reach Google Analytics.");
    }
  }

  async function pick(c: Candidate) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connections/ga4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: c.propertyId, displayName: c.displayName }),
      });
      const data = await res.json();
      if (data.ok) {
        setProp({ propertyId: c.propertyId, displayName: c.displayName, autoMatched: false });
        setPhase("connected");
        setMessage(data.message);
        router.refresh();
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Network error — please retry.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    await fetch("/api/connections/ga4", { method: "DELETE" });
    setPhase("disconnected");
    setProp({});
    setMessage(null);
    setLoading(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">Google Analytics</CardTitle>
          {phase === "connected" ? (
            <Badge>Connected</Badge>
          ) : phase === "detecting" ? (
            <Badge variant="secondary">Detecting…</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Connect with Google (read-only). We auto-detect the GA4 property that
          matches your store&apos;s domain — no Property ID hunting.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {phase === "disconnected" && (
          <Button
            size="sm"
            className="w-fit"
            onClick={() => {
              window.location.href = "/api/oauth/ga4/start";
            }}
          >
            Connect Google Analytics
          </Button>
        )}

        {phase === "detecting" && (
          <div className="text-sm text-zinc-500">
            Finding the GA4 property that matches your store…
          </div>
        )}

        {phase === "pick" && (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No exact domain match — pick your property:
            </div>
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {candidates.map((c) => (
                <button
                  key={c.propertyId}
                  onClick={() => pick(c)}
                  disabled={loading}
                  className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{c.displayName}</span>
                    <span className="text-xs text-zinc-500">
                      {c.url ?? `property ${c.propertyId}`}
                    </span>
                  </span>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    Use →
                  </span>
                </button>
              ))}
              {!candidates.length && (
                <span className="text-sm text-zinc-500">
                  No GA4 properties found for this account.
                </span>
              )}
            </div>
            <button
              onClick={() => {
                window.location.href = "/api/oauth/ga4/start";
              }}
              className="w-fit text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Not seeing your store? Connect a different Google account →
            </button>
          </div>
        )}

        {phase === "connected" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 text-zinc-500">
                Property
                {prop.autoMatched && (
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    auto-matched
                  </span>
                )}
              </div>
              <div className="font-medium">
                {prop.displayName ?? `Property ${prop.propertyId}`}
              </div>
              <div className="font-mono text-xs text-zinc-500">
                 id: {prop.propertyId}
              </div>
            </div>
            <Button variant="destructive" size="sm" className="w-fit" onClick={disconnect} disabled={loading}>
              Disconnect
            </Button>
          </div>
        )}

        {phase === "error" && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => {
              window.location.href = "/api/oauth/ga4/start";
            }}
          >
            Reconnect Google Analytics
          </Button>
        )}

        {message && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              phase === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
