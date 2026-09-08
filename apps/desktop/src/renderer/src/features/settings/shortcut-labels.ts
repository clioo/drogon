// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutRowsList.tsx
//     (group headers with rows underneath, empty-filter state)
//   src/shared/keybindings/formatting.ts (platform-correct labels)
// Adapted: chords/titles/groups from the keybinding core table with the
// persisted override map applied; disabled rows keep their reason visible.
import {
  KEYBINDING_DEFINITIONS,
  resolveKeybindingPlatform,
  type KeybindingDefinition,
} from "../../../../shared/keybindings/definitions";
import { formatKeybinding } from "../../../../shared/keybindings/labels";
import type { KeybindingPlatform } from "../../../../shared/keybindings/definitions";
import {
  getEffectiveBindings,
  readPersistedKeybindingOverrides,
  type KeybindingOverrides,
} from "../../../../shared/keybindings/overrides";

export type ShortcutGroup = string;

export type ShortcutListEntry = {
  id: string;
  title: string;
  group: ShortcutGroup;
  definition: KeybindingDefinition;
  /** Platform-resolved stored chords for this entry. */
  bindings: readonly string[];
};

export type ShortcutPlatform = "darwin" | "other";

export function resolveShortcutPlatform(userAgent: string): ShortcutPlatform {
  return userAgent.includes("Mac") ? "darwin" : "other";
}

function toKeybindingPlatform(platform: ShortcutPlatform): KeybindingPlatform {
  return resolveKeybindingPlatform(platform);
}

/**
 * Every shortcut the Shortcuts section lists, in source table order.
 * Bindings are the effective table: persisted rebinds win when present.
 */
export function buildShortcutList(
  platform: ShortcutPlatform = "other",
  overrides?: KeybindingOverrides,
): ShortcutListEntry[] {
  const resolved = toKeybindingPlatform(platform);
  const effective = overrides ?? readPersistedKeybindingOverrides();
  return KEYBINDING_DEFINITIONS.map((definition) => ({
    id: definition.id,
    title: definition.title,
    group: definition.group,
    definition,
    bindings: getEffectiveBindings(definition, resolved, effective),
  }));
}

/**
 * Splits a stored chord ("Mod+Shift+N") into display labels: symbols on
 * macOS (⌘⇧⌥, no separator), words elsewhere (Ctrl+Shift+N). The legacy
 * `CmdOrCtrl` spelling renders identically.
 */
export function formatChordForPlatform(
  chord: string,
  platform: ShortcutPlatform,
): string[] {
  return formatKeybinding(chord, toKeybindingPlatform(platform));
}

/** Display label for one stored binding of an entry. */
export function formatEntryBinding(
  binding: string,
  platform: ShortcutPlatform,
): string[] {
  return formatChordForPlatform(binding, platform);
}

/** Single-key display label (legacy helper kept for the section tests). */
export function displayKey(key: string): string {
  const labels = formatKeybinding(`Mod+${key}`, "linux");
  const last = labels[labels.length - 1];
  if (last !== undefined && last !== "Mod" && last !== "Ctrl") return last;
  const trimmed = key.trim();
  if (trimmed === "") return key;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Case-insensitive substring match over title, id, group and raw chords. */
export function filterShortcuts(
  entries: ShortcutListEntry[],
  query: string,
): ShortcutListEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(needle) ||
      entry.id.toLowerCase().includes(needle) ||
      entry.group.toLowerCase().includes(needle) ||
      entry.bindings.some((binding) =>
        binding.toLowerCase().includes(needle),
      ),
  );
}
