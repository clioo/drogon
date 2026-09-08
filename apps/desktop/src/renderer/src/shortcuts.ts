// Thin adapter over the keybinding core (`./keybindings/`): the palette
// host keeps importing its chord table from here, but every id, chord and
// title now comes from the source-parity definition table. The legacy
// hand-rolled registry (duplicate ids only, subset modifier matching,
// single platform-blind chord) is gone: matching lives in
// `./keybindings/registry.ts`, which is scope-aware, exact and
// conflict-free by construction.
import {
  bindingsForPlatform,
  getKeybindingDefinition,
  KEYBINDING_DEFINITIONS,
  resolveKeybindingPlatform,
  type KeybindingDefinition,
  type KeybindingPlatform,
} from "../../shared/keybindings/definitions";

export type { KeybindingDefinition };

/**
 * Ids the command-palette host owns (quick open, toggle, tab travel), in
 * source table order — the source treats definition order as palette order.
 */
export const PALETTE_SHORTCUT_IDS: readonly string[] = [
  "worktree.quickOpen",
  "worktree.palette",
  "tab.nextSameType",
  "tab.previousSameType",
  "tab.nextAllTypes",
  "tab.previousAllTypes",
  "tab.selectByIndex",
];

/** Palette-owned definitions in source table order. */
export const PALETTE_SHORTCUTS: readonly KeybindingDefinition[] =
  KEYBINDING_DEFINITIONS.filter((definition) =>
    PALETTE_SHORTCUT_IDS.includes(definition.id),
  );

export type UiPlatform = "darwin" | "other";

function toKeybindingPlatform(platform: UiPlatform): KeybindingPlatform {
  return resolveKeybindingPlatform(platform);
}

/** Display chords for one definition on this UI platform. */
export function chordsForPlatform(
  definition: KeybindingDefinition,
  platform: UiPlatform,
): readonly string[] {
  return bindingsForPlatform(definition, toKeybindingPlatform(platform));
}

/** First chord for one palette id on this UI platform, if it has any. */
export function paletteChordFor(
  id: string,
  platform: UiPlatform,
): string | null {
  const definition = getKeybindingDefinition(id);
  if (!definition || !PALETTE_SHORTCUT_IDS.includes(id)) return null;
  return chordsForPlatform(definition, platform)[0] ?? null;
}

/** Wraps a handler so it is skipped while `isDisabled()` is true (e.g. busy/loading guards). */
export function guardHandler(
  handler: () => void,
  isDisabled: () => boolean,
): () => void {
  return () => {
    if (isDisabled()) return;
    handler();
  };
}
