/* MIT Copyright (c) 2026 Lovecast Inc.
   Sidebar pull-request fetch plumbing (F2): the pure half of ProjectList's
   PR source. The provider bridge is the existing `tasks.list(mode:
   "pulls")` call TasksPage already uses — this module only decides WHICH
   projects to ask, WHEN a failure deserves a retry, and HOW results merge
   back, so the refresh policy is unit-testable without a DOM:
   - one bounded page (`state: "all"`, full page) per git project, so a
     concluded review is visible and the default 36-item window cannot hide
     a branch's PRs;
   - fetch once per project: a recorded entry (pulls or a failure marker)
     is never refetched for the same project set; a failure is retried only
     when the visible project set changes (registry refresh during app
     lifetime), never per render;
   - a later failure keeps the last good listing (stale-while-revalidate)
     instead of blanking real markers;
   - removed projects/workspaces are pruned so the cache cannot grow
     unboundedly;
   - listings are stored best-first (live open/draft before concluded
     history, newest number first) so the shared first-match grouping
     helper names the same review the card's deterministic picker names;
   - worktrees carrying a stored `linkedPr` whose branch matched nothing
     get one targeted `tasks.show` lookup each (never a guessed number),
     at most once per number. */

import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { selectCardPull } from "./worktree-card-pr-display";

/** One bounded page per project: the bridge schema caps `perPage` at 100. */
export const SIDEBAR_PULLS_PER_PAGE = 100;

/** Pull listings by project id; `null` marks a failed fetch (gh
 *  missing/unauthenticated/no GitHub remote), distinct from `[]` ("asked,
 *  and this project genuinely has no PRs"). Absence means never attempted. */
export type SidebarPullsCache = ReadonlyMap<string, readonly TaskPullRequest[] | null>;

/** Git projects carry a branch/PR concept; folder projects never do (their
 *  implicit worktrees have no branch, so they are seeded straight to `[]`
 *  without ever querying the provider). */
export function sidebarPrProjectIds(groups: readonly ProjectGroup[]): {
  git: string[];
  folder: string[];
} {
  const git: string[] = [];
  const folder: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.project.id)) continue;
    seen.add(group.project.id);
    if (group.project.kind === "git") git.push(group.project.id);
    else folder.push(group.project.id);
  }
  return { git, folder };
}

/** Identity of the visible git project set. A change means new projects
 *  may need a first fetch and previously failed ones deserve one retry
 *  (the registry refresh already re-renders the sidebar during app
 *  lifetime, so no polling timer is needed). */
export function sidebarPrFetchSignature(gitIds: readonly string[]): string {
  return [...gitIds].sort().join("\0");
}

/**
 * Which git projects to request now: every never-attempted id, plus
 * previously failed (`null`) ids only when the project set changed since
 * the last attempt. A project with a recorded listing — empty or not — is
 * never refetched for the same set, and a failure never retries per render.
 */
export function selectSidebarPrFetchIds(
  cache: SidebarPullsCache,
  gitIds: readonly string[],
  signatureChanged: boolean,
): string[] {
  return gitIds.filter((id) => {
    if (!cache.has(id)) return true;
    return signatureChanged && cache.get(id) === null;
  });
}

/** A listing is live exactly when gh still reports it open or draft. */
function isLivePull(pull: TaskPullRequest): boolean {
  return pull.state === "open" || pull.state === "draft";
}

/**
 * Best-first order for one project's listing: live reviews before
 * concluded history, newest number first within each group. The card's
 * deterministic picker (`selectCardPull`) is order-independent, so this
 * only aligns the shared first-match grouping helper onto the same review
 * — the card and its bucket can never disagree about which PR a branch
 * names.
 */
export function sortSidebarPullsBestFirst(
  pulls: readonly TaskPullRequest[],
): TaskPullRequest[] {
  return [...pulls].sort((a, b) => {
    const live = Number(isLivePull(b)) - Number(isLivePull(a));
    if (live !== 0) return live;
    return b.number - a.number;
  });
}

export type SidebarPullsFetchEntry = readonly [
  projectId: string,
  pulls: readonly TaskPullRequest[] | null,
];

