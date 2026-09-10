// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-link-activation.ts.
// The platform hook (terminal-link-open-hints.ts) is inlined: Drogon has no
// shared http-link-routing vocabulary.

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
  );
}

export function isTerminalLinkActivation(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey"> | undefined,
): boolean {
  return isMacPlatform() ? Boolean(event?.metaKey) : Boolean(event?.ctrlKey);
}

type TerminalLinkMouseEvent = Pick<MouseEvent, "ctrlKey" | "metaKey"> &
  Partial<Pick<MouseEvent, "altKey" | "button" | "shiftKey">>;

// Owner-specified (2026-09-10): a plain left click opens the link outright
// (default browser) and Shift+click opens it in Drogon's browser, so every
// unmodified left click activates instead of raising the action popover.
// ⌘/Ctrl+click keeps working as an activation for existing muscle memory.
export function isTerminalLinkDirectActivation(
  event: TerminalLinkMouseEvent | undefined,
): boolean {
  return Boolean(
    event && (event.button === undefined || event.button === 0) && !event.altKey,
  );
}

export function isTerminalLinkActionActivation(
  event: TerminalLinkMouseEvent | undefined,
): boolean {
  return Boolean(
    event &&
      (event.button === undefined || event.button === 0) &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey,
  );
}

export function isTerminalOwnedLinkGesture(
  event: TerminalLinkMouseEvent | undefined,
): boolean {
  return (
    isTerminalLinkDirectActivation(event) ||
    isTerminalLinkActionActivation(event)
  );
}

/** Hint suffix for link tooltips, matching the source's copy. */
export function terminalLinkModifierHint(): string {
  return isMacPlatform()
    ? "⌘+click to open"
    : "Ctrl+click to open";
}
