// MIT Copyright (c) 2026 Lovecast Inc.
// Editable keyboard shortcuts (journey J10): every implemented action shows
// its effective chords as recorder buttons — activate one and press the new
// chord, Escape cancels. Rebinds persist in the shared keybinding-overrides
// envelope and the window dispatcher honors them immediately (the registry
// reads the envelope live); Reset drops the override back to the default.
//
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutRowsList.tsx
//     (group headers with rows underneath, empty-filter state)
//   src/renderer/src/components/settings/ShortcutCommandBlock.tsx
//     (per-action Add/Reset/Remove controls with the fork's copy: "Add
//      another shortcut for …", "Reset … to default" / "Reset to default",
//      "Remove … shortcut …" / "Remove this binding"; helper priority:
//      error, then the live recording hint, then the standing conflict
//      warning)
//   src/renderer/src/components/settings/ShortcutRecorderButton.tsx
//     (Enter/Space starts recording on the focused button, Escape cancels,
//      lone modifiers never capture on their own)
//   src/renderer/src/components/settings/ShortcutsPane.tsx (save flow: a
//     rebind matching the default drops the override; a chord claimed by
//     another action blocks the save with "{chord} conflicts with {labels}.";
//     save failures surface "Failed to save shortcut.", unknown actions
//     "Shortcut is no longer available.")
// Adapted: plain props and local state (no zustand store, no i18n, title
// attributes instead of tooltips), no modifier double-tap (this repo has no
// detector), no digit-range cap (the representative chord renders as stored),
// no plugin rows / filter rail / terminal policy (outside the MVP table),
// one override map instead of the fork's keybindings file + IPC. Rows whose
// status is not implemented stay read-only with their reason visible.
import { useMemo, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import {
  bindingsForPlatform,
  getKeybindingDefinition,
  isDigitIndexDefinition,
  keybindingGroupOrder,
  type KeybindingPlatform,
} from "../../../../shared/keybindings/definitions";
import { formatKeybindingList } from "../../../../shared/keybindings/labels";
import { createKeybindingRegistry } from "../../../../shared/keybindings/registry";
import {
  isModifierOnlyKey,
  keybindingFromKeyEvent,
  readPersistedKeybindingOverrides,
  writePersistedKeybindingOverrides,
  type KeybindingOverrides,
} from "../../../../shared/keybindings/overrides";
import {
  buildShortcutList,
  filterShortcuts,
  formatEntryBinding,
  resolveShortcutPlatform,
  type ShortcutListEntry,
} from "./shortcut-labels";
import {
  appendBinding,
  hasOwnBindingOverride,
  removeBindingAt,
  removeBindingOverride,
  replaceBindingAt,
  sameBindings,
} from "./keybinding-overrides";
import { SettingsSection } from "./settings-rows";

type RecordingSlot = { actionId: string; index: number } | null;

function recordingKey(slot: RecordingSlot): string | null {
  return slot ? `${slot.actionId} ${slot.index}` : null;
}

/** Chord label for one stored binding ("Unassigned" stays the honest copy). */
function bindingLabel(binding: string, platform: "darwin" | "other"): string {
  const kbPlatform: KeybindingPlatform =
    platform === "darwin" ? "darwin" : "linux";
  return formatKeybindingList([binding], kbPlatform);
}

export function ShortcutsSection(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<KeybindingOverrides>(() =>
    readPersistedKeybindingOverrides(),
  );
  const [recording, setRecording] = useState<RecordingSlot>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const platform = resolveShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  const kbPlatform: KeybindingPlatform =
    platform === "darwin" ? "darwin" : "linux";
  const entries = useMemo(
    () => buildShortcutList(platform, overrides),
    [platform, overrides],
  );
  const visible = filterShortcuts(entries, query);

  // Standing conflict warnings over the current effective table (the default
  // table is conflict-free by construction, so only overrides can appear).
  const conflictByAction = useMemo(() => {
    const map = new Map<string, string>();
    const registry = createKeybindingRegistry();
    for (const bucket of registry.findConflicts(kbPlatform, overrides)) {
      const ids = [...new Set(bucket.map((entry) => entry.id))];
      if (ids.length < 2) continue;
      const binding =
        bucket.find((entry) => entry.id === ids[0])?.identity ?? "";
      for (const id of ids) {
        if (map.has(id)) continue;
        const others = ids
          .filter((other) => other !== id)
          .map((other) => getKeybindingDefinition(other)?.title ?? other);
        map.set(
          id,
          `${bindingLabel(binding, platform)} conflicts with ${others.join(", ")}.`,
        );
      }
    }
    return map;
  }, [kbPlatform, overrides, platform]);

  const clearError = (actionId: string) =>
    setErrors((prev) => {
      if (!(actionId in prev)) return prev;
      const next = { ...prev };
      delete next[actionId];
      return next;
    });

  const saveBindings = (actionId: string, next: string[]): boolean => {
    const definition = getKeybindingDefinition(actionId);
    if (!definition) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: "Shortcut is no longer available.",
      }));
      return false;
    }
    const defaults = [...bindingsForPlatform(definition, kbPlatform)];
    const candidate =
      sameBindings(next, defaults) ||
      (next.length === 0 && defaults.length === 0)
        ? removeBindingOverride(overrides, actionId)
        : { ...overrides, [actionId]: next };
    const blocking = createKeybindingRegistry()
      .findConflicts(kbPlatform, candidate)
      .find((bucket) => bucket.some((entry) => entry.id === actionId));
    if (blocking) {
      const ids = [...new Set(blocking.map((entry) => entry.id))];
      const binding =
        blocking.find((entry) => entry.id === actionId)?.identity ?? "";
      const labels = ids
        .filter((id) => id !== actionId)
        .map((id) => getKeybindingDefinition(id)?.title ?? id)
        .join(", ");
      setErrors((prev) => ({
        ...prev,
        [actionId]: `${bindingLabel(binding, platform)} conflicts with ${labels}.`,
      }));
      return false;
    }
    if (!writePersistedKeybindingOverrides(candidate)) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: "Failed to save shortcut.",
      }));
      return false;
    }
    setOverrides(candidate);
    clearError(actionId);
    return true;
  };

  const effectiveFor = (actionId: string): string[] =>
    entries.find((entry) => entry.id === actionId)?.bindings.slice() ?? [];

  const captureBinding = (
    actionId: string,
    bindingIndex: number,
    event: {
      key: string;
      altKey: boolean;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
    },
  ): void => {
    const captured = keybindingFromKeyEvent(
      {
        key: event.key,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      },
      kbPlatform,
    );
    if (!captured.ok) {
      setErrors((prev) => ({ ...prev, [actionId]: captured.error }));
      return;
    }
    const current = effectiveFor(actionId);
    const next =
      bindingIndex >= current.length
        ? appendBinding(current, captured.value)
        : replaceBindingAt(current, bindingIndex, captured.value);
    if (saveBindings(actionId, next)) setRecording(null);
  };

  const removeBinding = (actionId: string, index: number): void => {
    clearError(actionId);
    if (
      recording !== null &&
      recording.actionId === actionId &&
      recording.index === index
    )
      setRecording(null);
    saveBindings(actionId, removeBindingAt(effectiveFor(actionId), index));
  };

  const resetAction = (actionId: string): void => {
    clearError(actionId);
    setRecording((current) =>
      current && current.actionId === actionId ? null : current,
    );
    const candidate = removeBindingOverride(overrides, actionId);
    if (!writePersistedKeybindingOverrides(candidate)) {
      setErrors((prev) => ({
        ...prev,
        [actionId]: "Failed to save shortcut.",
      }));
      return;
    }
    setOverrides(candidate);
  };

  const onRecorderKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    actionId: string,
    bindingIndex: number,
  ): void => {
    const slot = recordingKey(recording);
    if (slot !== `${actionId} ${bindingIndex}`) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        clearError(actionId);
        setRecording({ actionId, index: bindingIndex });
      }
      return;
    }
    // While recording the chord must reach the editor, never the window
    // dispatcher (App listens on window bubble; the React root sits below
    // it, so stopping here suspends global dispatch) or the page's Escape.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      clearError(actionId);
      setRecording(null);
      return;
    }
    if (isModifierOnlyKey(event.key)) return;
    captureBinding(actionId, bindingIndex, event);
  };

  const groups = keybindingGroupOrder()
    .map((group) => ({
      group,
      rows: visible.filter((entry) => entry.group === group),
    }))
    .filter((item) => item.rows.length > 0);

  const renderRow = (row: ShortcutListEntry): React.JSX.Element => {
    const editable = row.definition.status.kind === "implemented";
    const digit = isDigitIndexDefinition(row.definition);
    const modified = hasOwnBindingOverride(overrides, row.id);
    const error = errors[row.id];
    const recordingThis = (index: number): boolean =>
      recording !== null &&
      recording.actionId === row.id &&
      recording.index === index;
    const appending =
      recording !== null &&
      recording.actionId === row.id &&
      recording.index >= row.bindings.length;
    // Helper priority (the fork's): error, live recording hint, conflict.
    const helper = error
      ? { text: error, tone: "error" as const }
      : recording !== null && recording.actionId === row.id
        ? { text: "Press a shortcut. Esc cancels.", tone: "muted" as const }
        : conflictByAction.get(row.id) !== undefined
          ? { text: conflictByAction.get(row.id)!, tone: "error" as const }
          : null;
    return (
      <li key={row.id} className="settings-shortcut-row">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="settings-shortcut-title">{row.title}</span>
          {row.definition.status.kind !== "implemented" ? (
            <span className="settings-note">
              {row.definition.status.kind === "disabled"
                ? `Unavailable: ${row.definition.status.reason}`
                : row.definition.status.note}
            </span>
          ) : null}
          {modified ? <span className="settings-note">Customized</span> : null}
          {helper ? (
            <span
              role={helper.tone === "error" ? "alert" : "status"}
              className={
                helper.tone === "error"
                  ? "text-xs text-destructive"
                  : "settings-note"
              }
            >
              {helper.text}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {editable ? (
            <>
              <span
                className="settings-shortcut-keys"
                aria-label={formatKeybindingList(row.bindings, kbPlatform)}
              >
                {row.bindings.length === 0 && !appending ? (
                  <span className="settings-unavailable">Unassigned</span>
                ) : null}
                {row.bindings.map((binding, chordIndex) => (
                  <span
                    key={`${binding} ${chordIndex}`}
                    className="inline-flex items-center gap-1"
                  >
                    <button
                      type="button"
                      className="settings-kbd inline-flex cursor-pointer items-center gap-1"
                      aria-label={
                        recordingThis(chordIndex)
                          ? `Recording a new shortcut for ${row.title}. Press Escape to cancel.`
                          : `Change shortcut for ${row.title}, currently ${bindingLabel(binding, platform)}.`
                      }
                      onClick={() => {
                        clearError(row.id);
                        setRecording({ actionId: row.id, index: chordIndex });
                      }}
                      onKeyDown={(event) =>
                        onRecorderKeyDown(event, row.id, chordIndex)
                      }
                    >
                      {recordingThis(chordIndex) ? (
                        <span aria-hidden="true">…</span>
                      ) : (
                        formatEntryBinding(binding, platform).map(
                          (key, index) => (
                            <span key={index} aria-hidden="true">
                              {key}
                            </span>
                          ),
                        )
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove this binding"
                      aria-label={`Remove ${row.title} shortcut ${chordIndex + 1}`}
                      onClick={() => removeBinding(row.id, chordIndex)}
                    >
                      <X className="size-3" />
                    </Button>
                  </span>
                ))}
                {row.bindings.length === 0 && !appending && !digit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    title="Add shortcut"
                    aria-label={`Add shortcut for ${row.title}`}
                    onClick={() => {
                      clearError(row.id);
                      setRecording({ actionId: row.id, index: 0 });
                    }}
                  >
                    <Plus className="size-3" />
                  </Button>
                ) : null}
                {appending ? (
                  <button
                    type="button"
                    className="settings-kbd cursor-pointer"
                    aria-label={`Recording another shortcut for ${row.title}. Press Escape to cancel.`}
                    onClick={() => setRecording(null)}
                    onKeyDown={(event) =>
                      onRecorderKeyDown(event, row.id, row.bindings.length)
                    }
                  >
                    <span aria-hidden="true">…</span>
                  </button>
                ) : null}
              </span>
              {!digit &&
              (row.bindings.length > 0 || appending) &&
              !appending ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  title="Add another shortcut"
                  aria-label={`Add another shortcut for ${row.title}`}
                  onClick={() => {
                    clearError(row.id);
                    setRecording({
                      actionId: row.id,
                      index: row.bindings.length,
                    });
                  }}
                >
                  <Plus className="size-3" />
                </Button>
              ) : null}
              {modified ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  title="Reset to default"
                  aria-label={`Reset ${row.title} to default`}
                  onClick={() => resetAction(row.id)}
                >
                  <RotateCcw className="size-3" />
                </Button>
              ) : null}
            </>
          ) : (
            <span
              className="settings-shortcut-keys"
              aria-label={formatKeybindingList(row.bindings, kbPlatform)}
            >
              {row.bindings.length === 0 ? (
                <span className="settings-unavailable">Unassigned</span>
              ) : (
                row.bindings.map((binding, chordIndex) => (
                  <span
                    key={binding}
                    className="inline-flex items-center gap-1"
                  >
                    {chordIndex > 0 ? <span aria-hidden="true">, </span> : null}
                    {formatEntryBinding(binding, platform).map((key, index) => (
                      <kbd key={index} className="settings-kbd">
                        {key}
                      </kbd>
                    ))}
                  </span>
                ))
              )}
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <SettingsSection
      id="shortcuts"
      title="Keyboard shortcuts"
      description="What each shortcut does in this window. Activate a shortcut to record a new chord; changes apply immediately."
    >
      <Input
        type="search"
        aria-label="Search shortcuts"
        placeholder="Search shortcuts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? (
        <div
          role="status"
          className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground"
        >
          No shortcuts match those filters.
        </div>
      ) : (
        <div className="settings-shortcut-groups">
          {groups.map(({ group, rows }) => (
            <div key={group}>
              <h3 className="settings-shortcut-group-title">{group}</h3>
              <ul className="settings-shortcut-list">{rows.map(renderRow)}</ul>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
