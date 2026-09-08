// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-expansion.ts
// Adapted: formatting only (quotes/semicolons); the width contract and the
// focused-collapsed overlay rule are unchanged (fork issue #11090, Drogon #114).

// Every other browser toolbar control is shrink-0, so the address bar absorbs
// all of the squeeze when the pane narrows and ends up as the leading globe
// icon with a zero-width input. Below this slot width the bar overlays the
// toolbar while focused instead, keeping the URL editable (issue #11090).
export const BROWSER_ADDRESS_BAR_MIN_INLINE_WIDTH = 220;

export function isBrowserAddressBarCollapsed(inlineWidth: number | null): boolean {
  return inlineWidth !== null && inlineWidth < BROWSER_ADDRESS_BAR_MIN_INLINE_WIDTH;
}

export function shouldOverlayBrowserAddressBar({
  inlineWidth,
  focused,
}: {
  inlineWidth: number | null;
  focused: boolean;
}): boolean {
  return focused && isBrowserAddressBarCollapsed(inlineWidth);
}
