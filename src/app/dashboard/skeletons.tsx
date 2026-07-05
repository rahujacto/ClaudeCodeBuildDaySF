import { Section } from "@/components/dashboard/section";
import { PlatformTag } from "@/components/dashboard/platform-tag";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign, Activity, Megaphone, Mail } from "lucide-react";

/**
 * Streaming fallbacks for the dashboard sections. Each mirrors its section's
 * real header (same icon/label, via the shared Section component) so the page
 * layout is stable while the data streams in.
 */

export function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-100 dark:bg-zinc-800 ${className}`} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <Pulse className="h-3 w-20" />
      <Pulse className="mt-2.5 h-6 w-24" />
      <Pulse className="mt-2 h-3 w-28" />
    </div>
  );
}

function MetricGrid({ count, className }: { count: number; className: string }) {
  return (
    <div className={`mt-2 grid gap-4 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <MetricCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function RevenueSectionSkeleton({ fiveCols }: { fiveCols: boolean }) {
  return (
    <Section
      title="Revenue"
      icon={<DollarSign className="size-5" />}
      sublabel={<PlatformTag slug="shopify" name="Shopify" />}
      prominent
    >
      <MetricGrid
        count={fiveCols ? 5 : 4}
        className={fiveCols ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}
      />
    </Section>
  );
}

export function TrafficSectionSkeleton({ label }: { label: string }) {
  return (
    <Section
      title="Traffic"
      icon={<Activity className="size-5" />}
      prominent
      sublabel={<PlatformTag slug="googleanalytics" name={label} />}
    >
      <MetricGrid count={3} className="grid-cols-3" />
    </Section>
  );
}

export function AdsSectionSkeleton() {
  return (
    <Section
      title="Ads"
      icon={<Megaphone className="size-5" />}
      sublabel={
        <span className="inline-flex items-center gap-3">
          <PlatformTag slug="googleads" name="Google Ads" />
          <PlatformTag slug="meta" name="Meta" />
        </span>
      }
      prominent
    >
      <MetricGrid count={4} className="grid-cols-2 lg:grid-cols-4" />
    </Section>
  );
}

export function EmailSectionSkeleton() {
  return (
    <Section
      title="Email Marketing"
      icon={<Mail className="size-5" />}
      sublabel={<PlatformTag slug="mailchimp" name="Mailchimp" />}
      prominent
    >
      <MetricGrid count={4} className="grid-cols-2 lg:grid-cols-4" />
    </Section>
  );
}

export function ChartCardSkeleton() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <Pulse className="h-4 w-36" />
        <Pulse className="mt-1 h-3 w-48" />
      </CardHeader>
      <CardContent>
        <Pulse className="h-64 w-full rounded-xl" />
      </CardContent>
    </Card>
  );
}

export function TopProductsSkeleton() {
  return (
    <Card className="mt-4">
      <CardHeader>
        <Pulse className="h-4 w-28" />
        <Pulse className="mt-1 h-3 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Pulse key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
