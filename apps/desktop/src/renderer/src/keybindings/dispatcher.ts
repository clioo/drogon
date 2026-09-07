// Window-level dispatch rules, mirroring the reference
// (app-shell/use-global-keybindings.ts) minus the surfaces Drogon does not
// have yet (plugin chords, floating panel, shortcut recorder, terminal
// policy switch):
//  1. No match: never preventDefault, never handle.
//  2. While the palette is open only app.settings tunnels through; every
//     other chord belongs to the palette.
//  3. terminal.clear is terminal-scoped: outside the terminal the chord stays
//     reserved and no handler may claim it.
//  4. Tabs-scope (and workspace index) chords never fire from an editable
//     target, so typing wins. Global chords follow the orca-first policy and
//     fire everywhere, including the terminal.
//  5. Otherwise preventDefault and run the handler exactly once.
import type { KeybindingDefinition } from "./definitions";
import type { KeybindingContext } from "./scopes";

/** Terminal focus in Drogon means inside the active session panel. */
export function contextFromTarget(target: EventTarget | null): KeybindingContext {
  if (
    target instanceof HTMLElement &&
    target.closest("#active-session-panel") !== null
  ) {
    return "terminal";
  }
  return "app";
}

export function isPaletteOpen(): boolean {
  return document.querySelector(".command-palette-overlay") !== null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Whether a matched action may run for this event. Pure so the renderers
 * and the unit tests share one implementation of the preventDefault rules.
 */
export function shouldDispatch(params: {
  id: string;
  scope: KeybindingDefinition["scope"];
  paletteOpen: boolean;
  context: KeybindingContext;
  editableTarget: boolean;
}): boolean {
  if (params.paletteOpen && params.id !== "app.settings") return false;
  if (params.id === "terminal.clear" && params.context !== "terminal") {
    return false;
  }
  if (
    (params.scope === "tabs" || params.id === "workspace.selectByIndex") &&
    params.editableTarget
  ) {
    return false;
  }
  return true;
}
