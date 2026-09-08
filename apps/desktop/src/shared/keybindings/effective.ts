// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/effective.ts (getEffectiveKeybindingsForAction,
//   getDefaultBindings)
// Adapted: the platform parameter is this repo's KeybindingPlatform instead
// of NodeJS.Platform. The persisted override store is shared by renderer
// labels and dispatch; main-process menu hints remain default-only because
// main has no renderer storage to read. This is the single lookup the native
// menu's chord hints and the renderer shortcuts share.

import {
  bindingsForPlatform,
  KEYBINDING_DEFINITIONS,
  type KeybindingDefinition,
  type KeybindingPlatform,
} from "./definitions";
import {
  getEffectiveBindings,
  type KeybindingOverrides,
} from "./overrides";

export function getDefaultBindings(
  definition: KeybindingDefinition,
  platform: KeybindingPlatform,
): string[] {
  return [...bindingsForPlatform(definition, platform)];
}

/**
 * Effective chords for one action id on a platform: the persisted override
 * wins when present (J10 rebinding). The native menu keeps calling without
 * overrides — main has no renderer storage to read, so its hints stay on
 * defaults while the window dispatches the effective table.
 */
export function getEffectiveKeybindingsForAction(
  actionId: string,
  platform: KeybindingPlatform,
  overrides?: KeybindingOverrides | null,
): string[] {
  const definition = KEYBINDING_DEFINITIONS.find(
    (entry) => entry.id === actionId,
  );
  return definition ? getEffectiveBindings(definition, platform, overrides) : [];
}
