/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-agents-expansion-state.ts
   (verbatim structure: an LRU-bounded, session-scoped module map keyed by
   worktree id so a card remount — project collapse, sidebar rebuild — never
   resets the user's disclosure choices; `collapsedLineageParents` for the
   agent-lineage chevrons and `compactRootListExpanded` for the "N agents"
   compact summary panel. This repo's WorktreeCard previously held the
   lineage half in its own bare module map plus a local re-render bump;
   this port replaces both with the source's shape.) */
import { useCallback, useState } from "react";

export type WorktreeAgentExpansionState = {
  collapsedLineageParents: ReadonlySet<string>;
  compactRootListExpanded: boolean;
};

const EMPTY_COLLAPSED_PARENTS: ReadonlySet<string> = new Set();

const DEFAULT_EXPANSION_STATE: WorktreeAgentExpansionState = {
  collapsedLineageParents: EMPTY_COLLAPSED_PARENTS,
  compactRootListExpanded: false,
};

// Why: the inline agent list's expand/collapse must outlive the WorktreeCard
// remount that fires when the sidebar rebuilds (project collapse, options
// change). Holding this in plain local useState reset it on every such
// remount, so folding one section visibly re-expanded the other.
// Renderer-only and LRU-bounded: the compact panel resets on reload (it
// tracks the ephemeral live-agent list), while the lineage fold persists
// (see below); neither ever grows without bound.
export const MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS = 512;
const expansionByWorktreeId = new Map<string, WorktreeAgentExpansionState>();

/**
 * Persisted lineage folds (issue #622): the fold survives a renderer reload
 * and a workspace switch at every depth, following
 * sidebar-collapsed-projects.ts (a `drogon:shell:` localStorage key,
 * try/catch on every read and write, a shape check that drops anything that
 * is not a string id). Bounded worktrees, bounded ids per worktree; the
 * in-memory LRU above still covers the remount case.
 */
export const MAX_PERSISTED_LINEAGE_WORKTREES = 128;
export const MAX_COLLAPSED_LINEAGE_IDS_PER_WORKTREE = 256;
const LINEAGE_COLLAPSE_STORAGE_KEY = "drogon:shell:collapsed-lineage-parents";

type LineageCollapseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function trimPersistedExpansions(): void {
  while (expansionByWorktreeId.size > MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS) {
    const oldest = expansionByWorktreeId.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    expansionByWorktreeId.delete(oldest);
  }
}

/**
 * Sanitized read of the persisted lineage folds: a plain object of
 * worktree id to string-id arrays. Anything else (corrupt JSON, wrong
 * shape, non-string ids) degrades to "nothing collapsed" instead of
 * throwing — collapse state is cosmetic.
 */
export function loadPersistedLineageCollapse(
  storage: Pick<Storage, "getItem">,
): Map<string, string[]> {
  const folds = new Map<string, string[]>();
  let raw: string | null = null;
  try {
    raw = storage.getItem(LINEAGE_COLLAPSE_STORAGE_KEY);
  } catch {
    return folds;
  }
  if (!raw) return folds;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return folds;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return folds;
  }
  for (const [worktreeId, ids] of Object.entries(parsed)) {
    if (typeof worktreeId !== "string" || worktreeId === "") continue;
    if (!Array.isArray(ids)) continue;
    const clean = [
      ...new Set(
        ids.filter(
          (id): id is string => typeof id === "string" && id !== "",
        ),
      ),
    ].slice(0, MAX_COLLAPSED_LINEAGE_IDS_PER_WORKTREE);
    if (clean.length === 0) continue;
    if (folds.size >= MAX_PERSISTED_LINEAGE_WORKTREES) break;
    folds.set(worktreeId, clean);
  }
  return folds;
}

/** Bounded write of the persisted lineage folds; a failed write just means
 *  the fold resets on reload (same cosmetic-only contract as the collapsed
 *  projects precedent). */
