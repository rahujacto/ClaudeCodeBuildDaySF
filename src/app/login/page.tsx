"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.82Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4-3.11Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginCard() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const hadError = params.get("error");
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    posthog.capture("sign_in_clicked", { provider: "google" });
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to Pulse</CardTitle>
        <CardDescription>
          Your agentic Shopify marketing manager. Sign in with Google to
          connect your store and get to work.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hadError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}
        <Button
          onClick={signIn}
          disabled={loading}
          variant="outline"
          size="lg"
          className="w-full gap-2.5 text-zinc-700 dark:text-zinc-200"
        >
          {loading ? (
            "Redirecting…"
          ) : (
            <>
              <GoogleIcon />
              Continue with Google
            </>
          )}
        </Button>
      </CardContent>
      <CardFooter>
        <Button variant="ghost" className="w-full" render={<Link href="/" />}>
          Back home
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <Suspense>
        <LoginCard />
      </Suspense>
    </div>
  );
}
