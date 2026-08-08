import type { ReactNode } from "react";

/**
 * Amber warning/error banner — used wherever a connected source's live pull
 * failed and we're showing seeded/stale data instead of silently pretending
 * everything's fine. `title` is an optional icon+label header row (e.g. a
 * platform name); `action` is typically a "Reconnect" link.
 */
export function WarningBanner({
  title,
  action,
  className = "",
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30 ${className}`}
    >
      {title && (
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
          {title}
        </div>
      )}
      <p className={`text-sm text-amber-800 dark:text-amber-200 ${title ? "mt-1" : ""}`}>
        {children}
      </p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
