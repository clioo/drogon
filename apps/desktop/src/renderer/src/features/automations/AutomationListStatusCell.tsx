// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListStatusCell.tsx.
// Literal port (English copy, same DOM).
import { X } from "lucide-react";

export function AutomationListStatusCell({
  enabled,
}: {
  enabled: boolean;
}): React.JSX.Element {
  if (enabled) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
        Enabled
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
      <X className="size-3.5 shrink-0" />
      Paused
    </span>
  );
}
