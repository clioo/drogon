// MIT Copyright (c) 2026 Lovecast Inc.
// Pure edits for the Shortcuts section's per-action override map and for one
// action's binding list. Side-effect-free so they stay unit-testable; the
// section persists the result through the shared keybinding-overrides
// envelope.
//
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/keybinding-override-edits.ts
//     (sameBindings, hasOwnBindingOverride, removeBindingOverride)
//   src/renderer/src/components/settings/shortcut-binding-list-mutations.ts
//     (appendBinding, replaceBindingAt, removeBindingAt,
//      adjustRecordingIndexAfterRemove)
// Adapted: plain action-id strings (no KeybindingActionId branded type) and
// no platform/common snapshot split — this repo keeps one override map.
import type { KeybindingOverrides } from "../../../../shared/keybindings/overrides";

export function sameBindings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((binding, index) => binding === b[index]);
}

export function hasOwnBindingOverride(
  overrides: KeybindingOverrides,
  actionId: string,
): boolean {
  return Object.hasOwn(overrides, actionId);
}

export function removeBindingOverride(
  overrides: KeybindingOverrides,
  actionId: string,
): KeybindingOverrides {
  const next = { ...overrides };
  delete next[actionId];
  return next;
}

export function appendBinding(list: readonly string[], binding: string): string[] {
  return [...list, binding];
}

export function replaceBindingAt(
  list: readonly string[],
  index: number,
  binding: string,
): string[] {
  if (index < 0 || index >= list.length) {
    return [...list];
  }
  return list.map((existing, current) => (current === index ? binding : existing));
}

export function removeBindingAt(list: readonly string[], index: number): string[] {
  if (index < 0 || index >= list.length) {
    return [...list];
  }
  return list.filter((_, current) => current !== index);
}

// Keeps a pending recording aimed at the right binding after a sibling is
// removed: the recorded row is gone (→ null), rows below it shift up by one,
// rows above are untouched.
export function adjustRecordingIndexAfterRemove(
  current: number | null,
  removedIndex: number,
): number | null {
  if (current === null) {
    return null;
  }
  if (current === removedIndex) {
    return null;
  }
  return current > removedIndex ? current - 1 : current;
}
