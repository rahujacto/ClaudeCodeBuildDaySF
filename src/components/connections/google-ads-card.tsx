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

export function GoogleAdsCard({
  initialSeeded,
  initialConnected,
  initialCustomerId,
  initialLoginCustomerId,
}: {
  initialSeeded: boolean;
  initialConnected: boolean;
  initialCustomerId: string;
  initialLoginCustomerId: string;
}) {
  const router = useRouter();
  const [seeded, setSeeded] = useState(initialSeeded);
  const [live, setLive] = useState(initialConnected);
  const [editing, setEditing] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [loginCustomerId, setLoginCustomerId] = useState(initialLoginCustomerId);
  const [developerToken, setDeveloperToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connections/google-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          loginCustomerId,
          developerToken,
          clientId,
          clientSecret,
          refreshToken,
        }),
      });
      const data = await res.json();
      setMessage(data.message);
      if (data.ok) {
        setSeeded(true);
        setLive(Boolean(data.live));
        setEditing(false);
        setDeveloperToken("");
        setClientSecret("");
        setRefreshToken("");
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
    setLive(false);
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
          {live ? (
            <Badge variant="default">Live</Badge>
          ) : seeded ? (
            <Badge variant="secondary">Seeded</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Enter your API credentials. With a refresh token + a developer token
          that has Google Ads API <span className="font-medium">Basic Access</span>,
          this pulls live campaign data. Otherwise it runs on realistic seeded data.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!editing ? (
          seeded ? (
            <div className="flex items-center justify-between">
              <span className="truncate text-sm text-zinc-500">
                {customerId
                  ? `Customer ${customerId} · ${live ? "live" : "seeded"}`
                  : live
                    ? "Live"
                    : "Seeded data"}
              </span>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            </div>
          ) : (
            <Button size="sm" className="w-fit" onClick={() => setEditing(true)}>
              Connect Google Ads
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ads-login">Login customer ID (MCC)</Label>
                <Input
                  id="ads-login"
                  placeholder="manager acct — optional"
                  value={loginCustomerId}
                  onChange={(e) => setLoginCustomerId(e.target.value)}
                  autoComplete="off"
                />
              </div>
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
                <Label htmlFor="ads-clientid">Client ID (optional)</Label>
                <Input
                  id="ads-clientid"
                  placeholder="defaults to app's GA4 client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ads-secret">Client secret (optional)</Label>
                <Input
                  id="ads-secret"
                  type="password"
                  placeholder="defaults to app's GA4 secret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ads-refresh">Refresh token</Label>
                <Input
                  id="ads-refresh"
                  type="password"
                  placeholder="1//0… (enables live)"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={loading || !customerId}>
                {loading ? "Saving…" : refreshToken ? "Save & connect live" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={loading}>
                Cancel
              </Button>
              {seeded && (
                <Button variant="destructive" size="sm" onClick={disconnect} disabled={loading}>
                  Disconnect
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
