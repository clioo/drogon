// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/lib/workspace-port-actions.ts (the open-in-browser
// decision helpers): Shift+Cmd/Ctrl+click is the system-browser escape
// hatch, every other activation opens the in-app browser tab. Adapted:
// this repo has no openLinksInApp setting, so the in-app browser tab is
// always the default target.

type PortOpenClickEvent = Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">;

function isMacShortcutPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

export function getPortSystemBrowserHint(isMac: boolean = isMacShortcutPlatform()): string {
  return isMac ? "⇧⌘+click for system browser" : "Shift+Ctrl+click for system browser";
}

export function getPortOpenBrowserTooltipLabel(openLabel: string, isMac?: boolean): string {
  return `${openLabel}. ${getPortSystemBrowserHint(isMac)}`;
}

/**
 * True when the click should open the in-app browser tab; the Shift+Cmd/Ctrl
 * escape hatch targets the system browser instead. No pointer event (context
 * menu, keyboard) keeps the in-app default, exactly like the source.
 */
export function shouldOpenPortInAppBrowser({
  event,
  isMac
}: {
  event?: PortOpenClickEvent | null
  isMac: boolean
}): boolean {
  if (event?.shiftKey && (isMac ? event.metaKey : event.ctrlKey)) {
    return false
  }
  return true
}
