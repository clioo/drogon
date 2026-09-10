/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/worktree-name-suggestion.ts and
   src/renderer/src/components/sidebar/worktree-name-suggestions.ts (the
   blank-submit fallback name behind the composer's [Optional] field).
   Adapter: the source's retired-name registry (a daemon-persisted compaction
   of every spent name) is not ported — Drogon dedupes against the live
   worktree paths only, and the daemon's duplicate-name refusal still guards
   the rare collision a deleted workspace could cause. */

import { MARINE_CREATURE_NAMES_PRIMARY, MARINE_CREATURE_NAMES_SECONDARY } from "./marine-creature-names";

/** The source's auto-generated workspace-name pool (shared, not
 *  renderer-scoped, so a suggested name agrees across surfaces). */
export const MARINE_CREATURES = [
  ...MARINE_CREATURE_NAMES_PRIMARY,
  ...MARINE_CREATURE_NAMES_SECONDARY,
] as const;

export function normalizeSuggestedName(name: string): string {
  return name.trim().toLowerCase();
}

function stripTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/** Cross-platform basename: worktree paths can be POSIX or Windows, and the
 *  collision that matters is on the directory name rather than the
 *  user-facing display name. */
export function suggestionPathBasename(path: string): string {
  const normalized = stripTrailingSeparators(path);
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function pickRandom<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/** Tier 1 is the bare pool name; tier N is `name-N` (the source's
 *  `creatureNameAtTier` with the registry watermark fixed at 0). */
function creatureNameAtTier(poolName: string, tier: number): string {
  return tier === 1 ? poolName : `${poolName}-${tier}`;
}

/** Picks a name nothing has taken, at random rather than in list order so
 *  fresh workspaces don't all start at the same creature and march down the
 *  list together. Once every base name is spent the pool degrades to
 *  `name-2`, `name-3`, and those variants repeat the same dedupe. */
export function selectSuggestedCreatureName(
  usedNames: Iterable<string>,
  random: () => number = Math.random,
): string {
  const used = new Set<string>();
  for (const name of usedNames) {
    used.add(normalizeSuggestedName(name));
  }

  let tier = 1;
  while (true) {
    const available = MARINE_CREATURES.map((name) =>
      creatureNameAtTier(normalizeSuggestedName(name), tier),
    ).filter((name) => !used.has(name));
    if (available.length > 0) {
      return pickRandom(available, random);
    }
    tier += 1;
  }
}

type WorktreePathLike = {
  path: string;
};

/** Why dedupe across every project, not just the active one — branch names
 *  appear flat in the sidebar, so per-project scoping let two projects
 *  collide on one name (the source's `collectUsedNames`). */
function collectUsedNames(worktrees: readonly WorktreePathLike[]): Set<string> {
  const usedNames = new Set<string>();
  for (const worktree of worktrees) {
    usedNames.add(normalizeSuggestedName(suggestionPathBasename(worktree.path)));
  }
  return usedNames;
}

/** The composer's blank-name fallback (`getSuggestedCreatureName`): a
 *  globally-unique creature name so blank submissions get a distinct,
 *  readable workspace rather than a collision-prone literal that git would
 *  append numeric suffixes to. */
export function getSuggestedCreatureName(
  worktrees: readonly WorktreePathLike[],
  random: () => number = Math.random,
): string {
  return selectSuggestedCreatureName(collectUsedNames(worktrees), random);
}

export function shouldApplySuggestedName(
  name: string,
  previousSuggestedName: string,
): boolean {
  return !name.trim() || name === previousSuggestedName;
}
