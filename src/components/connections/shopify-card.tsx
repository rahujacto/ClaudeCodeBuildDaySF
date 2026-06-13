"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Sample = {
  shopName: string;
  orderName: string;
  createdAt: string;
  amount: number;
  currency: string;
};

export function ShopifyCard({
  initialStatus,
  initialDomain,
}: {
  initialStatus: "connected" | "disconnected";
  initialDomain: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [domain, setDomain] = useState(initialDomain);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(initialStatus !== "connected");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    { ok: boolean; message: string; sample?: Sample } | null
  >(null);

  async function saveAndTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/connections/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, token }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        setStatus("connected");
        setEditing(false);
        setToken(""); // never keep the raw token in component state
        if (data.domain) setDomain(data.domain);
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "Network error — please retry." });
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    await fetch("/api/connections/shopify", { method: "DELETE" });
    setStatus("disconnected");
    setEditing(true);
    setResult(null);
    setLoading(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">Shopify</CardTitle>
          {status === "connected" ? (
            <Badge>Connected</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Paste your Admin API access token. We run a live one-order test before
          saving — then encrypt the token.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {status === "connected" && !editing ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-zinc-500">Store</div>
              <div className="font-medium">{domain}</div>
              <div className="mt-2 text-zinc-500">Access token</div>
              <div className="font-mono">•••• •••• connected</div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                  setResult(null);
                }}
              >
                Replace token
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={loading}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shop-domain">Store domain</Label>
              <Input
                id="shop-domain"
                placeholder="your-store.myshopify.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shop-token">Admin API access token</Label>
              <Input
                id="shop-token"
                type="password"
                placeholder="shpat_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveAndTest}
                disabled={loading || !domain || !token}
              >
                {loading ? "Testing…" : "Save & Test"}
              </Button>
              {status === "connected" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setResult(null);
                  }}
                  disabled={loading}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        {result && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              result.ok
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            <div>{result.message}</div>
            {result.ok && result.sample && (
              <div className="mt-1 text-emerald-700/80 dark:text-emerald-400/80">
                Latest order {result.sample.orderName} ·{" "}
                {result.sample.currency}{" "}
                {result.sample.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}{" "}
                · {new Date(result.sample.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
