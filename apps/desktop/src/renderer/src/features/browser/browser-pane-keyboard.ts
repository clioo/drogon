// MIT Copyright (c) 2026 Lovecast Inc.
// Pane-local browser matching uses the shared source registry rather than a
// second hand-written chord table. Browser scope is preferred so Mod+L does
// not resolve to the global right-sidebar toggle while page chrome is active.
import {
  createKeybindingRegistry,
  resolveKeybindingPlatform,
  type KeybindingPlatform,
} from "../../../../shared/keybindings";

export type BrowserPaneChord =
  "focus-address-bar" | "reload" | "hard-reload" | "find" | "back" | "forward";

type ChordEvent = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
};

const CHORD_BY_ACTION: Partial<Record<string, BrowserPaneChord>> = {
  "browser.focusAddressBar": "focus-address-bar",
  "browser.reload": "reload",
  "browser.hardReload": "hard-reload",
  "browser.find": "find",
  "browser.back": "back",
  "browser.forward": "forward",
};

/** Match the source browser-scope defaults and any saved renderer override. */
export function matchBrowserPaneChord(
  event: ChordEvent,
  isMac: boolean,
): BrowserPaneChord | null {
  if (event.repeat) return null;
  const registry = createKeybindingRegistry();
  const platform: KeybindingPlatform = isMac ? "darwin" : "linux";
  const match = registry.match(
    {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    },
    platform,
    "browser",
    { preferredScopes: ["browser"] },
  );
  return match ? (CHORD_BY_ACTION[match.id] ?? null) : null;
}
