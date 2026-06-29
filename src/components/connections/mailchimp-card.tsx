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

export function MailchimpCard({
  initialStatus,
  initialAccountName,
}: {
  initialStatus: "connected" | "disconnected";
  initialAccountName: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [accountName, setAccountName] = useState(initialAccountName);
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function saveAndTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/connections/mailchimp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        setStatus("connected");
        setEditing(false);
        setApiKey(""); // never keep the raw key in component state
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
    await fetch("/api/connections/mailchimp", { method: "DELETE" });
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
            <BrandIcon slug="mailchimp" label="Mailchimp" />
            Mailchimp
          </CardTitle>
          {status === "connected" ? (
            <Badge>Connected</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Paste your Mailchimp API key (Account → Extras → API keys). We verify it
          live, then encrypt it — it&apos;s never returned to the browser or logged.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!editing ? (
          status === "connected" ? (
            <div className="flex items-center justify-between">
              <span className="truncate text-sm text-zinc-500">
                {accountName || "Connected"}
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
              Connect Mailchimp
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mc-key">API key</Label>
              <Input
                id="mc-key"
                type="password"
                placeholder="xxxxxxxxxxxxxxxx-us21"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveAndTest} disabled={loading || !apiKey}>
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
              {status === "connected" && (
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
