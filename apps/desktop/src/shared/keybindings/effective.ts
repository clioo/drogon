// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/shared/keybindings/effective.ts (getEffectiveKeybindingsForAction,
//   getDefaultBindings)
// Adapted: this repo has no keybinding overrides store yet, so the override
// branch is absent; the platform parameter is this repo's KeybindingPlatform
// instead of NodeJS.Platform. This is the single lookup the native menu's
// chord hints and the renderer shortcuts share.

import {
  bindingsForPlatform,
  KEYBINDING_DEFINITIONS,
  type KeybindingDefinition,
  type KeybindingPlatform,
} from "./definitions";

export function getDefaultBindings(
  definition: KeybindingDefinition,
  platform: KeybindingPlatform,
): string[] {
  return [...bindingsForPlatform(definition, platform)];
}

/** Effective chords for one action id on a platform (defaults only today). */
export function getEffectiveKeybindingsForAction(
  actionId: string,
  platform: KeybindingPlatform,
): string[] {
  const definition = KEYBINDING_DEFINITIONS.find(
    (entry) => entry.id === actionId,
  );
  return definition ? getDefaultBindings(definition, platform) : [];
}
