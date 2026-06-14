/** Brand logo from the Simple Icons CDN (used on the landing + Connections). */
export function BrandIcon({
  slug,
  label,
  className = "size-5",
}: {
  slug: string;
  label?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt={label ? `${label} logo` : ""}
      width={20}
      height={20}
      className={className}
    />
  );
}
