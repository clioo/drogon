// MIT Copyright (c) 2026 Lovecast Inc.
// Editable keyboard shortcuts (journey J10): every implemented action shows
// its effective chords as recorder buttons — activate one and press the new
// chord, Escape cancels. Rebinds persist in the shared keybinding-overrides
// envelope and the window dispatcher honors them immediately (the registry
// reads the envelope live); Reset drops the override back to the default.
// Disable keeps the chord reversible without re-recording (#244): it
// persists an explicit empty override and remembers the previous chords so
// Enable restores them in one click.
//
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutRowsList.tsx
//     (group headers with rows underneath, empty-filter state)
//   src/renderer/src/components/settings/ShortcutCommandBlock.tsx
//     (command-row shape: title + Modified/Disabled badges, the hover-reveal
//      control cluster — Add another / Reset / Disable / Remove — the inline
//      first-binding recorder, the Enable / Add-shortcut affordance for
//      unassigned rows, helper priority: error, live recording hint,
//      conflict warning)
//   src/renderer/src/components/settings/ShortcutBindingSubRow.tsx
//     (second-and-later bindings as hover-reveal sub-rows)
//   src/renderer/src/components/settings/ShortcutsPane.tsx
//     (disable memory for Enable, save flow: a rebind matching the default
//      drops the override; a chord claimed by another action blocks the save
//      with "{chord} conflicts with {labels}.")
//   src/renderer/src/components/settings/ShortcutFilterRail.tsx
//     + shortcut-row-visibility.ts (#245: the status rail and counts, in
//      shortcut-status-rail.tsx)
//   src/renderer/src/components/settings/ShortcutRecorderButton.tsx
//     (Enter/Space starts recording on the focused button, Escape cancels,
//      lone modifiers never capture on their own)
// Adapted: plain props and local state (no zustand store, no i18n, title
// attributes instead of tooltips), no modifier double-tap (this repo has no
// detector), no digit-range cap (the representative chord renders as
// stored), no plugin rows / keybindings file / terminal policy control
// (outside the MVP table), one override map instead of the fork's
// keybindings file + IPC. Rows whose status is not implemented stay
// read-only with their reason visible.
import { useMemo, useState } from "react";
import { Ban, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
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
import {
  matchesShortcutFilter,
  matchesShortcutLocalSearch,
  normalizeShortcutLocalSearchQuery,
  ShortcutFilterRail,
  type ShortcutFilter,
  type ShortcutRowModel,
} from "./shortcut-status-rail";
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
  const [filter, setFilter] = useState<ShortcutFilter>("all");
  const [overrides, setOverrides] = useState<KeybindingOverrides>(() =>
    readPersistedKeybindingOverrides(),
  );
  const [recording, setRecording] = useState<RecordingSlot>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Preserve disabled bindings so Enable can restore them (ShortcutsPane).
  const [disableMemory, setDisableMemory] = useState<
    Record<string, string[]>
  >({});
  const platform = resolveShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  const kbPlatform: KeybindingPlatform =
    platform === "darwin" ? "darwin" : "linux";
  const entries = useMemo(
    () => buildShortcutList(platform, overrides),
    [platform, overrides],
  );

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
          .map(
            (other) =>
              getKeybindingDefinition(other)?.title ?? other,
          );
        map.set(
          id,
          `${bindingLabel(binding, platform)} conflicts with ${others.join(", ")}.`,
        );
      }
    }
    return map;
  }, [kbPlatform, overrides, platform]);

  // Row models + counts: the filter numbers are computed over the
  // search-matched base (shortcut-row-visibility.ts) so they stay stable
  // while a status filter hides rows.
  const rows: ShortcutRowModel[] = useMemo(
    () =>
      entries.map((entry: ShortcutListEntry) => {
        const warning = conflictByAction.get(entry.id);
        return {
          ...entry,
          groupTitle: entry.group,
          modified: hasOwnBindingOverride(overrides, entry.id),
          warnings: warning ? [warning] : [],
        };
      }),
    [conflictByAction, entries, overrides],
  );
  const normalizedQuery = normalizeShortcutLocalSearchQuery(query) ?? "";
  const searchMatched = useMemo(
    () =>
      rows.filter((row) =>
        matchesShortcutLocalSearch(row, normalizedQuery, platform),
      ),
    [normalizedQuery, platform, rows],
  );
  const filterCounts: Record<ShortcutFilter, number> = useMemo(
    () => ({
      all: searchMatched.length,
      modified: searchMatched.filter((row) => row.modified).length,
      unassigned: searchMatched.filter((row) => row.bindings.length === 0)
        .length,
      conflicts: searchMatched.filter((row) => row.warnings.length > 0).length,
    }),
    [searchMatched],
  );
  const visible = useMemo(
    () => searchMatched.filter((row) => matchesShortcutFilter(row, filter)),
    [filter, searchMatched],
  );

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

  // Disable keeps the chord reversible: remember the current bindings first
  // so Enable can restore them, then persist the explicit empty override.
  const disableAction = (actionId: string): void => {
    clearError(actionId);
    setDisableMemory((memory) => ({
      ...memory,
      [actionId]: effectiveFor(actionId),
    }));
    setRecording((current) =>
      current && current.actionId === actionId ? null : current,
    );
    saveBindings(actionId, []);
  };

  const enableAction = (actionId: string): void => {
    const remembered = disableMemory[actionId];
    if (remembered && remembered.length > 0) {
      saveBindings(actionId, remembered);
    }
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

  /** The fork's recorder button for one stored chord of a row. */
  const recorderButton = (
    row: ShortcutRowModel,
    binding: string,
    chordIndex: number,
  ): React.JSX.Element => (
    <button
      type="button"
      className="settings-kbd inline-flex cursor-pointer items-center gap-1"
      aria-label={
        recording !== null &&
        recording.actionId === row.id &&
        recording.index === chordIndex
          ? `Recording a new shortcut for ${row.title}. Press Escape to cancel.`
          : `Change shortcut for ${row.title}, currently ${bindingLabel(binding, platform)}.`
      }
      onClick={() => {
        clearError(row.id);
        setRecording({ actionId: row.id, index: chordIndex });
      }}
      onKeyDown={(event) => onRecorderKeyDown(event, row.id, chordIndex)}
    >
      {recording !== null &&
      recording.actionId === row.id &&
      recording.index === chordIndex ? (
        <span aria-hidden="true">…</span>
      ) : (
        formatEntryBinding(binding, platform).map((key, index) => (
          <span key={index} aria-hidden="true">
            {key}
          </span>
        ))
      )}
    </button>
  );

  /** Remove control for one chord (ShortcutRemoveButton copy). */
  const removeButton = (
    row: ShortcutRowModel,
    chordIndex: number,
  ): React.JSX.Element => (
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
  );

  /** Second-and-later binding row (ShortcutBindingSubRow.tsx). */
  const bindingSubRow = (
    row: ShortcutRowModel,
    binding: string,
    chordIndex: number,
  ): React.JSX.Element => (
    <div
      key={chordIndex}
      className="group/binding flex min-h-8 items-center gap-1 rounded-md py-0.5 pr-2 pl-5 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1" />
      {/* Remove reveals on hover/focus to keep the row calm; keyboard users
          reach it via focus-within. */}
      <div className="can-hover:opacity-0 shrink-0 transition-opacity group-hover/binding:opacity-100 group-focus-within/binding:opacity-100">
        {removeButton(row, chordIndex)}
      </div>
      <div className="shrink-0">{recorderButton(row, binding, chordIndex)}</div>
    </div>
  );

  const renderRow = (row: ShortcutRowModel): React.JSX.Element => {
    if (row.definition.status.kind !== "implemented") {
      // Non-implemented rows stay read-only with their reason visible.
      return (
        <li key={row.id} className="settings-shortcut-row">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="settings-shortcut-title">{row.title}</span>
            <span className="settings-note">
              {row.definition.status.kind === "disabled"
                ? `Unavailable: ${row.definition.status.reason}`
                : row.definition.status.note}
            </span>
          </span>
          <span
            className="settings-shortcut-keys"
            aria-label={formatKeybindingList(row.bindings, kbPlatform)}
          >
            {row.bindings.length === 0 ? (
              <span className="settings-unavailable">Unassigned</span>
            ) : (
              row.bindings.map((binding, chordIndex) => (
                <span key={`${binding} ${chordIndex}`} className="inline-flex items-center gap-1">
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
        </li>
      );
    }

    // The fork's ShortcutCommandBlock: one command row, helper line, then
    // sub-rows for bindings beyond the first plus the transient append slot.
    const bindings = row.bindings;
    const hasBinding = bindings.length > 0;
    const isMulti = bindings.length >= 2;
    // An explicit empty override means the user turned the action off.
    const isDisabled = row.modified && !hasBinding;
    const recordingThis =
      recording !== null && recording.actionId === row.id
        ? recording
        : null;
    const showAppendSlot =
      recordingThis !== null && recordingThis.index >= bindings.length;
    const canEnable =
      isDisabled && (disableMemory[row.id]?.length ?? 0) > 0;
    const error = errors[row.id];
    // Helper priority (the fork's): error, live recording hint, conflict.
    const helper = error
      ? { text: error, tone: "error" as const }
      : recordingThis !== null
        ? { text: "Press a shortcut. Esc cancels.", tone: "muted" as const }
        : row.warnings.length > 0
          ? { text: row.warnings.join(" "), tone: "error" as const }
          : null;
    const previousBindings = disableMemory[row.id] ?? [];
    return (
      <li key={row.id}>
        <div className="group/shortcut flex max-w-none flex-col">
          <div className="flex min-h-9 items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  "truncate text-sm",
                  isDisabled ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {row.title}
              </span>
              {row.modified ? (
                <Badge variant="outline" className="shrink-0 text-[11px]">
                  Modified
                </Badge>
              ) : null}
              {isDisabled ? (
                <Badge
                  variant="outline"
                  className="shrink-0 text-[11px] text-muted-foreground"
                >
                  Disabled
                </Badge>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* Action controls reveal on hover/focus to keep the list calm.
                  Reset is gated on `modified` (not on having a binding) so
                  it's reachable even when the action is disabled. */}
              <div className="can-hover:opacity-0 flex items-center gap-0.5 transition-opacity group-hover/shortcut:opacity-100 group-focus-within/shortcut:opacity-100">
                {hasBinding && !showAppendSlot ? (
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
                        index: bindings.length,
                      });
                    }}
                  >
                    <Plus className="size-3" />
                  </Button>
                ) : null}
                {row.modified ? (
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
                {hasBinding ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    title="Disable shortcut"
                    aria-label={`Disable ${row.title}`}
                    onClick={() => disableAction(row.id)}
                  >
                    <Ban className="size-3" />
                  </Button>
                ) : null}
                {/* Remove just the first binding (only meaningful when others
                    remain; a single binding is turned off with Disable). */}
                {isMulti ? removeButton(row, 0) : null}
              </div>

              {/* No binding: the primary affordance stays visible (the row
                  would otherwise read as empty). Enable restores the
                  pre-disable chord; otherwise Add records a fresh one. */}
              {!hasBinding && !showAppendSlot ? (
                canEnable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Enable ${row.title}`}
                    onClick={() => enableAction(row.id)}
                  >
                    Enable
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    title="Add shortcut"
                    aria-label={`Add shortcut for ${row.title}`}
                    onClick={() => {
                      clearError(row.id);
                      setRecording({
                        actionId: row.id,
                        index: bindings.length,
                      });
                    }}
                  >
                    <Plus className="size-3" />
                  </Button>
                )
              ) : null}

              {/* The first binding lives inline on the command row; extras
                  stack below. A single-binding action is therefore one line. */}
              {hasBinding ? (
                <span className="settings-shortcut-keys">
                  {recorderButton(row, bindings[0]!, 0)}
                </span>
              ) : null}
            </div>
          </div>

          {helper ? (
            <span
              role={helper.tone === "error" ? "alert" : "status"}
              className={cn(
                "block px-2 text-[11px] leading-4",
                helper.tone === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {helper.text}
            </span>
          ) : null}

          {/* Bindings beyond the first stack as their own rows under the
              command. */}
          {isMulti
            ? bindings
                .slice(1)
                .map((binding, offset) =>
                  bindingSubRow(row, binding!, offset + 1),
                )
            : null}

          {/* The transient "add a new binding" slot: the capture target sits
              in its own row so the recorder stays aligned across rows
              (ShortcutBindingSubRow isAppendSlot: the spacer reserves the
              remove column). */}
          {showAppendSlot ? (
            <div className="group/binding flex min-h-8 items-center gap-1 rounded-md py-0.5 pr-2 pl-5 transition-colors hover:bg-accent/30">
              <div className="min-w-0 flex-1" />
              <span className="size-6 shrink-0" aria-hidden="true" />
              <div className="shrink-0">
                <button
                  type="button"
                  className="settings-kbd cursor-pointer"
                  aria-label={`Recording another shortcut for ${row.title}. Press Escape to cancel.`}
                  onClick={() => setRecording(null)}
                  onKeyDown={(event) =>
                    onRecorderKeyDown(event, row.id, bindings.length)
                  }
                >
                  <span aria-hidden="true">…</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <SettingsSection
      id="shortcuts"
      title="Keyboard Shortcuts"
      description="What each shortcut does in this window. Activate a shortcut to record a new chord; changes apply immediately."
    >
      {/* Below xl the rail stacks above the list in one column; pin the rail
          row to its content (auto) and let the list row take the rest, so
          the rail can't spill over the list (ShortcutsPane.tsx). */}
      <div className="grid min-h-0 flex-1 gap-6 max-xl:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
        <ShortcutFilterRail
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          filterCounts={filterCounts}
          visibleCount={visible.length}
          totalCount={rows.length}
        />
        {groups.length === 0 ? (
          <div
            role="status"
            className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground"
          >
            No shortcuts match those filters.
          </div>
        ) : (
          <div className="settings-shortcut-groups min-w-0 overflow-x-hidden">
            {groups.map(({ group, rows: groupRows }) => (
              <div key={group}>
                <h3 className="settings-shortcut-group-title">{group}</h3>
                <ul className="settings-shortcut-list flex flex-col gap-3">
                  {groupRows.map(renderRow)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
