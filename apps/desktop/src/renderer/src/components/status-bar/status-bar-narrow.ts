// MIT Copyright (c) 2026 Lovecast Inc. Narrow-width status-bar tiers ported
// from the Orca reference (read-only):
//   src/renderer/src/components/status-bar/use-status-bar-controller.ts
//     (compact = width < 900, iconOnly = width < 500),
//   src/renderer/src/components/status-bar/status-bar-container-observer.ts
//     (ResizeObserver width tracking),
//   src/renderer/src/components/status-bar/StatusBarSurface.tsx
//     (iconOnly falls back to the compact letter badge),
//   src/renderer/src/components/status-bar/StatusBarProviderSegment.tsx
//     (MiniBar renders only when !compact),
//   src/renderer/src/components/status-bar/SshStatusSegment.tsx
//     (host label hidden when compact; icon + status dot remain),
//   src/renderer/src/components/status-bar/CaffeinateStatusSegment.tsx
//     (mode label hidden when iconOnly),
//   src/renderer/src/components/status-bar/resource-usage-status-trigger.tsx
//     (badge labels hidden when iconOnly; session count kept when > 0),
//   src/renderer/src/components/status-bar/PortsStatusSegment.tsx
//     (count hidden when iconOnly unless ports exist).
// Adapted: Drogon's bar has two providers, a daemon connection segment (the
// fork's host-segment slot), awake, memory, terminal count and ports — the
// same tiers decide which labels collapse so the bar never scrolls
// horizontally at narrow widths. Pure: no React, no I/O.
/** Below this container width the bar drops minibars and the daemon label. */
export const STATUS_BAR_COMPACT_BELOW_WIDTH = 900;
/** Below this container width every segment collapses to its icon. */
export const STATUS_BAR_ICON_ONLY_BELOW_WIDTH = 500;

export type StatusBarDensity = "full" | "compact" | "icon-only";

export type StatusBarCollapse = {
  density: StatusBarDensity;
  /** Width < 900: provider minibars and the daemon text label collapse. */
  compact: boolean;
  /** Width < 500: every remaining text label collapses to its icon. */
  iconOnly: boolean;
  showProviderMiniBars: boolean;
  /**
   * Width < 900: each provider keeps its tightest window label only.
   * Adaptation (R16-C #127 keeps the longer "55% used 1h" copy while the
   * fork's compact labels are shorter): hiding the lower-priority windows
   * is what keeps the bar inside 760px; the full rows stay in the tooltip.
   */
  showAllProviderWindows: boolean;
  showProviderLabels: boolean;
  showDaemonLabel: boolean;
  showAwakeLabel: boolean;
  showMemoryLabel: boolean;
};

/** Density tier for a status-bar container width (fork thresholds). */
export function statusBarDensityForWidth(width: number): StatusBarDensity {
  if (width < STATUS_BAR_ICON_ONLY_BELOW_WIDTH) return "icon-only";
  if (width < STATUS_BAR_COMPACT_BELOW_WIDTH) return "compact";
  return "full";
}

/** Which segment labels survive at a container width. */
export function statusBarCollapseForWidth(width: number): StatusBarCollapse {
  const density = statusBarDensityForWidth(width);
  const compact = density !== "full";
  const iconOnly = density === "icon-only";
  return {
    density,
    compact,
    iconOnly,
    showProviderMiniBars: !compact,
    showAllProviderWindows: !compact,
    showProviderLabels: !iconOnly,
    showDaemonLabel: !compact,
    showAwakeLabel: !iconOnly,
    showMemoryLabel: !iconOnly,
  };
}

/** Track the bar's own width (fork observer); returns the live observer. */
export function observeStatusBarContainer(
  node: HTMLElement,
  onWidthChange: (width: number) => void,
): ResizeObserver {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      onWidthChange(entry.contentRect.width);
    }
  });
  observer.observe(node);
  return observer;
}
