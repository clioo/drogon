// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/hooks/useShortcutLabel.ts
//     (formatShortcutKeyComboDetails / useShortcutKeyDetails projections)
// Adapted: no zustand store — Drogon's keybinding core and persisted override
// store (definitions table + labels formatter) are the single source; the platform
// comes from the userAgent like the source's getShortcutPlatform.
import {
  getKeybindingDefinition,
  resolveKeybindingPlatform,
} from "../../../shared/keybindings/definitions";
import {
  formatKeybinding,
  formatKeybindingList,
} from "../../../shared/keybindings/labels";
import { parseKeybinding } from "../../../shared/keybindings/parser";
import { getEffectiveBindings } from "../../../shared/keybindings/overrides";

export type ShortcutPlatform = "darwin" | "other";

export function resolveShortcutPlatform(userAgent: string): ShortcutPlatform {
  return userAgent.includes("Mac") ? "darwin" : "other";
}

export type ShortcutKeyComboDetails = {
  keys: string[];
  doubleTap: boolean;
};

/**
 * Every effective binding of one action as display details, e.g.
 * `[{ keys: ["⌘", "⇧", "↑"], doubleTap: false }]` on macOS and
 * `[{ keys: ["Ctrl", "Shift", "↑"], doubleTap: false }]` elsewhere.
 * Disabled rows render no chips: their chords stay reserved but never fire.
 */
export function formatShortcutKeyComboDetails(
  actionId: string,
  platform: ShortcutPlatform,
): ShortcutKeyComboDetails[] {
  const definition = getKeybindingDefinition(actionId);
  if (!definition || definition.status.kind === "disabled") return [];
  const keybindingPlatform = resolveKeybindingPlatform(platform);
  return getEffectiveBindings(definition, keybindingPlatform).map((binding) => ({
    keys: formatKeybinding(binding, keybindingPlatform),
    doubleTap: parseKeybinding(binding)?.doubleTapModifier != null,
  }));
}

/** First binding of the action; `{ keys: [], doubleTap: false }` when unbound. */
export function useShortcutKeyDetails(
  actionId: string,
): ShortcutKeyComboDetails {
  return (
    formatShortcutKeyComboDetails(actionId, currentPlatform())[0] ?? {
      keys: [],
      doubleTap: false,
    }
  );
}

/** Every binding of the action, e.g. the Search row hint chips. */
export function useShortcutKeyComboDetails(
  actionId: string,
): ShortcutKeyComboDetails[] {
  return formatShortcutKeyComboDetails(actionId, currentPlatform());
}

function currentPlatform(): ShortcutPlatform {
  return resolveShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
}

/**
 * Single-chord hint label for palette rows: the primary binding only,
 * "⌘T" on macOS and "Ctrl+T" elsewhere; null when the action is unbound.
 */
export function formatShortcutChordHint(
  actionId: string,
  platform: ShortcutPlatform,
): string | null {
  const definition = getKeybindingDefinition(actionId);
  if (!definition || definition.status.kind === "disabled") return null;
  const keybindingPlatform = resolveKeybindingPlatform(platform);
  const [binding] = getEffectiveBindings(definition, keybindingPlatform);
  if (binding === undefined) return null;
  return formatKeybindingList([binding], keybindingPlatform);
}
