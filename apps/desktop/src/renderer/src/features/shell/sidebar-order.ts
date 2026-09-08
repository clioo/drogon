/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drop.ts
   (mapSidebarRepoDropIndexToAllRepoInsertAt, applyAllRepoInsertAt) and
   src/renderer/src/components/tab-bar/reconcile-order.ts (stored-order
   reconciliation). Adapter: Drogon has one flat project list (no paired
   hosts, no project groups), so the duplicate-occurrence block collapses
   to a single id and the group-order rank branch is absent; persistence
   is the `drogon:shell:` localStorage keys below, like sidebar-width.ts
   and tab-order.ts, instead of the fork's UI store. */

import type { ProjectGroup } from "./project-adapter";
import type { Worktree } from "../../../../shared/session-contract";

/** Stored project order (project ids, deduped at read). */
export const SIDEBAR_PROJECT_ORDER_STORAGE_KEY =
  "drogon:shell:sidebar-project-order";
/** Stored per-project worktree order (project id -> worktree ids). */
export const SIDEBAR_WORKTREE_ORDER_STORAGE_KEY =
  "drogon:shell:sidebar-worktree-order";

const MAX_IDS = 512;
const MAX_ID_LENGTH = 512;

/**
 * Reconcile a stored order with the ids that exist now: keep stored ids
 * that still exist in their stored positions, append new ids at the end
 * in natural order. Dedupes at the boundary so a stale double-write can
 * never produce duplicate React keys.
 */
export function reconcileSidebarOrder(
  storedOrder: readonly string[] | undefined,
  presentIds: readonly string[],
): string[] {
  const valid = new Set(presentIds);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of storedOrder ?? []) {
    if (valid.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of presentIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/**
 * Order project groups by the stored project order. Unknown ids fall to
 * the end in natural order; stored ids for removed projects are dropped.
 */
export function orderProjectGroups(
  groups: ProjectGroup[],
  storedOrder: readonly string[] | undefined,
): ProjectGroup[] {
  const rank = new Map<string, number>();
  (storedOrder ?? []).forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.group.project.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.group.project.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((entry) => entry.group);
}

/** Order one project's worktrees by its stored worktree order. */
export function orderWorktreesInGroup(
  worktrees: Worktree[],
  storedOrder: readonly string[] | undefined,
): Worktree[] {
  const rank = new Map<string, number>();
  (storedOrder ?? []).forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return worktrees
    .map((worktree, index) => ({ worktree, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.worktree.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.worktree.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((entry) => entry.worktree);
}

/**
 * Apply the stored project + per-project worktree orders to freshly
 * loaded groups. Pure so the list stays a thin view.
 */
export function applyStoredSidebarOrder(
  groups: ProjectGroup[],
  storedProjectOrder: readonly string[] | undefined,
  storedWorktreeOrder: Readonly<Record<string, readonly string[]>> | undefined,
): ProjectGroup[] {
  return orderProjectGroups(groups, storedProjectOrder).map((group) => ({
    ...group,
    worktrees: orderWorktreesInGroup(
      group.worktrees,
      storedWorktreeOrder?.[group.project.id],
    ),
  }));
}

export function orderedProjectIds(groups: ProjectGroup[]): string[] {
  return groups.map((group) => group.project.id);
}

/**
 * Map a drop index from the visible (possibly filtered) header list to
 * an insertion index in the full order. Ports
 * mapSidebarRepoDropIndexToAllRepoInsertAt: edge slots anchor to the
 * first/last visible header's position in the full order.
 */
export function mapVisibleDropIndexToInsertAt(
  visibleDropIndex: number,
  visibleIds: readonly string[],
  allIds: readonly string[],
): number {
  if (visibleIds.length === 0) return 0;
  if (visibleDropIndex <= 0) return allIds.indexOf(visibleIds[0]!);
  if (visibleDropIndex >= visibleIds.length) {
    return allIds.indexOf(visibleIds.at(-1)!) + 1;
  }
  return allIds.indexOf(visibleIds[visibleDropIndex]!);
}

/**
 * Move one id to an insertion index in the full order. Returns null
 * when the move is invalid or a visual no-op. Ports applyAllRepoInsertAt
 * for a single occurrence (no paired-host block in this repo).
 */
export function applyOrderInsertAt(
  allIds: readonly string[],
  draggedId: string,
  insertAt: number,
): string[] | null {
  if (!allIds.includes(draggedId) || insertAt < 0 || insertAt > allIds.length) {
    return null;
  }
  const removedBeforeInsert = allIds
    .slice(0, insertAt)
    .filter((id) => id === draggedId).length;
  const adjustedInsertAt = insertAt - removedBeforeInsert;
  const next = allIds.filter((id) => id !== draggedId);
  next.splice(adjustedInsertAt, 0, draggedId);
  if (next.every((id, index) => id === allIds[index])) return null;
  return next;
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ID_LENGTH)
      continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

function parseOrderEnvelope(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return [];
    return sanitizeIdList((parsed as { state?: unknown }).state);
  } catch {
    return [];
  }
}

function parseWorktreeOrderEnvelope(
  raw: string | null | undefined,
): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const state = (parsed as { state?: unknown }).state;
    if (typeof state !== "object" || state === null || Array.isArray(state))
      return {};
    const out: Record<string, string[]> = {};
    let count = 0;
    for (const [key, value] of Object.entries(
      state as Record<string, unknown>,
    )) {
      if (key.length === 0 || key.length > MAX_ID_LENGTH) continue;
      const ids = sanitizeIdList(value);
      if (ids.length === 0) continue;
      out[key] = ids;
      count += 1;
      if (count >= MAX_IDS) break;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadSidebarProjectOrder(
  storage: Pick<Storage, "getItem">,
): string[] {
  try {
    return parseOrderEnvelope(storage.getItem(SIDEBAR_PROJECT_ORDER_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveSidebarProjectOrder(
  storage: Pick<Storage, "setItem">,
  order: readonly string[],
): void {
  try {
    storage.setItem(
      SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
      JSON.stringify({ state: [...order].slice(0, MAX_IDS) }),
    );
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

export function loadSidebarWorktreeOrder(
  storage: Pick<Storage, "getItem">,
): Record<string, string[]> {
  try {
    return parseWorktreeOrderEnvelope(
      storage.getItem(SIDEBAR_WORKTREE_ORDER_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

export function saveSidebarWorktreeOrder(
  storage: Pick<Storage, "setItem">,
  order: Readonly<Record<string, readonly string[]>>,
): void {
  try {
    const state: Record<string, string[]> = {};
    for (const [key, ids] of Object.entries(order)) {
      if (key.length === 0 || key.length > MAX_ID_LENGTH) continue;
      state[key] = sanitizeIdList(ids);
    }
    storage.setItem(
      SIDEBAR_WORKTREE_ORDER_STORAGE_KEY,
      JSON.stringify({ state }),
    );
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}
