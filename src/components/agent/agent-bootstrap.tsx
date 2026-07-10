"use client";

import { useEffect } from "react";

/**
 * First-login bootstrap: if the org has no agent profile yet, kick off
 * generation in the background so the Pulse assistant is grounded in the
 * business from the start. Fire-and-forget; guarded per browser session.
 */
export function AgentBootstrap() {
  useEffect(() => {
    if (sessionStorage.getItem("pulse_agent_bootstrap")) return;
    sessionStorage.setItem("pulse_agent_bootstrap", "1");
    void (async () => {
      try {
        const res = await fetch("/api/agent");
        if (!res.ok) return;
        const { profile, isAdmin } = await res.json();
        const hasLayers = profile && Object.values(profile.layers ?? {}).some(Boolean);
        if (!hasLayers && isAdmin) {
          await fetch("/api/agent/generate", { method: "POST" });
        }
      } catch {
        // Background nicety only — the Agent page can always generate manually.
      }
    })();
  }, []);
  return null;
}
