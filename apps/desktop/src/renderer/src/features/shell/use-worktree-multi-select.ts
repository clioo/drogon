/* MIT Copyright (c) 2026 Lovecast Inc.
   The sidebar's one multi-selection authority: it holds which worktree
   cards are selected, turns a modified click into the next selection
   (worktree-multi-select.ts's pure rules), and builds the per-card bulk
   menu binding plus the bulk commits (pin, status, delete).

   Every bulk commit reuses the same single-card paths the one-card menu
   uses — `worktree.update` for pin/status, the parent's per-worktree
   delete submit for removal — so a bulk action cannot reach behaviour the
   single action does not already have. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Project,
  Worktree,
} from "../../../../shared/session-contract";
import {
  applyWorktreeSelectionClick,
  EMPTY_WORKTREE_SELECTION,
  isWorktreeSelectionGesture,
  pruneWorktreeSelection,
  selectionForContextMenu,
  worktreeSelectionModifiers,
  type WorktreeSelectionState,
} from "./worktree-multi-select";
import {
  bulkPinIntent,
  deletableTargets,
  type BulkWorktreeTarget,
  type WorktreeBulkMenuTarget,
} from "./worktree-bulk-actions";

/** What each rendered card needs to take part in a multi-selection. */
export type WorktreeMultiSelectBinding = {
  /** Currently selected worktree ids. */
  readonly selectedIds: ReadonlySet<string>;
  /** A selection is live, so cards show their selected/unselected state. */
  readonly active: boolean;
  /**
   * Handles a primary click on a card. Returns true when the click was a
   * selection gesture (Cmd/Ctrl or Shift) and the card must NOT open its
   * workspace; false for a plain click, which also clears the selection.
   */
  readonly onCardClick: (
    worktreeId: string,
    event: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
    },
  ) => boolean;
  /** Settles the selection before a card's context menu opens. */
  readonly onCardContextMenu: (worktreeId: string) => void;
  /** The bulk menu for this card, or null for the single-card menu. */
  readonly bulkFor: (worktreeId: string) => WorktreeBulkMenuTarget | null;
};

export type WorktreeMultiSelect = {
  readonly binding: WorktreeMultiSelectBinding;
  readonly selectedIds: readonly string[];
  /** Non-null while the bulk delete confirm is open. */
  readonly bulkDeleteTargets: readonly BulkWorktreeTarget[] | null;
  readonly closeBulkDelete: () => void;
  /** Drops the ids a completed bulk delete really removed. */
  readonly onBulkDeleted: (deletedIds: readonly string[]) => void;
  readonly clearSelection: () => void;
};