/**
 * Merges one fetch generation back into the cache. Success overwrites
 * (the listing is the provider's current truth, best-first); failure
 * keeps the last good listing and records `null` only when nothing was
 * ever fetched, so a transient `gh` failure never blanks real markers and
 * never becomes a permanent null without retry (see
 * `selectSidebarPrFetchIds`). Entries for projects outside this
 * generation are carried over untouched.
 */
export function mergeSidebarPrResults(
  cache: SidebarPullsCache,
  entries: readonly SidebarPullsFetchEntry[],
): SidebarPullsCache {
  if (entries.length === 0) return cache;
  const next = new Map(cache);
  for (const [projectId, pulls] of entries) {
    if (pulls !== null) {
      next.set(projectId, sortSidebarPullsBestFirst(pulls));
    } else if (!next.has(projectId)) {
      next.set(projectId, null);
    }
  }
  return next;
}

/**
 * Drops cache entries for projects no longer visible (workspace/project
 * removal). Returns the same map reference when nothing leaves, so a
 * React state update can bail out without re-rendering.
 */
export function pruneSidebarPrCache(
  cache: SidebarPullsCache,
  liveProjectIds: ReadonlySet<string>,
): SidebarPullsCache {
  let pruned: Map<string, readonly TaskPullRequest[] | null> | null = null;
  for (const id of cache.keys()) {
    if (!liveProjectIds.has(id)) {
      if (!pruned) pruned = new Map(cache);
      pruned.delete(id);
    }
  }
  return pruned ?? cache;
}

export type SidebarLinkedPrLookup = {
  projectId: string;
  number: number;
};

/**
 * Targeted number fallback: worktrees carrying a stored `linkedPr` whose
 * branch matched no listed pull (paginated out of the one bounded page,
 * or retargeted since) get one `tasks.show(mode: "pulls")` lookup each —
 * a real stored number, never a guessed one. Numbers already present in
 * the listing, already attempted, or on projects whose listing failed or
 * was never fetched are skipped: without a listing there is nothing to
 * call a "miss", and the list fetch itself is the recovery path.
 */
export function selectSidebarLinkedPrLookups(
  groups: readonly ProjectGroup[],
  cache: SidebarPullsCache,
  attemptedNumbers: ReadonlySet<number>,
): SidebarLinkedPrLookup[] {
  const lookups: SidebarLinkedPrLookup[] = [];
  const queued = new Set<number>();
  for (const group of groups) {
    if (group.project.kind !== "git") continue;
    const pulls = cache.get(group.project.id);
    if (!pulls) continue;
    for (const worktree of group.worktrees) {
      const linked = worktree.linkedPr ?? null;
      if (linked === null || !Number.isInteger(linked) || linked <= 0) continue;
      if (attemptedNumbers.has(linked) || queued.has(linked)) continue;
      if (pulls.some((pull) => pull.number === linked)) continue;
      if (selectCardPull(worktree, pulls) !== null) continue;
      queued.add(linked);
      lookups.push({ projectId: group.project.id, number: linked });
    }
  }
  return lookups;
}

/**
 * Folds targeted `tasks.show` results into their project's listing
 * (replacing the same number, appending otherwise), keeping best-first
 * order. Unknown projects and failures leave the cache untouched — a
 * missing linked review is reported by its absence, never invented.
 */
export function mergeSidebarLinkedPrResults(
  cache: SidebarPullsCache,
  results: readonly {
    projectId: string;
    pull: TaskPullRequest | null;
  }[],
): SidebarPullsCache {
  if (results.length === 0) return cache;
  let next: Map<string, readonly TaskPullRequest[] | null> | null = null;
  for (const { projectId, pull } of results) {
    if (!pull) continue;
    const current = (next ?? cache).get(projectId);
    if (!current) continue;
    if (!next) next = new Map(cache);
    const without = current.filter((item) => item.number !== pull.number);
    next.set(projectId, sortSidebarPullsBestFirst([...without, pull]));
  }
  return next ?? cache;
}

/** A worktree is a candidate for the linked-number fallback only when it
 *  carries a plausible stored link. Exported for the wiring test. */
export function hasSidebarLinkedPr(worktree: Pick<Worktree, "linkedPr">): boolean {
  const linked = worktree.linkedPr ?? null;
  return linked !== null && Number.isInteger(linked) && linked > 0;
}
