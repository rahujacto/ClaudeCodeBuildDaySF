import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Pulse</CardTitle>
          <CardDescription>
            Google sign-in wires up in the next step. For now this confirms the
            app is live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button disabled className="w-full">
            Continue with Google (coming next)
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            render={<Link href="/" />}
          >
            Back home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
