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

export function MetaAdsCard({
  initialConnected,
  initialAccountId,
  initialAccountName,
}: {
  initialConnected: boolean;
  initialAccountId: string;
  initialAccountName: string;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);
  const [editing, setEditing] = useState(false);
  const [adAccountId, setAdAccountId] = useState(initialAccountId);
  const [accountName, setAccountName] = useState(initialAccountName);
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function saveAndTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/connections/meta-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId, accessToken }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        setConnected(true);
        setEditing(false);
        setAccessToken("");
        if (data.accountName) setAccountName(data.accountName);
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
    await fetch("/api/connections/meta-ads", { method: "DELETE" });
    setConnected(false);
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
            <BrandIcon slug="meta" label="Meta Ads" />
            Meta Ads
          </CardTitle>
          <Badge variant={connected ? "default" : "secondary"}>
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
        <CardDescription>
          Paste an access token with <span className="font-mono">ads_read</span>{" "}
          and your Ad Account ID. We verify against the Marketing API, then
          encrypt the token.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!editing ? (
          connected ? (
            <div className="flex items-center justify-between">
              <span className="truncate text-sm text-zinc-500">
                {accountName || `act_${adAccountId}`}
              </span>
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
            <Button
              size="sm"
              className="w-fit"
              onClick={() => {
                setEditing(true);
                setResult(null);
              }}
            >
              Connect Meta Ads
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-account">Ad Account ID</Label>
              <Input
                id="meta-account"
                placeholder="act_1924761234498620 or 1924761234498620"
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-token">Access token (ads_read)</Label>
              <Input
                id="meta-token"
                type="password"
                placeholder="EAAB…"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveAndTest}
                disabled={loading || !adAccountId || !accessToken}
              >
                {loading ? "Testing…" : "Save & Test"}
              </Button>
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
              {connected && (
                <Button variant="destructive" size="sm" onClick={disconnect} disabled={loading}>
                  Disconnect
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
            {result.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