export function savePersistedLineageCollapse(
  storage: Pick<Storage, "setItem" | "removeItem">,
  folds: ReadonlyMap<string, readonly string[]>,
): void {
  try {
    const payload: Record<string, string[]> = {};
    let count = 0;
    for (const [worktreeId, ids] of folds) {
      if (typeof worktreeId !== "string" || worktreeId === "") continue;
      const clean = [
        ...new Set(
          ids.filter(
            (id): id is string => typeof id === "string" && id !== "",
          ),
        ),
      ].slice(0, MAX_COLLAPSED_LINEAGE_IDS_PER_WORKTREE);
      if (clean.length === 0) continue;
      if (count >= MAX_PERSISTED_LINEAGE_WORKTREES) break;
      payload[worktreeId] = clean;
      count += 1;
    }
    if (count === 0) {
      try {
        storage.removeItem(LINEAGE_COLLAPSE_STORAGE_KEY);
      } catch {
        // Already covered below: storage is best-effort.
      }
      return;
    }
    storage.setItem(LINEAGE_COLLAPSE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable (quota, privacy mode); collapse state is
    // cosmetic, so a failed write just means it resets on reload.
  }
}

function defaultStorage(): LineageCollapseStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Worktrees already hydrated from storage this renderer lifetime (even
 *  when storage held nothing), so a render never re-parses on every pass. */
const hydratedWorktreeIds = new Set<string>();

function persistLineageCollapseThrough(): void {
  const storage = defaultStorage();
  if (!storage) return;
  // The module map is LRU-ordered (recently touched last); persist the most
  // recent worktrees that actually carry a fold.
  const entries = [...expansionByWorktreeId.entries()].reverse();
  const folds = new Map<string, readonly string[]>();
  for (const [worktreeId, state] of entries) {
    if (state.collapsedLineageParents.size === 0) continue;
    folds.set(worktreeId, [...state.collapsedLineageParents]);
    if (folds.size >= MAX_PERSISTED_LINEAGE_WORKTREES) break;
  }
  savePersistedLineageCollapse(storage, folds);
}

function readExpansionState(worktreeId: string): WorktreeAgentExpansionState {
  const live = expansionByWorktreeId.get(worktreeId);
  if (live) return live;
  if (hydratedWorktreeIds.has(worktreeId)) {
    return DEFAULT_EXPANSION_STATE;
  }
  hydratedWorktreeIds.add(worktreeId);
  // Lazy hydration: the fold survives a renderer reload (empty module map)
  // and a workspace switch (a worktree id never touched this lifetime).
  // Only the lineage fold hydrates — the compact panel stays ephemeral.
  // Never pruned here: a collapsed parent whose children merely exited
  // keeps its fold; dead ids are pruned on the next toggle, not on read.
  const storage = defaultStorage();
  if (!storage) return DEFAULT_EXPANSION_STATE;
  const folds = loadPersistedLineageCollapse(storage);
  const ids = folds.get(worktreeId);
  if (!ids || ids.length === 0) return DEFAULT_EXPANSION_STATE;
  const state: WorktreeAgentExpansionState = {
    collapsedLineageParents: new Set(ids),
    compactRootListExpanded: false,
  };
  expansionByWorktreeId.set(worktreeId, state);
  trimPersistedExpansions();
  return state;
}

function persistExpansionState(
  worktreeId: string,
  state: WorktreeAgentExpansionState,
): void {
  // Re-insert to refresh LRU order; drop entries that carry no non-default
  // state so idle worktrees never occupy a slot.
  expansionByWorktreeId.delete(worktreeId);
  if (state.compactRootListExpanded || state.collapsedLineageParents.size > 0) {
    expansionByWorktreeId.set(worktreeId, state);
    trimPersistedExpansions();
  }
  persistLineageCollapseThrough();
}

export type WorktreeAgentExpansionControls = {
  collapsedLineageParents: ReadonlySet<string>;
  compactRootListExpanded: boolean;
  /**
   * Fold/unfold a single agent-lineage parent by its session id. Ids of
   * sessions that no longer exist are pruned when the caller passes the
   * live session ids — the fold itself is never dropped on read, so a
   * collapsed parent whose children merely exited stays folded.
   */
  toggleLineageParent: (
    sessionId: string,
    liveSessionIds?: readonly string[],
  ) => void;
  /** Open/close the compact multi-agent summary panel. */
  toggleCompactRootList: () => void;
};

/**
 * Remount-durable expand/collapse state for one worktree card's inline agent
 * list. Reads seed from a module-level, session-scoped cache so a card rebuild
 * no longer wipes the user's disclosure choices. Independent per worktree id.
 */
export function useWorktreeAgentExpansionState(
  worktreeId: string,
): WorktreeAgentExpansionControls {
  const [rendered, setRendered] = useState<{
    worktreeId: string;
    state: WorktreeAgentExpansionState;
  }>(() => ({ worktreeId, state: readExpansionState(worktreeId) }));

  // Why: a memoized body can be handed a new worktreeId without remounting;
  // fall back to the cache so we never show a stale card's disclosure.
  const current =
    rendered.worktreeId === worktreeId
      ? rendered.state
      : readExpansionState(worktreeId);

  const commit = useCallback(
    (next: WorktreeAgentExpansionState) => {
      persistExpansionState(worktreeId, next);
      setRendered({ worktreeId, state: next });
    },
    [worktreeId],
  );

  const toggleLineageParent = useCallback(
    (sessionId: string, liveSessionIds?: readonly string[]) => {
      const base = readExpansionState(worktreeId);
      const nextParents = new Set(base.collapsedLineageParents);
      if (liveSessionIds) {
        const live = new Set(liveSessionIds);
        for (const id of nextParents) {
          if (!live.has(id)) nextParents.delete(id);
        }
      }
      if (nextParents.has(sessionId)) {
        nextParents.delete(sessionId);
      } else {
        nextParents.add(sessionId);
      }
      commit({ ...base, collapsedLineageParents: nextParents });
    },
    [commit, worktreeId],
  );

  const toggleCompactRootList = useCallback(() => {
    const base = readExpansionState(worktreeId);
    commit({ ...base, compactRootListExpanded: !base.compactRootListExpanded });
  }, [commit, worktreeId]);

  return {
    collapsedLineageParents: current.collapsedLineageParents,
    compactRootListExpanded: current.compactRootListExpanded,
    toggleLineageParent,
    toggleCompactRootList,
  };
}

export function clearWorktreeAgentExpansionStateForTests(): void {
  expansionByWorktreeId.clear();
  hydratedWorktreeIds.clear();
  const storage = defaultStorage();
  if (storage) {
    try {
      storage.removeItem(LINEAGE_COLLAPSE_STORAGE_KEY);
    } catch {
      // Test isolation is best-effort against a hostile storage double.
    }
  }
}

/**
 * Drops only the in-memory cache (keeps persisted folds): simulates a
 * renderer reload, where the module map is empty but localStorage holds
 * the user's folds.
 */
export function resetWorktreeAgentExpansionMemoryForTests(): void {
  expansionByWorktreeId.clear();
  hydratedWorktreeIds.clear();
}

export function getWorktreeAgentExpansionCountForTests(): number {
  return expansionByWorktreeId.size;
}

export function seedWorktreeAgentExpansionStateForTests(
  worktreeId: string,
  state: WorktreeAgentExpansionState,
): void {
  persistExpansionState(worktreeId, state);
}
