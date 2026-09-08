// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/hooks/useShortcutLabel.ts (labels resolve through the
// shared keybinding table, never a hand-written constant) and
// src/renderer/src/components/tab-bar/use-tab-bar-runtime-model.ts
// (newTerminalShortcut/newBrowserShortcut come from `useShortcutLabel`).
// Adapter: Drogon's table lives in shared/keybindings; this model resolves
// the static create-menu rows to display chords so the menu can never drift
// from the table again (see #167).

import {
  bindingsForPlatform,
  formatKeybindingList,
  getKeybindingDefinition,
  resolveKeybindingPlatform,
} from "../../../../shared/keybindings";

/** Static create-menu rows that carry a chord hint, in fork menu order. */
export const TAB_CREATE_MENU_CHORD_IDS = [
  "tab.newTerminal",
  "tab.newBrowser",
  "tab.newMarkdown",
] as const;

export type TabCreateMenuChordId = (typeof TAB_CREATE_MENU_CHORD_IDS)[number];

export type TabCreateMenuChordPlatform = "darwin" | "other";

/** Display chord for one static row straight from the shared table ("" when unbound). */
export function tabCreateMenuChord(
  id: TabCreateMenuChordId,
  platform: TabCreateMenuChordPlatform,
): string {
  const definition = getKeybindingDefinition(id);
  if (!definition) return "";
  const keybindingPlatform = resolveKeybindingPlatform(platform);
  return formatKeybindingList(
    bindingsForPlatform(definition, keybindingPlatform),
    keybindingPlatform,
  );
}
