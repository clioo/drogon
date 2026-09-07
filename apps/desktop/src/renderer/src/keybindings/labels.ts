// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/formatting.ts (formatKeybinding,
//   formatKeybindingList, key token labels)
// Adapted: platform is this repo's KeybindingPlatform instead of
// NodeJS.Platform; unparseable chords render verbatim. Labels are otherwise
// verbatim: ⌘/⌥/⇧ symbols with no separator on macOS, words joined with "+"
// elsewhere, "Unassigned" for empty binding lists.

import type { KeybindingPlatform } from "./definitions";
import { parseKeybinding } from "./parser";

const KEY_TOKEN_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Underscore: "_",
  Equal: "=",
  Plus: "+",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PageUp",
  PageDown: "PageDown",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Tab: "Tab",
  Escape: "Esc",
  Space: "Space",
};

const MAC_KEY_TOKEN_LABELS: Record<string, string> = {
  ...KEY_TOKEN_LABELS,
  Backspace: "⌫",
};

function formatKeyToken(token: string, isMac: boolean): string {
  return (isMac ? MAC_KEY_TOKEN_LABELS : KEY_TOKEN_LABELS)[token] ?? token;
}

/** Splits one stored chord into display labels, e.g. ["⌘", "⇧", "N"]. */
export function formatKeybinding(
  binding: string,
  platform: KeybindingPlatform,
): string[] {
  const parsed = parseKeybinding(binding);
  if (!parsed) return [binding];
  const isMac = platform === "darwin";
  if (parsed.doubleTapModifier) {
    const glyph =
      parsed.doubleTapModifier === "Mod"
        ? isMac
          ? "⌘"
          : "Ctrl"
        : (formatModifierGlyph(parsed.doubleTapModifier, isMac) ?? binding);
    return [glyph, glyph];
  }
  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.meta) parts.push(isMac ? "⌘" : "Cmd");
  if (parsed.control) parts.push(isMac ? "⌃" : "Ctrl");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(formatKeyToken(parsed.key, isMac));
  return parts;
}

function formatModifierGlyph(
  modifier: string,
  isMac: boolean,
): string | null {
  switch (modifier) {
    case "Cmd":
      return isMac ? "⌘" : "Cmd";
    case "Ctrl":
      return isMac ? "⌃" : "Ctrl";
    case "Alt":
      return isMac ? "⌥" : "Alt";
    case "Shift":
      return isMac ? "⇧" : "Shift";
    default:
      return null;
  }
}

/** Renders a binding list the way the source Settings pane does. */
export function formatKeybindingList(
  bindings: readonly string[],
  platform: KeybindingPlatform,
): string {
  if (bindings.length === 0) return "Unassigned";
  return bindings
    .map((binding) => {
      const separator = platform === "darwin" ? "" : "+";
      return formatKeybinding(binding, platform).join(separator);
    })
    .join(", ");
}