export function useWorktreeMultiSelect({
  entries,
  order,
  displayName,
  enabled,
  updateWorktree,
}: {
  /** Every known worktree with its real owning project. */
  entries: ReadonlyMap<string, { worktree: Worktree; project: Project }>;
  /** Rendered sidebar order — the domain Shift ranges are measured in. */
  order: readonly string[];
  displayName: (worktree: Worktree) => string;
  /** False while the worktree bridge is unavailable: no bulk mutations. */
  enabled: boolean;
  /** The single-card `worktree.update` commit, reused per selected card. */
  updateWorktree: (
    input: { worktreeId: string } & Partial<
      Pick<Worktree, "isPinned" | "workspaceStatus">
    >,
  ) => void;
}): WorktreeMultiSelect {
  const [selection, setSelection] = useState<WorktreeSelectionState>(
    EMPTY_WORKTREE_SELECTION,
  );
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<
    readonly BulkWorktreeTarget[] | null
  >(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  // Worktrees that disappear (deleted elsewhere, project removed, the
  // registry refresh) leave the selection immediately: a bulk action must
  // never carry an id the sidebar can no longer show.
  const knownIds = useMemo(() => [...entries.keys()].join("\u0000"), [entries]);
  useEffect(() => {
    setSelection((current) =>
      pruneWorktreeSelection(current, knownIds === "" ? [] : knownIds.split("\u0000")),
    );
  }, [knownIds]);

  const clearSelection = useCallback(
    () => setSelection(EMPTY_WORKTREE_SELECTION),
    [],
  );

  // Escape is the universal "never mind" for a live selection, matching the
  // sidebar's other transient modes (drag cancel, inline rename).
  useEffect(() => {
    if (selection.ids.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(EMPTY_WORKTREE_SELECTION);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection.ids.length]);

  const onCardClick = useCallback(
    (
      worktreeId: string,
      event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
    ): boolean => {
      const modifiers = worktreeSelectionModifiers(event);
      const next = applyWorktreeSelectionClick({
        selection,
        worktreeId,
        modifiers,
        order: orderRef.current,
      });
      setSelection(next);
      return isWorktreeSelectionGesture(modifiers);
    },
    [selection],
  );

  const onCardContextMenu = useCallback((worktreeId: string) => {
    setSelection((current) =>
      selectionForContextMenu({ selection: current, worktreeId }),
    );
  }, []);

  const selectedTargets = useMemo((): BulkWorktreeTarget[] => {
    const targets: BulkWorktreeTarget[] = [];
    for (const id of selection.ids) {
      const entry = entries.get(id);
      if (!entry) continue;
      targets.push({
        worktree: entry.worktree,
        name: displayName(entry.worktree),
        protectedFromDelete: isDeleteProtected(entry),
      });
    }
    return targets;
  }, [selection.ids, entries, displayName]);

  const selectedIdSet = useMemo(
    () => new Set(selection.ids),
    [selection.ids],
  );

  const bulkFor = useCallback(
    (worktreeId: string): WorktreeBulkMenuTarget | null => {
      if (selectedTargets.length < 2) return null;
      if (!selectedIdSet.has(worktreeId)) return null;
      const worktrees = selectedTargets.map((target) => target.worktree);
      const deletable = deletableTargets(selectedTargets);
      return {
        worktrees,
        deletableCount: deletable.length,
        // The bulk delete always confirms, even when the single-card
        // "Don't ask again" preference is set: that preference was given
        // for one workspace at a time, not for an irreversible sweep.
        onDelete:
          enabled && deletable.length > 0
            ? () => setBulkDeleteTargets(selectedTargets)
            : null,
        onTogglePin: enabled
          ? () => {
              const { pin } = bulkPinIntent(worktrees);
              for (const worktree of worktrees) {
                if ((worktree.isPinned ?? false) === pin) continue;
                updateWorktree({ worktreeId: worktree.id, isPinned: pin });
              }
            }
          : null,
        onMoveToStatus: enabled
          ? (statusId) => {
              for (const worktree of worktrees) {
                if ((worktree.workspaceStatus ?? null) === statusId) continue;
                updateWorktree({
                  worktreeId: worktree.id,
                  workspaceStatus: statusId,
                });
              }
            }
          : null,
        onClearSelection: clearSelection,
      };
    },
    [selectedTargets, selectedIdSet, enabled, updateWorktree, clearSelection],
  );

  const onBulkDeleted = useCallback((deletedIds: readonly string[]) => {
    const removed = new Set(deletedIds);
    setSelection((current) => {
      const ids = current.ids.filter((id) => !removed.has(id));
      return {
        ids,
        anchorId:
          current.anchorId !== null && !removed.has(current.anchorId)
            ? current.anchorId
            : (ids[ids.length - 1] ?? null),
      };
    });
  }, []);

  const binding = useMemo(
    (): WorktreeMultiSelectBinding => ({
      selectedIds: selectedIdSet,
      active: selection.ids.length > 0,
      onCardClick,
      onCardContextMenu,
      bulkFor,
    }),
    [selectedIdSet, selection.ids.length, onCardClick, onCardContextMenu, bulkFor],
  );

  return {
    binding,
    selectedIds: selection.ids,
    bulkDeleteTargets,
    closeBulkDelete: () => setBulkDeleteTargets(null),
    onBulkDeleted,
    clearSelection,
  };
}

/** Deleting this card would remove a whole project registration instead of
 *  a worktree (a folder project's implicit card, or a git project's main
 *  checkout), so bulk delete leaves it alone. */
function isDeleteProtected({
  worktree,
  project,
}: {
  worktree: Worktree;
  project: Project;
}): boolean {
  if (project.kind === "git" && worktree.path === project.path) return true;
  return (
    worktree.id === worktree.projectId ||
    worktree.id.startsWith("implicit:") ||
    worktree.projectId.startsWith("folder:")
  );
}
