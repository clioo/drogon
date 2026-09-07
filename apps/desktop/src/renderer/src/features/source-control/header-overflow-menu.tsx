// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/header-overflow-menu.tsx.
// Adapter: the MVP menu keeps the view-mode toggle and adds Refresh status
// (the header's refresh affordance belongs in the overflow on narrow rails).
// Base-ref, branch-compare refresh and Notes have no MVP backend and are
// not ported.
import React from "react";
import { List, ListTree, MoreHorizontal, RefreshCw } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import type { SourceControlViewMode } from "./section-file-list";

const MENU_CONTENT_CLASS =
  "min-w-[180px] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md z-50";
const MENU_ITEM_CLASS =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

export function SourceControlHeaderOverflowMenu({
  sourceControlViewMode,
  onToggleViewMode,
  onRefresh,
  refreshDisabled,
}: {
  sourceControlViewMode: SourceControlViewMode;
  onToggleViewMode: () => void;
  onRefresh: () => void;
  refreshDisabled: boolean;
}): React.JSX.Element {
  const viewModeLabel = sourceControlViewMode === "tree" ? "View as list" : "View as tree";

  return (
    <DropdownMenu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="inline-flex shrink-0">
            <DropdownMenu.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="More source control actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" sideOffset={6} className="tooltip">
            More source control actions
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className={MENU_CONTENT_CLASS}>
          <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={onToggleViewMode}>
            {sourceControlViewMode === "tree" ? (
              <List className="size-3.5" />
            ) : (
              <ListTree className="size-3.5" />
            )}
            {viewModeLabel}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={MENU_ITEM_CLASS}
            disabled={refreshDisabled}
            onSelect={onRefresh}
          >
            <RefreshCw className="size-3.5" />
            Refresh status
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
