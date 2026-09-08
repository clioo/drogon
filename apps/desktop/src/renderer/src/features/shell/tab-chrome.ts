/* MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from Orca's
   src/renderer/src/components/tab-bar/tab-width-rules.ts,
   src/renderer/src/components/tab-bar/drop-indicator.ts and
   src/renderer/src/components/tab-bar/tab-context-menu-sizing.ts. */

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

export type DropIndicator = "left" | "right" | null;

// Why: the theme's accent color is too subtle for a drag-and-drop insertion
// cue. A vivid blue matches VS Code's tab.dragAndDropBorder and is
// immediately visible against all tab backgrounds. Pseudo-elements sit above
// the tab's own border so the indicator does not shift layout.
export function getDropIndicatorClasses(dropIndicator: DropIndicator): string {
  if (dropIndicator === "left") {
    return "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-blue-500 before:z-10 before:content-['']";
  }
  if (dropIndicator === "right") {
    return "after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-blue-500 after:z-10 after:content-['']";
  }
  return "";
}

// Why: a fixed menu width wraps labels onto a second line once the label
// grows — worst on Windows/Linux, where chords are wider than macOS glyphs,
// and in locales with longer copy. Size to content instead, capped so a
// long label still can't run off screen.
export const TAB_CONTEXT_MENU_CONTENT_CLASS =
  "min-w-[13rem] max-w-[calc(100vw-1rem)] whitespace-nowrap";
