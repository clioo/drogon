/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/activity-bar-buttons.tsx
   (ActivityBarButton, top layout only). Adapter: radix-ui Tooltip like
   App's IconButton (no shadcn tooltip), plain class strings (no cn), and
   no checks-status dot — no Checks panel exists in the MVP set. */
import { Tooltip } from "radix-ui";
import type { ActivityBarItem } from "./activity-bar-items";
import { activityItemAriaLabel } from "./activity-bar-items";

/** Class opting the button out of the header's Electron drag region. */
export const RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME =
  "right-sidebar-header-no-drag";

export function ActivityBarButton({
  item,
  active,
  onClick,
}: {
  item: ActivityBarItem;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const Icon = item.icon;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={`relative flex h-[36px] w-9 shrink-0 items-center justify-center transition-colors ${RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME} ${
            active
              ? "text-foreground"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          }`}
          onClick={onClick}
          aria-label={activityItemAriaLabel(item)}
        >
          <Icon size={16} />
          {active && (
            <div className="absolute bottom-0 left-[25%] right-[25%] h-[2px] bg-foreground rounded-t" />
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="bottom" sideOffset={6}>
          {activityItemAriaLabel(item)}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
