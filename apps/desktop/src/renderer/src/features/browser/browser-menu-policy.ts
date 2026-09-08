// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserToolbarMenu.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-toolbar-menu-dropdown.tsx
//   (menu rows the chrome may offer)
// Adapted to the MVP subset this pane can back honestly: open in system
// browser (https only, shell policy), copy URL, reload, zoom in/out/reset,
// find in page. Profiles, cookie import, viewport presets and settings rows
// are not ported (no profile store, no cookie access, no viewport override).

export type BrowserToolbarMenuPolicy = {
  /** Current page URL; empty or non-https disables system-browser/copy rows. */
  pageUrl: string;
  /** Null unless the page opened externally (https only, shell policy). */
  externalUrl: string | null;
  zoomPercent: number;
};

export function resolveBrowserToolbarMenuPolicy(input: {
  pageUrl: string;
  externalUrl: string | null;
  zoomPercent: number;
}): BrowserToolbarMenuPolicy {
  return {
    pageUrl: input.pageUrl,
    externalUrl: input.externalUrl,
    zoomPercent: input.zoomPercent,
  };
}
