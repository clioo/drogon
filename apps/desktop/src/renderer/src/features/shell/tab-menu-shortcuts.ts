/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/hooks/useShortcutLabel.ts (menu shortcut hints resolve
   through the shared keybinding table with the user's persisted overrides
   applied, never a hand-written constant). Adapter: Drogon's table lives
   in shared/keybindings; menus call these pure helpers with the platform
   so tests never touch localStorage. An unbound action renders no hint —
   the fork hides the shortcut when the label would read "Unassigned". */

import {
  formatKeybindingList,
  getEffectiveBindings,
  getKeybindingDefinition,
  readPersistedKeybindingOverrides,
  resolveKeybindingPlatform,
  type KeybindingPlatform,
} from "../../../../shared/keybindings";

export type MenuShortcutPlatform = "darwin" | "other";

export function resolveMenuShortcutPlatform(userAgent: string): MenuShortcutPlatform {
  return userAgent.includes("Mac") ? "darwin" : "other";
}

function toKeybindingPlatform(platform: MenuShortcutPlatform): KeybindingPlatform {
  return resolveKeybindingPlatform(platform);
}

/**
 * Display label for one action's first effective binding ("" when
 * unbound). Overrides win over table defaults, like the source's
 * useShortcutLabel.
 */
export function menuShortcutLabel(
  id: string,
  platform: MenuShortcutPlatform,
  overrides?: Parameters<typeof getEffectiveBindings>[2],
): string {
  const definition = getKeybindingDefinition(id);
  if (!definition) return "";
  const resolved = toKeybindingPlatform(platform);
  const effective = overrides ?? readPersistedKeybindingOverrides();
  const bindings = getEffectiveBindings(definition, resolved, effective);
  if (bindings.length === 0) return "";
  return formatKeybindingList([bindings[0]], resolved);
}
