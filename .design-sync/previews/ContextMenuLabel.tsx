import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@drogon/desktop";
import * as React from "react";

/** Only shows inside an open menu - simulates a right-click to reveal it. */
export function InMenu() {
  const triggerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 12 }),
    );
  }, []);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={triggerRef} className="w-64 rounded border px-3 py-2 text-sm">
          Port 5173
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>:5173</ContextMenuLabel>
        <ContextMenuItem>Open in browser</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
