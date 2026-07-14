import { after } from "next/server";
import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

/** Null when NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is unset — callers must no-op. */
export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

/**
 * Fire-and-forget server-side capture. Runs after the response is sent
 * (via next/server `after`) and swallows all errors — analytics must never
 * add latency to or break a request.
 */
export function captureServer(event: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) {
  const client = getPostHogClient();
  if (!client) return;
  const send = async () => {
    try {
      client.capture(event);
      await client.flush();
    } catch {
      // never let analytics failures surface
    }
  };
  try {
    after(send);
  } catch {
    // outside a request scope (e.g. mid-stream) — send directly
    void send();
  }
}
