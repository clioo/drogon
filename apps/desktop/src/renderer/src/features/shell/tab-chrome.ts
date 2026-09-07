/* MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from Orca's
   src/renderer/src/components/tab-bar/tab-width-rules.ts and
   src/renderer/src/components/tab-bar/drop-indicator.ts (drop-indicator
   classes kept for the BrowserTab chrome even though drag reorder is out
   of MVP scope and no indicator is ever set). */

// Why: the strip shrink-wraps its tabs, so a content-derived width lets one live title update
// resize every tab; a definite width pins them and flex-shrink still narrows to the floor.
export const TAB_CONTAINER_WIDTH_CLASSES =
  "w-[180px] min-w-[88px] min-[1280px]:w-[220px]";

export const TAB_LABEL_WIDTH_CLASSES = "min-w-0 flex-1 truncate";

// Why: a 2px bar on the active tab's BOTTOM edge, bridging the tab into the
// panel it owns. (See the source file for the full rationale.)
export const ACTIVE_TAB_INDICATOR_CLASSES =
  "pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_srgb,var(--foreground)_60%,var(--card))] z-20";

export function getTabRootStateClasses(isActive: boolean): string {
  return isActive
    ? "bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground"
    : "bg-card text-muted-foreground hover:text-foreground";
}

export function getTabStripBorderClasses(
  hasTabsToRight: boolean,
  options?: { includeTopBorder?: boolean },
): string {
  const includeTopBorder = options?.includeTopBorder ?? true;
  return [
    includeTopBorder ? "border-t" : "",
    hasTabsToRight ? "border-r" : "",
    "border-border",
  ]
    .filter(Boolean)
    .join(" ");
}
