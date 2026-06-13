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

function LoginCard() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const hadError = params.get("error");
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
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
          Your AI business analyst. Sign in with Google to connect your store
          and start asking.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hadError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}
        <Button onClick={signIn} disabled={loading} className="w-full">
          {loading ? "Redirecting…" : "Continue with Google"}
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
