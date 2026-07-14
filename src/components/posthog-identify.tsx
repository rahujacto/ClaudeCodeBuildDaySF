"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Links the browser's anonymous PostHog id to the signed-in user so
 * client events (chat, connections, agent) and server events land on
 * the same person. Renders nothing.
 */
export function PostHogIdentify({
  userId,
  email,
}: {
  userId?: string;
  email?: string;
}) {
  useEffect(() => {
    if (userId && posthog.get_distinct_id() !== userId) {
      posthog.identify(userId, email ? { email } : undefined);
    }
  }, [userId, email]);
  return null;
}
