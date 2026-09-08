// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-web-link-click.ts.
// Adapted: Orca's OSC-link routing, worktree-aware hit-testing and runtime
// destinations do not exist in Drogon. Kept verbatim: the gesture gate (a
// modifier-held click opens directly, a plain click raises the link action
// popover — the source never opens on a plain click) and the
// selection-clearing navigation guard. The URL is routed through Drogon's
// browser tab opener; the gesture split lives here so both entry points are
// unit-testable.
import {
  isTerminalLinkActionActivation,
  isTerminalLinkDirectActivation,
  isTerminalOwnedLinkGesture,
} from "./terminal-link-activation";

export type TerminalWebLinkOpener = (
  url: string,
) => Promise<{ ok: true } | { ok: false; message: string }>;

export function handleTerminalWebLinkClick(
  url: string,
  event:
    | (Pick<MouseEvent, "metaKey" | "ctrlKey" | "preventDefault"> &
        Partial<Pick<MouseEvent, "altKey" | "button" | "shiftKey">>)
    | undefined,
  deps: {
    openUrl: TerminalWebLinkOpener;
    /** Plain-click path: raise the link action popover (fork parity). */
    requestAction?: (event: MouseEvent) => boolean;
    clearSelection?: () => void;
    report?: (message: string) => void;
  },
): boolean {
  if (!event || !isTerminalOwnedLinkGesture(event)) {
    return false;
  }
  if (isTerminalLinkDirectActivation(event)) {
    event.preventDefault();
    void deps
      .openUrl(url)
      .then((result) => {
        if (!result.ok) deps.report?.(result.message);
      })
      .catch(() => {
        deps.report?.("The link could not be opened.");
      });
    // Why: link navigation can steal focus before xterm's mouseup cleanup;
    // clearing selection also detaches its pending drag-selection listeners.
    deps.clearSelection?.();
    return true;
  }
  // Plain click (no modifier): the source opens the link action popover
  // instead of navigating. Without a popover requester the click is
  // deliberately unhandled — never a silent navigation.
  if (
    isTerminalLinkActionActivation(event) &&
    deps.requestAction?.(event as MouseEvent)
  ) {
    return true;
  }
  return false;
}
