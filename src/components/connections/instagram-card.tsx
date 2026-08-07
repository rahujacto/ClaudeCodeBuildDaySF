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

type Candidate = { igUserId: string; username?: string; pageName?: string };

export function InstagramCard({
  initialStatus,
  initialUsername,
}: {
  initialStatus: "connected" | "disconnected";
  initialUsername: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [username, setUsername] = useState(initialUsername);
  const [accessToken, setAccessToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Set when one token resolves to more than one linked Instagram account
  // (e.g. a token that manages several client Pages) — the user picks one.
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function submit(igUserId?: string) {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/connections/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, igUserId }),
      });
      const data = await res.json();
      if (data.needsSelection) {
        setCandidates(data.candidates ?? []);
        setResult({ ok: false, message: data.message });
        return;
      }
      setCandidates(null);
      setResult(data);
      if (data.ok) {
        setStatus("connected");
        setEditing(false);
        setAccessToken(""); // never keep the raw token in component state
        if (data.username) setUsername(data.username);
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
    await fetch("/api/connections/instagram", { method: "DELETE" });
    setStatus("disconnected");
    setEditing(true);
    setResult(null);
    setCandidates(null);
    setLoading(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BrandIcon slug="instagram" label="Instagram" />
            Instagram
          </CardTitle>
          {status === "connected" ? (
            <Badge>Connected</Badge>
          ) : (
            <Badge variant="secondary">Disconnected</Badge>
          )}
        </div>
        <CardDescription>
          Business or Creator accounts only. Paste a long-lived access token
          with <span className="font-medium">instagram_basic</span> +{" "}
          <span className="font-medium">instagram_manage_insights</span> —
          Pulse looks up the linked Instagram account for you, no ID to hunt
          down. We verify it live, then encrypt the token; it&apos;s never
          returned to the browser or logged.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!editing ? (
          status === "connected" ? (
            <div className="flex items-center justify-between">
              <span className="truncate text-sm text-zinc-500">
                {username ? `@${username}` : "Connected"}
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
              Connect Instagram
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ig-token">Access token</Label>
              <Input
                id="ig-token"
                type="password"
                placeholder="EAAG…"
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setCandidates(null);
                }}
                autoComplete="off"
              />
            </div>

            {candidates && candidates.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="text-xs font-medium text-zinc-500">
                  Multiple Instagram accounts found on this token — pick one:
                </div>
                {candidates.map((c) => (
                  <Button
                    key={c.igUserId}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => submit(c.igUserId)}
                    disabled={loading}
                  >
                    @{c.username ?? c.igUserId}
                    {c.pageName ? ` · ${c.pageName}` : ""}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={() => submit()} disabled={loading || !accessToken}>
                {loading ? "Testing…" : "Save & Test"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setResult(null);
                  setCandidates(null);
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
