"use client";

import posthog from "posthog-js";
import { Button } from "@/components/ui/button";

/** Sign-out form that also resets the PostHog identity for this browser. */
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post" onSubmit={() => posthog.reset()}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
