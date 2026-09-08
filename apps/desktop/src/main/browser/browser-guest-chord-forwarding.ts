// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/browser/browser-guest-shortcut-forwarding.ts (the
// before-input-event guest listener and preventDefault-and-forward shape).
// Adapted to the Drogon browser bridge: browser-scope defaults are resolved
// through the shared registry and forwarded to renderer-owned chrome because
// a focused WebContentsView cannot reach the renderer DOM.

import {
  createKeybindingRegistry,
  getKeybindingPlatform,
} from "../../shared/keybindings";
import type {
  BrowserChordEvent,
  BrowserPaneChord,
} from "../../shared/browser-contract";

export type GuestChordInput = {
  type: string;
  key: string;
  code?: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
  isAutoRepeat?: boolean;
};

const CHORD_BY_ACTION: Partial<Record<string, BrowserPaneChord>> = {
  "browser.focusAddressBar": "focus-address-bar",
  "browser.reload": "reload",
  "browser.hardReload": "hard-reload",
  "browser.find": "find",
  "browser.back": "back",
  "browser.forward": "forward",
};

/**
 * Matches browser-scope defaults on the host side. Browser scope is preferred
 * so Mod+L resolves to the address bar instead of the global sidebar toggle.
 * Unsupported browser actions (copy/element capture) deliberately return null
 * and leave the page's native Cmd/Ctrl+C behavior untouched.
 */
export function matchGuestBrowserChord(
  input: GuestChordInput,
  platformOrIsMac: typeof process.platform | boolean,
): BrowserPaneChord | null {
  if (input.type !== "keyDown" || input.isAutoRepeat) return null;
  const platform =
    typeof platformOrIsMac === "boolean"
      ? platformOrIsMac
        ? "darwin"
        : "linux"
      : platformOrIsMac;
  const match = createKeybindingRegistry().match(
    {
      key: input.key,
      code: input.code,
      meta: input.meta,
      control: input.control,
      shift: input.shift,
      alt: input.alt,
    },
    getKeybindingPlatform(platform),
    "browser",
    { preferredScopes: ["browser"] },
  );
  return match ? (CHORD_BY_ACTION[match.id] ?? null) : null;
}

/**
 * Attaches the guest `before-input-event` forwarder for one tab. Matching
 * chords are prevented from reaching the page and sent to the renderer
 * window; everything else passes through untouched.
 */
export function installGuestBrowserChordForwarding(args: {
  tabId: string;
  guest: {
    on(event: string, listener: (...args: never[]) => void): unknown;
    off(event: string, listener: (...args: never[]) => void): unknown;
  };
  /** New callers pass the Node platform; `isMac` keeps the existing seam stable. */
  platform?: typeof process.platform;
  isMac?: boolean;
  forward: (event: BrowserChordEvent) => void;
}): () => void {
  const handler = (rawEvent: never, rawInput: never): void => {
    const event = rawEvent as { preventDefault(): void };
    const input = rawInput as unknown as GuestChordInput;
    const chord = matchGuestBrowserChord(
      input,
      args.platform ?? args.isMac ?? process.platform,
    );
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
