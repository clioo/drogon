// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/SettingsSection.tsx
//     (section header with 24px/600 title + muted description, card-body
//      containment for the rows)
// Adapted: no zustand search-query gating here — the page owns visibility
// (active section, or every search match stacked); kept the header/body
// grammar byte-for-byte.
import type { ReactNode } from "react";

export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
  bodyClassName,
}: {
  id: string;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}): React.JSX.Element {
  return (
    <section
      id={id}
      data-settings-section={id}
      className={["scroll-mt-8 space-y-6", className].filter(Boolean).join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div className="min-w-0 space-y-2">
          <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold leading-tight text-foreground">
            {title}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div
        className={["rounded-xl border border-border/50 bg-card/50 px-7 py-6 shadow-xs", bodyClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </section>
  );
}
