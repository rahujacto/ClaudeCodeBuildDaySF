"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { BrandIcon } from "@/components/brand-icon";

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
  initialClientId,
}: {
  initialStatus: "connected" | "disconnected";
  initialDomain: string;
  initialClientId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [domain, setDomain] = useState(initialDomain);
  const [clientId, setClientId] = useState(initialClientId);
  const [clientSecret, setClientSecret] = useState("");
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
        body: JSON.stringify({ domain, clientId, clientSecret }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        setStatus("connected");
        setEditing(false);
        setClientSecret(""); // never keep the raw secret in component state
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
          <CardTitle className="flex items-center gap-2">
            <BrandIcon slug="shopify" label="Shopify" />
            Shopify
          </CardTitle>
          {status === "connected" ? (
            <Badge>Connected</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Enter your store domain + custom-app Client ID &amp; secret. We mint a
          token and run a live one-order test before saving — then encrypt the
          secret. Tokens are minted fresh on the server, never stored raw.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {status === "connected" && !editing ? (
          <div className="flex items-center justify-between">
            <span className="truncate text-sm text-zinc-500">{domain}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true);
                setResult(null);
              }}
            >
              <Pencil className="size-3.5" /> Edit
            </Button>
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
              <Label htmlFor="shop-client-id">Client ID (API key)</Label>
              <Input
                id="shop-client-id"
                placeholder="e.g. 0ab492…"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shop-secret">Client secret</Label>
              <Input
                id="shop-secret"
                type="password"
                placeholder="shpss_…"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveAndTest}
                disabled={loading || !domain || !clientId || !clientSecret}
              >
                {loading ? "Testing…" : "Save & Test"}
              </Button>
              {status === "connected" && (
                <>
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
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={disconnect}
                    disabled={loading}
                  >
                    Disconnect
                  </Button>
                </>
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
