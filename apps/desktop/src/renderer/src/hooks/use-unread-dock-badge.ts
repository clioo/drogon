// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/hooks/useUnreadDockBadge.ts
//   (setUnreadDockBadgeCountBestEffort / clearUnreadDockBadgeCount)
// Adapted: Orca derives the count from its zustand tab store via
// createUnreadBadgeCountSelector; Drogon's shell owns the session list, so
// App computes the needs_input count and passes it in — the hook only syncs
// the external OS dock badge (never React render state).
import { useEffect } from "react";
import type { AppMenuBridge } from "../../../shared/menu-contract";

/** The granted `window.drogon.appMenu` namespace (absent in older preloads). */
export function windowAppMenuBridge(): AppMenuBridge | null {
  try {
    return window.drogon?.appMenu ?? null;
  } catch {
    return null;
  }
}

function setUnreadDockBadgeCountBestEffort(bridge: AppMenuBridge | null, count: number): void {
  if (!bridge) {
    return;
  }
  bridge.setUnreadDockBadgeCount(count).catch(() => {
    // Dock sync is best-effort chrome; stale badge state should not affect app use.
  });
}

export function clearUnreadDockBadgeCount(bridge: AppMenuBridge | null): void {
  setUnreadDockBadgeCountBestEffort(bridge, 0);
}

/** Publishes the needs_input count to the macOS dock badge (darwin-only in main). */
export function useUnreadDockBadge(unreadCount: number): void {
  useEffect(() => {
    setUnreadDockBadgeCountBestEffort(windowAppMenuBridge(), unreadCount);
  }, [unreadCount]);
}
