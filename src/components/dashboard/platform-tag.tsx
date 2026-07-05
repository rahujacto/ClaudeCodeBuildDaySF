import { BrandIcon } from "@/components/brand-icon";

/** Small platform chip (brand logo + name) used in section sublabels. */
export function PlatformTag({ slug, name }: { slug: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 normal-case text-zinc-500 dark:text-zinc-400">
      <BrandIcon slug={slug} label={name} className="size-4" />
      {name}
    </span>
  );
}
