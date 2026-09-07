// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/action-button.tsx.
// Adapter: local Button plus the radix-ui Tooltip the right-sidebar host
// already uses (no local TooltipProvider: App owns the single one).
import React from "react";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import { cn } from "./panel-class-names";

export function ActionButton({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onClick: (event: React.MouseEvent) => void;
  disabled?: boolean;
}): React.JSX.Element {
  // Why: use Radix Tooltip (not native title) to match sidebar chrome.
  // Why (disabled): a disabled <button> loses pointer-events in Chromium and hides the Radix tooltip; keep it interactive and no-op via the caller's isExecutingBulk early-return.
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 text-muted-foreground hover:bg-background/70 hover:text-foreground",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          aria-label={title}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault();
              return;
            }
            onClick(event);
          }}
        >
          <Icon className="size-3.5" />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="bottom" sideOffset={6}>
          {title}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
