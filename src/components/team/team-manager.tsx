"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { OrgInvite, OrgMember, OrgRole } from "@/lib/org";

export function TeamManager({
  isAdmin,
  currentUserId,
  initialMembers,
  initialInvites,
}: {
  isAdmin: boolean;
  currentUserId: string;
  initialMembers: OrgMember[];
  initialInvites: OrgInvite[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setMembers(data.members ?? []);
        setInvites(data.invites ?? []);
        if (body.action === "invite") setMessage({ ok: true, text: `Invited ${body.email}.` });
      } else {
        setMessage({ ok: false, text: data.message ?? "Failed." });
      }
    } catch {
      setMessage({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-sm font-medium">Invite a team member</div>
          <p className="text-sm text-zinc-500">
            They sign in with Google using this email and instantly see your
            org&apos;s dashboards — no connector setup.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 flex-1"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              className="h-9"
              disabled={busy || !email.includes("@")}
              onClick={() => act({ action: "invite", email: email.trim(), role })}
            >
              Invite
            </Button>
          </div>
          <p className="text-xs text-zinc-400">
            <span className="font-medium">Admins</span> manage connectors;{" "}
            <span className="font-medium">Members</span> view-only.
          </p>
          {message && (
            <div
              className={`rounded-md px-3 py-2 text-sm ${
                message.ok
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {message.text}
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">Members ({members.length})</div>
        <div className="flex flex-col gap-1.5">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <span className="truncate">
                {m.email}
                {m.user_id === currentUserId && (
                  <span className="ml-2 text-xs text-zinc-400">(you)</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {isAdmin && m.user_id !== currentUserId ? (
                  <select
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => act({ action: "role", userId: m.user_id, role: e.target.value })}
                    className="h-7 rounded-md border border-zinc-200 bg-transparent px-1.5 text-xs dark:border-zinc-800"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <Badge variant={m.role === "admin" ? "default" : "secondary"}>{m.role}</Badge>
                )}
                {isAdmin && m.user_id !== currentUserId && (
                  <button
                    onClick={() => act({ action: "remove", userId: m.user_id })}
                    disabled={busy}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-destructive disabled:opacity-50 dark:hover:bg-zinc-800"
                    aria-label="Remove member"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium">Pending invites</div>
          <div className="flex flex-col gap-1.5">
            {invites.map((i) => (
              <div
                key={i.email}
                className="flex items-center justify-between rounded-md border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800"
              >
                <span className="truncate">{i.email}</span>
                <Badge variant="secondary">{i.role} · pending</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
