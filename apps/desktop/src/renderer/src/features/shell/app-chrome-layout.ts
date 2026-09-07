/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/lib/titlebar-left-chrome.ts
   (resolveLeftTitlebarChromeLayout), src/renderer/src/lib/
   titlebar-worktree-history-controls.ts (shouldShowWorktreeHistoryControls),
   the showSidebar rule in app-shell/use-app-chrome-layout.ts, and
   SIDEBAR_HEADER_WIDE_MIN_WIDTH in components/sidebar/
   sidebar-header-actions.tsx (adapter: this repo routes by a route id
   string instead of the zustand activeView, and has no tab strip,
   creation surface or right sidebar, so the layout collapses to which
   left chrome mounts and how wide its header is). */

/** Below this sidebar width the projects header collapses to "+" + overflow. */
export const SIDEBAR_HEADER_COMPACT_MIN_WIDTH = 235;

export function isWideSidebarHeader(sidebarWidth: number): boolean {
  return sidebarWidth >= SIDEBAR_HEADER_COMPACT_MIN_WIDTH;
}

export type AppChromeLayoutInput = {
  /** This repo's route id (null = sessions/landing); settings hides chrome. */
  route: string | null;
  /** The settings full-page route id (features/settings/settings-route). */
  settingsRouteId: string;
  sidebarOpen: boolean;
  sidebarWidth: number;
};

export type AppChromeLayout = {
  /** False on the settings full page: the page owns the whole content area. */
  showSidebar: boolean;
  /** False on the settings full page: no toggle/history/app-name controls. */
  showChromeControls: boolean;
  /** Back/forward span workspace + view history; hidden on settings pages. */
  showHistoryControls: boolean;
  /** Sidebar closed: the header shrink-wraps its controls over the content. */
  floating: boolean;
  /** Sidebar-column header width when open; null floats when collapsed. */
  leftChromeWidth: number | null;
};

export function resolveAppChromeLayout(
  input: AppChromeLayoutInput,
): AppChromeLayout {
  const isSettingsPage = input.route === input.settingsRouteId;
  const showSidebar = !isSettingsPage;
  const floating = showSidebar && !input.sidebarOpen;
  return {
    showSidebar,
    showChromeControls: showSidebar,
    showHistoryControls: !isSettingsPage,
    floating,
    leftChromeWidth: showSidebar && input.sidebarOpen ? input.sidebarWidth : null,
  };
}
