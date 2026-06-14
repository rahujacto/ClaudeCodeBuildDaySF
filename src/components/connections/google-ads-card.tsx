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
import { BrandIcon } from "@/components/brand-icon";

export function GoogleAdsCard({
  initialSeeded,
  initialCustomerId,
}: {
  initialSeeded: boolean;
  initialCustomerId: string;
}) {
  const router = useRouter();
  const [seeded, setSeeded] = useState(initialSeeded);
  const [editing, setEditing] = useState(!initialSeeded);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [developerToken, setDeveloperToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connections/google-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, developerToken, clientId, clientSecret }),
      });
      const data = await res.json();
      setMessage(data.message);
      if (data.ok) {
        setSeeded(true);
        setEditing(false);
        setDeveloperToken("");
        setClientSecret("");
        router.refresh();
      }
    } catch {
      setMessage("Network error — please retry.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    await fetch("/api/connections/google-ads", { method: "DELETE" });
    setSeeded(false);
    setEditing(true);
    setMessage(null);
    setLoading(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BrandIcon slug="googleads" label="Google Ads" />
            Google Ads
          </CardTitle>
          {seeded ? (
            <Badge variant="secondary">Seeded</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Enter your API credentials. Live pulls need Google Ads API{" "}
          <span className="font-medium">Basic Access</span> (separate approval),
          so today this runs on realistic seeded campaign data + CSV.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {seeded && !editing ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-zinc-500">Customer ID</div>
              <div className="font-medium">{customerId}</div>
              <div className="mt-2 text-zinc-500">Mode</div>
              <div className="font-mono">seeded data · live deferred</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit credentials
              </Button>
              <Button variant="destructive" size="sm" onClick={disconnect} disabled={loading}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ads-customer">Customer ID</Label>
              <Input
                id="ads-customer"
                placeholder="123-456-7890"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ads-devtoken">Developer token</Label>
                <Input
                  id="ads-devtoken"
                  type="password"
                  placeholder="••••••"
                  value={developerToken}
                  onChange={(e) => setDeveloperToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ads-clientid">Client ID</Label>
                <Input
                  id="ads-clientid"
                  placeholder="…apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ads-secret">Client secret</Label>
              <Input
                id="ads-secret"
                type="password"
                placeholder="••••••"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={loading || !customerId}>
                {loading ? "Saving…" : "Save & use seeded data"}
              </Button>
              {seeded && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={loading}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        {message && (
          <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
