import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@drogon/desktop";
import { Server } from "lucide-react";
import * as React from "react";

/**
 * ContextMenu only opens on a real right-click, which a static screenshot
 * can't perform - so this preview simulates one on mount (the same event
 * Radix's own trigger listens for) to show the actual open menu surface.
 */
function useAutoOpen(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 12,
        clientY: rect.top + 12,
      }),
    );
  }, [ref]);
}

/** A port row's right-click menu, opened via a simulated right-click. */
export function Open() {
  const triggerRef = React.useRef<HTMLDivElement>(null);
  useAutoOpen(triggerRef);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
          className="flex w-64 items-center gap-2 rounded border px-3 py-2 text-sm"
        >
          <Server className="size-4 text-muted-foreground" />
          Port 5173
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>:5173</ContextMenuLabel>
        <ContextMenuItem>
          Open in browser
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>Copy URL</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup value="http">
          <ContextMenuRadioItem value="http">HTTP</ContextMenuRadioItem>
          <ContextMenuRadioItem value="https">HTTPS</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
