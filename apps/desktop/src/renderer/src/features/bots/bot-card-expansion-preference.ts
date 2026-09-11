/* MIT Copyright (c) 2026 Lovecast Inc.
 * Bot-card disclosed state, persisted the way Orca's sidebar keeps its group
 * disclosure: `collapsedGroups` lives in the persisted UI state and every
 * toggle writes it back (`window.api.ui.set({ collapsedGroups: [...] })`),
 * so an explicit expand/collapse survives a renderer reload. Sources:
 * src/renderer/src/store/slices/ui/ui-slice-preference-actions.ts
 * (`toggleCollapsedGroup`), src/shared/persisted-ui-state-types.ts
 * (`collapsedGroups: string[]`) and
 * src/renderer/src/store/slices/ui/ui-slice-hydration-actions.ts (hydration).
 * Drogon's shell keeps that class of view state in its own localStorage
 * envelope (settings-store's UI subset, tab-order.ts, sidebar-*,
 * dismissed-sessions), so the Bot cards use the same guarded, bounded
 * envelope: an explicit per-Bot override only — a Bot with no entry still
 * follows the design's default (configured cards expanded,
 * nothing-configured cards compact).
 *
 * Storage is best-effort: a corrupt, tampered or unavailable store reads as
 * "no overrides" and a failing write never blocks the toggle.
 */

export const BOT_CARD_EXPANSION_STORAGE_KEY = "drogon:bot-card-expansion";

/** Bounds unbounded growth from long-lived profiles (same shape as
 *  dismissed-sessions.ts): oldest entries drop first. */
const MAX_ENTRIES = 512;

/** Explicit per-Bot disclosure: `true` = the user opened it, `false` = the
 *  user folded it. Absent = the card's own default. */
export type BotCardExpansionOverrides = Record<string, boolean>;

type ExpansionStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ExpansionStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some jsdom/opaque-origin configurations throw on access.
    return null;
  }
}

/**
 * Reads the explicit overrides from persisted view state. Anything that is
 * not a plain object of booleans is treated as absent rather than trusted:
 * this file only decides how tall a card renders, and must never be able to
 * corrupt Bot state if the store is tampered with.
 */
export function loadBotCardExpansion(
  storage: ExpansionStorage | null = defaultStorage(),
): BotCardExpansionOverrides {
  if (!storage) return {};
  try {
    const raw = storage.getItem(BOT_CARD_EXPANSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const overrides: BotCardExpansionOverrides = {};
    for (const [botId, expanded] of Object.entries(parsed)) {
      if (typeof expanded === "boolean") overrides[botId] = expanded;
    }
    return overrides;
  } catch {
    return {};
  }
}

/**
 * Records an explicit user disclosure only — never call this for a Bot that
 * merely changed state, so a Bot the user never touched keeps following the
 * design's default across reloads.
 */
export function saveBotCardExpansion(
  overrides: BotCardExpansionOverrides,
  storage: ExpansionStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const entries = Object.entries(overrides);
    const bounded = entries.slice(Math.max(entries.length - MAX_ENTRIES, 0));
    storage.setItem(
      BOT_CARD_EXPANSION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(bounded)),
    );
  } catch {
    // Best-effort view state; a write failure must not swallow the toggle.
  }
}

/** Test isolation: the envelope is process-wide within a test file. */
export function clearBotCardExpansion(
  storage: ExpansionStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(BOT_CARD_EXPANSION_STORAGE_KEY, JSON.stringify({}));
  } catch {
    // Nothing to clear.
  }
}
