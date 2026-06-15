"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
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
import type { MetaAccount } from "@/lib/adapters/types";

export function MetaAdsCard({ initialAccounts }: { initialAccounts: MetaAccount[] }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<MetaAccount[]>(initialAccounts);
  const [editing, setEditing] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const connected = accounts.length > 0;

  async function addAccount() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/connections/meta-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId, accessToken: accessToken || undefined }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        setAccounts(data.accounts ?? []);
        setAdAccountId("");
        setAccessToken("");
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "Network error — please retry." });
    } finally {
      setLoading(false);
    }
  }

  async function removeAccount(id: string) {
    setLoading(true);
    const res = await fetch("/api/connections/meta-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeAccountId: id }),
    });
    const data = await res.json();
    if (data.ok) setAccounts(data.accounts ?? []);
    setLoading(false);
    router.refresh();
  }

  async function disconnectAll() {
    setLoading(true);
    await fetch("/api/connections/meta-ads", { method: "DELETE" });
    setAccounts([]);
    setEditing(false);
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
            {connected ? `${accounts.length} account${accounts.length > 1 ? "s" : ""}` : "Disconnected"}
          </Badge>
        </div>
        <CardDescription>
          Connect one or more ad accounts (Facebook + Instagram) with an{" "}
          <span className="font-mono">ads_read</span> token. One token covers
          every account you can access.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!editing ? (
          connected ? (
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-zinc-500">
                {accounts.map((a) => a.accountName).join(", ")}
              </span>
              <Button variant="outline" size="sm" onClick={() => { setEditing(true); setResult(null); }}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            </div>
          ) : (
            <Button size="sm" className="w-fit" onClick={() => { setEditing(true); setResult(null); }}>
              Connect Meta Ads
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {accounts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {accounts.map((a) => (
                  <div
                    key={a.adAccountId}
                    className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{a.accountName}</span>
                      <span className="font-mono text-xs text-zinc-500">act_{a.adAccountId}</span>
                    </span>
                    <button
                      onClick={() => removeAccount(a.adAccountId)}
                      disabled={loading}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-destructive disabled:opacity-50 dark:hover:bg-zinc-800"
                      aria-label="Remove account"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-zinc-200 p-3 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-500">
                {accounts.length ? "Add another ad account" : "Add your first ad account"}
              </div>
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
                <Label htmlFor="meta-token">
                  Access token {accounts.length ? "(leave blank to reuse existing)" : "(ads_read)"}
                </Label>
                <Input
                  id="meta-token"
                  type="password"
                  placeholder="EAA…"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                size="sm"
                className="w-fit"
                onClick={addAccount}
                disabled={loading || !adAccountId || (!accounts.length && !accessToken)}
              >
                {loading ? "Testing…" : "Add & Test"}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setResult(null); }} disabled={loading}>
                Done
              </Button>
              {connected && (
                <Button variant="destructive" size="sm" onClick={disconnectAll} disabled={loading}>
                  Disconnect all
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
