// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/types.ts (KeybindingScope, KeybindingContext)
//   src/shared/keybindings/effective.ts (isKeybindingAllowedInTerminal,
//   keybindingIsActiveInContext, terminal-shortcut policy default)
// Adapted: Drogon has no terminal-shortcut policy setting, so the policy is
// fixed to the source default ("orca-first": app shortcuts win inside the
// terminal). The browser/editor/fileExplorer scopes exist in the type for
// source fidelity; this MVP table only uses global/tabs/terminal/settings.

import type { KeybindingDefinition } from "./definitions";

export type KeybindingContext = "app" | "terminal";

export function isKeybindingAllowedInTerminal(
  definition: KeybindingDefinition,
): boolean {
  return definition.scope === "terminal" || definition.allowInTerminal === true;
}

/**
 * Tabs-scope chords never fire from an editable target (typing must win);
 * that matches the palette host's long-standing guard. Every other scope is
 * context-free under the orca-first policy: global chords fire inside the
 * terminal too, and terminal chords fire only there.
 */
export function isActiveInContext(
  definition: KeybindingDefinition,
  context: KeybindingContext,
  options: { editableTarget?: boolean } = {},
): boolean {
  if (definition.scope === "terminal") return context === "terminal";
  if (definition.scope === "tabs" && options.editableTarget === true) {
    return false;
  }
  return true;
}
