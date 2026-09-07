// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/entry-context-menu.tsx.
// Adapter: the MVP menu keeps the source's View / Copy Path / Copy Relative
// Path items with the same DOM and classes. The Open-in submenu and the
// File-Explorer reveal have no desktop counterpart yet and are not ported;
// clipboard goes through navigator.clipboard.
import React, { useCallback } from "react";
import { Copy, Eye } from "lucide-react";
import { ContextMenu } from "radix-ui";

type SourceControlEntryContextMenuProps = {
  absolutePath?: string;
  relativePath?: string;
  onView?: () => void;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

const MENU_CONTENT_CLASS =
  "min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md z-50";
const MENU_ITEM_CLASS =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

export function SourceControlEntryContextMenu({
  absolutePath,
  relativePath,
  onView,
  onOpenChange,
  children,
}: SourceControlEntryContextMenuProps): React.JSX.Element {
  const handleCopyPath = useCallback(() => {
    if (!absolutePath) {
      return;
    }
    void navigator.clipboard.writeText(absolutePath);
  }, [absolutePath]);

  const handleCopyRelativePath = useCallback(() => {
    if (!relativePath) {
      return;
    }
    void navigator.clipboard.writeText(relativePath);
  }, [relativePath]);

  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={`w-52 ${MENU_CONTENT_CLASS}`}>
          <ContextMenu.Item
            className={MENU_ITEM_CLASS}
            onSelect={onView}
            disabled={!onView}
          >
            <Eye className="size-3.5" />
            View
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className={MENU_ITEM_CLASS}
            onSelect={handleCopyPath}
            disabled={!absolutePath}
          >
            <Copy className="size-3.5" />
            Copy Path
          </ContextMenu.Item>
          <ContextMenu.Item
            className={MENU_ITEM_CLASS}
            onSelect={handleCopyRelativePath}
            disabled={!relativePath}
          >
            <Copy className="size-3.5" />
            Copy Relative Path
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
