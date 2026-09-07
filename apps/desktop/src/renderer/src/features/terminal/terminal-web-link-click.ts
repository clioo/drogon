// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-web-link-click.ts.
// Adapted: Orca's OSC-link routing and worktree-aware hit-testing do not
// exist in Drogon. The gesture gate is kept verbatim; the URL is routed
// through Drogon's browser authority source (system browser by default,
// Browser-pane tab when the user enabled "Capture links").

import { isTerminalOwnedLinkGesture } from "./terminal-link-activation";

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
    clearSelection?: () => void;
    report?: (message: string) => void;
  },
): boolean {
  if (!event || !isTerminalOwnedLinkGesture(event)) {
    return false;
  }
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
