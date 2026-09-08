/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/reconcile-order.ts (stored-order
   reconciliation with render-boundary dedupe),
   src/renderer/src/store/slices/tabs/tabs-tab-order.ts (pinned partition)
   and src/renderer/src/store/slices/tabs/tabs-bulk-close-actions.ts
   (bulk-close skips pinned tabs). Adapter: the strip holds terminal
   sessions, browser pages and editor (open file) tabs, so the order domain
   is those three id lists; pin/title state lives in this file's
   per-workspace envelope instead of the zustand tab slice. R16-N adds the
   split-terminal pair map (terminal-split.ts sanitize) as an additive
   envelope key. */

import {
  sanitizeTerminalSplits,
  type PersistedTerminalSplitMap,
} from "../terminal/terminal-split";

export type TabStripState = {
  /** Stored strip order (session ids and browser tab ids, deduped at read). */
  order: string[];
  /** Pinned tab ids; rendered first, never closed by bulk actions. */
  pinned: string[];
  /** Custom session titles from the rename affordance ("" / absent = default). */
  titles: Record<string, string>;
  /**
   * Split-terminal pairs per tab root (R16-N Split Terminal Right): each
   * root session id maps to its two daemon-session panes with focus and
   * sizes. Absent/empty while every tab holds one pane.
   */
  splits: PersistedTerminalSplitMap;
};

export const EMPTY_TAB_STRIP_STATE: TabStripState = {
  order: [],
  pinned: [],
  titles: {},
  splits: {},
};

/** Storage key pattern mirrors the right-sidebar keys (`drogon:<area>:<name>`); one envelope per workspace. */
export function tabStripStorageKey(workspaceId: string): string {
  return `drogon:tab-strip:${workspaceId}`;
}

/**
 * Reconcile a stored order with the tabs that exist now: keep stored ids
 * that still exist in their stored positions, append new ids at the end in
 * natural order. Dedupes at the boundary so a stale double-write can never
 * produce duplicate React keys.
 */
export function reconcileTabOrder(
  storedOrder: readonly string[] | undefined,
  sessionIds: readonly string[],
  browserIds: readonly string[] = [],
  editorIds: readonly string[] = [],
): string[] {
  const valid = new Set([...sessionIds, ...browserIds, ...editorIds]);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of storedOrder ?? []) {
    if (valid.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of [...sessionIds, ...browserIds, ...editorIds]) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/** dnd-kit arrayMove equivalent over the committed order (pure). */
export function moveTabOrder(
  order: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move one entry by a signed delta (keyboard reorder primitive). */
export function shiftTabOrder(
  order: readonly string[],
  id: string,
  delta: number,
): string[] {
  const from = order.indexOf(id);
  if (from === -1) return [...order];
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  if (to === from) return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Pinned tabs render first in stored relative order, then unpinned ones
 * (source partitionPinnedTabOrder semantics, without the in-flight mover).
 */
export function partitionPinnedOrder(
  order: readonly string[],
  pinnedIds: ReadonlySet<string> | readonly string[],
): string[] {
  const pinned = new Set(pinnedIds);
  return [
    ...order.filter((id) => pinned.has(id)),
    ...order.filter((id) => !pinned.has(id)),
  ];
}

/** Toggle pin; pinning moves the tab to the end of the pinned block. */
export function togglePinnedOrder(
  order: readonly string[],
  pinnedIds: readonly string[],
  id: string,
): { order: string[]; pinned: string[] } {
  const pinned = new Set(pinnedIds);
  if (pinned.has(id)) {
    pinned.delete(id);
    return {
      order: partitionPinnedOrder(order, pinned),
      pinned: [...pinned],
    };
  }
  pinned.add(id);
  const rest = order.filter((entry) => entry !== id);
  const pinnedBlock = rest.filter((entry) => pinned.has(entry));
  const unpinnedBlock = rest.filter((entry) => !pinned.has(entry));
  return { order: [...pinnedBlock, id, ...unpinnedBlock], pinned: [...pinned] };
}

/**
 * Bulk-close targets in strip order, never including pinned tabs (source
 * tabs-bulk-close-actions semantics for closeOthers/closeToRight/closeToLeft).
 */
export function bulkCloseTargets(
  order: readonly string[],
  pinnedIds: ReadonlySet<string> | readonly string[],
  anchorId: string,
  mode: "others" | "to-right" | "to-left",
): string[] {
  const pinned = new Set(pinnedIds);
  const at = order.indexOf(anchorId);
  if (at === -1) return [];
  const candidates =
    mode === "others"
      ? order.filter((id) => id !== anchorId)
      : mode === "to-right"
        ? order.slice(at + 1)
        : order.slice(0, at);
  return candidates.filter((id) => !pinned.has(id));
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 512)
      continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.slice(0, 512);
}

function sanitizeTitles(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const out: Record<string, string> = {};
  for (const [key, title] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (key.length === 0 || key.length > 512) continue;
    if (typeof title !== "string" || title.length === 0 || title.length > 256)
      continue;
    if (/[\0-\x1f\x7f]/.test(title)) continue;
    out[key] = title;
    if (Object.keys(out).length >= 512) break;
  }
  return out;
}

export function parseTabStripState(raw: string | null | undefined): TabStripState {
  if (!raw) return { ...EMPTY_TAB_STRIP_STATE, titles: {}, splits: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return { ...EMPTY_TAB_STRIP_STATE, titles: {}, splits: {} };
    const candidate = parsed as { state?: unknown };
    if (
      typeof candidate.state !== "object" ||
      candidate.state === null ||
      Array.isArray(candidate.state)
    )
      return { ...EMPTY_TAB_STRIP_STATE, titles: {}, splits: {} };
    const state = candidate.state as Record<string, unknown>;
    const order = sanitizeIdList(state.order);
    const pinned = sanitizeIdList(state.pinned).filter((id) =>
      order.includes(id),
    );
    // Additive R16-N key: older envelopes simply hydrate to no splits.
    const splits = sanitizeTerminalSplits(state.splits);
    return { order, pinned, titles: sanitizeTitles(state.titles), splits };
  } catch {
    return { ...EMPTY_TAB_STRIP_STATE, titles: {}, splits: {} };
  }
}

export function loadTabStripState(
  storage: Pick<Storage, "getItem">,
  workspaceId: string,
): TabStripState {
  try {
    return parseTabStripState(storage.getItem(tabStripStorageKey(workspaceId)));
  } catch {
    return { ...EMPTY_TAB_STRIP_STATE, titles: {}, splits: {} };
  }
}

export function saveTabStripState(
  storage: Pick<Storage, "setItem">,
  workspaceId: string,
  state: TabStripState,
): void {
  try {
    storage.setItem(
      tabStripStorageKey(workspaceId),
      JSON.stringify({ state }),
    );
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/** Resolve the visible label: a custom rename wins over the default title. */
export function resolveTabTitle(
  id: string,
  defaultTitle: string,
  titles: Record<string, string>,
): string {
  return titles[id] ?? defaultTitle;
}
