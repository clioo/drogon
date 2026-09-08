// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/browser/browser-guest-shortcut-forwarding.ts (the
// before-input-event guest listener and preventDefault-and-forward shape).
// Adapted to the R12-E remainder only: the three browser pane chords
// (Mod+L address bar, Mod+R reload, Mod+F find) are matched here and
// forwarded as one `drogon:browserChord` IPC event; the source's wider
// policy surface (keybinding overrides, dictation, double-tap, page zoom,
// tab switcher) has no Drogon consumer. The chord semantics mirror the
// renderer matcher in features/browser/browser-pane-keyboard.ts — a focused
// guest is its own Chromium process whose key events never reach the
// renderer, so this main-side forwarder is the only path for them.

import type { BrowserChordEvent, BrowserPaneChord } from "../../shared/browser-contract";



export type GuestChordInput = {
  type: string;
  key: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
};

/**
 * Mirrors matchBrowserPaneChord on the main side: Mod (Cmd on macOS, Ctrl
 * elsewhere) plus L/R/F, with no Shift/Alt and no second platform modifier.
 * Returns null for everything else so the guest keeps the key.
 */
export function matchGuestBrowserChord(
  input: GuestChordInput,
  isMac: boolean,
): BrowserPaneChord | null {
  if (input.type !== "keyDown") return null;
  const mod = isMac ? input.meta : input.control;
  if (!mod || input.shift || input.alt) return null;
  // Why: on macOS Ctrl+key reaches the pane for Emacs-style caret moves;
  // only the platform Mod owns these chords.
  if (isMac ? input.control : input.meta) return null;
  const key = input.key.toLowerCase();
  if (key === "l") return "focus-address-bar";
  if (key === "r") return "reload";
  if (key === "f") return "find";
  return null;
}

/**
 * Attaches the guest `before-input-event` forwarder for one tab. Matching
 * chords are prevented from reaching the page and sent to the renderer
 * window; everything else passes through untouched. Returns the disposer.
 */
export function installGuestBrowserChordForwarding(args: {
  tabId: string;
  guest: {
    on(event: string, listener: (...args: never[]) => void): unknown;
    off(event: string, listener: (...args: never[]) => void): unknown;
  };
  isMac: boolean;
  forward: (event: BrowserChordEvent) => void;
}): () => void {
  const handler = (rawEvent: never, rawInput: never): void => {
    const event = rawEvent as { preventDefault(): void };
    const input = rawInput as unknown as GuestChordInput;
    const chord = matchGuestBrowserChord(input, args.isMac);
    if (!chord) return;
    event.preventDefault();
    args.forward({ tabId: args.tabId, chord });
  };
  args.guest.on("before-input-event", handler as never);
  return () => {
    try {
      args.guest.off("before-input-event", handler as never);
    } catch {
      // Best-effort: the guest may already be destroyed during teardown.
    }
  };
}
