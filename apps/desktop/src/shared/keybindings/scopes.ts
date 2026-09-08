// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/types.ts (KeybindingScope, KeybindingContext)
//   src/shared/keybindings/effective.ts (isKeybindingAllowedInTerminal,
//   keybindingIsActiveInContext, terminal-shortcut policy default)
// Adapted: Drogon has no terminal-shortcut policy setting, so the policy is
// fixed to the source default ("orca-first": app shortcuts win inside the
// terminal). Surface-local scopes are preferred by their pane dispatchers;
// global chords retain the source's app-first behavior.

import type { KeybindingDefinition } from "./definitions";

export type KeybindingContext = "app" | "terminal" | "browser";

export function isKeybindingAllowedInTerminal(
  definition: KeybindingDefinition,
): boolean {
  return definition.scope === "terminal" || definition.allowInTerminal === true;
}

/**
 * Tab navigation/index chords yield from an editable target (typing must
 * win), while explicit tab actions such as New/Close remain reachable. Every
 * other scope is context-free under the orca-first policy: global chords fire
 * inside the terminal too, and terminal chords fire only there. Pane
 * dispatchers can prioritize their own scope when rows share a chord.
 */
const EDITABLE_TAB_NAVIGATION_IDS = new Set([
  "tab.nextSameType",
  "tab.previousSameType",
  "tab.nextAllTypes",
  "tab.previousAllTypes",
  "tab.previousRecent",
  "tab.nextTerminal",
  "tab.previousTerminal",
  "tab.selectByIndex",
]);

/** Text editors yield navigation/index chords, but keep explicit tab actions
 * such as New, Close and Reopen reachable while Monaco or an input is focused. */
export function yieldsToEditableTarget(
  definition: Pick<KeybindingDefinition, "id">,
): boolean {
  return EDITABLE_TAB_NAVIGATION_IDS.has(definition.id);
}

export function isActiveInContext(
  definition: KeybindingDefinition,
  context: KeybindingContext,
  options: { editableTarget?: boolean } = {},
): boolean {
  if (definition.scope === "terminal") return context === "terminal";
  if (
    definition.scope === "tabs" &&
    options.editableTarget === true &&
    yieldsToEditableTarget(definition)
  ) {
    return false;
  }
  return true;
}
