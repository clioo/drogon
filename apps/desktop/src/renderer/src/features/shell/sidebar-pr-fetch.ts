/* MIT Copyright (c) 2026 Lovecast Inc.
   Sidebar pull-request fetch plumbing (F2): the pure half of ProjectList's
   PR source. The provider bridge is the existing `tasks.list(mode:
   "pulls")` call TasksPage already uses — this module only decides WHICH
   projects to ask, WHEN a listing goes stale or a failure deserves a retry,
   and HOW results merge back, so the refresh policy is unit-testable
   without a DOM:
   - one bounded page (`state: "all"`, full page) per git project, so a
     concluded review is visible and the default 36-item window cannot hide
     a branch's PRs; further pages follow `hasNextPage` while a visible
     branch still lacks a LIVE match (a concluded-only match never stops
     the walk — a later page may carry the live review), within an
     explicit page budget; a mid-walk failure keeps the fetched pages
     (marked incomplete + failed) instead of discarding them for null;
   - listings revalidate on a bounded schedule during app lifetime
     (stale-while-revalidate with failure backoff), never per render and
     never with overlapping generations;
   - a later failure keeps the last good listing and marks its project
     stale (the card's ready-claim expires; facts stay) instead of blanking
     real markers or silently claiming fresh confirmation;
   - removed projects/workspaces are pruned so the cache cannot grow
     unboundedly;
   - listings are stored best-first (live open/draft before concluded
     history, newest number first) so the shared first-match grouping
     helper names the same review the card's deterministic picker names;
   - worktrees carrying a stored `linkedPr` whose branch matched nothing
     get one targeted `tasks.show` lookup each (never a guessed number),
     at most once per project + number. */

import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { Worktree } from "../../../../shared/session-contract";
import { isLivePullRequest } from "../../../../shared/workspace-pr-status";
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
 * Attempt/dedupe key for one targeted lookup. Scoped to the owning project:
 * PR #1 in repo A and PR #1 in repo B are different reviews, so an attempt
 * in one project must never suppress the other.
 */
export function sidebarLinkedPrAttemptKey(projectId: string, number: number): string {
  return `${projectId}\0${number}`;
}

/**
 * Targeted number fallback: worktrees carrying a stored `linkedPr` whose
 * branch matched no listed pull (paginated out of the bounded pages, or
 * retargeted since) get one `tasks.show(mode: "pulls")` lookup each — a
 * real stored number, never a guessed one. Numbers already present in the
 * listing, already attempted for THIS project, or on projects whose
 * listing failed or was never fetched are skipped: without a listing there
 * is nothing to call a "miss", and the list fetch itself is the recovery
 * path.
 */
export function selectSidebarLinkedPrLookups(
  groups: readonly ProjectGroup[],
  cache: SidebarPullsCache,
  attempted: ReadonlySet<string>,
): SidebarLinkedPrLookup[] {
  const lookups: SidebarLinkedPrLookup[] = [];
  const queued = new Set<string>();
  for (const group of groups) {
    if (group.project.kind !== "git") continue;
    const pulls = cache.get(group.project.id);
    if (!pulls) continue;
    for (const worktree of group.worktrees) {
      const linked = worktree.linkedPr ?? null;
      if (linked === null || !Number.isInteger(linked) || linked <= 0) continue;
      const key = sidebarLinkedPrAttemptKey(group.project.id, linked);
      if (attempted.has(key) || queued.has(key)) continue;
      if (pulls.some((pull) => pull.number === linked)) continue;
      if (selectCardPull(worktree, pulls) !== null) continue;
      queued.add(key);
      lookups.push({ projectId: group.project.id, number: linked });
    }
  }
  return lookups;
}

/**
 * Drops attempted-lookup keys no worktree still names (worktree removal):
 * a re-added worktree with the same stored link then gets its one lookup
 * again instead of inheriting a stale attempt. Returns the same reference
 * when nothing leaves.
 */
export function pruneSidebarLinkedPrAttempts(
  attempted: ReadonlySet<string>,
  groups: readonly ProjectGroup[],
): ReadonlySet<string> {
  if (attempted.size === 0) return attempted;
  const live = new Set<string>();
  for (const group of groups) {
    if (group.project.kind !== "git") continue;
    for (const worktree of group.worktrees) {
      if (hasSidebarLinkedPr(worktree)) {
        live.add(
          sidebarLinkedPrAttemptKey(group.project.id, worktree.linkedPr as number),
        );
      }
    }
  }
  let pruned: Set<string> | null = null;
  for (const key of attempted) {
    if (!live.has(key)) {
      if (!pruned) pruned = new Set(attempted);
      pruned.delete(key);
    }
  }
  return pruned ?? attempted;
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

/** A successfully fetched listing counts as fresh for this long before the
 *  sidebar revalidates it during app lifetime. */
export const SIDEBAR_PULLS_REFRESH_MS = 120_000;

/** First retry delay after a failed refresh; doubles per consecutive
 *  failure, capped below. */
export const SIDEBAR_PULLS_RETRY_BASE_MS = 15_000;
export const SIDEBAR_PULLS_RETRY_MAX_MS = 300_000;

/** Explicit request budget for one project's page walk: the shared bridge
 *  caps `page` at 10, and follow-up pages are fetched only while visible
 *  branches stay unmatched (early stop), so the common case stays one
 *  request per project per cycle. */
export const SIDEBAR_PULLS_MAX_PAGES = 10;

/** Per-project fetch health behind the cache: when the listing was last
 *  confirmed, and how many refreshes have failed consecutively since. */
export type SidebarPullsFreshness = {
  fetchedAt: number | null;
  failures: number;
  failedAt: number | null;
};

export type SidebarPullsFreshnessMap = ReadonlyMap<string, SidebarPullsFreshness>;

/** Backoff for the Nth consecutive failure (1-based): base doubling,
 *  capped. Pure, so the schedule is testable without timers. */
export function sidebarPullsRetryDelayMs(failures: number): number {
  const step = Math.max(1, Math.floor(failures));
  const delay = SIDEBAR_PULLS_RETRY_BASE_MS * 2 ** (step - 1);
  return Math.min(SIDEBAR_PULLS_RETRY_MAX_MS, delay);
}

/** Folds one fetch outcome into a project's health record: success
 *  re-confirms the listing and clears the failure streak; failure keeps the
 *  last confirmation time and extends the streak for backoff. */
export function recordSidebarPrFetchOutcome(
  previous: SidebarPullsFreshness | undefined,
  ok: boolean,
  nowMs: number,
): SidebarPullsFreshness {
  if (ok) return { fetchedAt: nowMs, failures: 0, failedAt: null };
  return {
    fetchedAt: previous?.fetchedAt ?? null,
    failures: (previous?.failures ?? 0) + 1,
    failedAt: nowMs,
  };
}

/** True once the failure streak's backoff has elapsed (or nothing has
 *  failed yet — the first attempt is never gated). */
function sidebarPrBackoffElapsed(
  entry: SidebarPullsFreshness | undefined,
  nowMs: number,
): boolean {
  const failedAt = entry?.failedAt ?? null;
  if (failedAt === null) return true;
  return (
    nowMs - failedAt >= sidebarPullsRetryDelayMs(Math.max(1, entry?.failures ?? 1))
  );
}

/**
 * Which git projects to request now: never-attempted ids, listings whose
 * confirmation expired (`SIDEBAR_PULLS_REFRESH_MS`), and failed attempts
 * whose backoff elapsed — plus previously failed (`null`) ids the moment
 * the visible project set changes (the registry refresh already
 * re-renders the sidebar during app lifetime). A fresh confirmed listing
 * is never refetched, and a failure never retries per render: without a
 * tick, a set change, or an expired backoff the answer is empty.
 */
export function selectSidebarPrDueIds(input: {
  cache: SidebarPullsCache;
  gitIds: readonly string[];
  freshness: SidebarPullsFreshnessMap;
  nowMs: number;
  signatureChanged: boolean;
}): string[] {
  const { cache, gitIds, freshness, nowMs, signatureChanged } = input;
  return gitIds.filter((id) => {
    if (!cache.has(id)) return true;
    const listing = cache.get(id);
    const entry = freshness.get(id);
    if (listing === null) {
      return signatureChanged || sidebarPrBackoffElapsed(entry, nowMs);
    }
    // An outstanding failure streak gates on its backoff even when the
    // underlying confirmation is stale: without this, a failed refresh
    // would leave the listing stale forever and every run would refetch
    // it in a tight loop instead of backing off.
    if (entry && entry.failedAt !== null && entry.failures > 0) {
      return sidebarPrBackoffElapsed(entry, nowMs);
    }
    if (entry?.fetchedAt == null) return true;
    if (nowMs - entry.fetchedAt >= SIDEBAR_PULLS_REFRESH_MS) return true;
    return false;
  });
}

/** Milliseconds until a project with no failure streak becomes due again;
 *  projects already excluded (in flight this generation) never pull the
 *  wake earlier. */
function sidebarPrBackoffRemainingMs(
  entry: SidebarPullsFreshness | undefined,
  nowMs: number,
): number {
  const failedAt = entry?.failedAt ?? null;
  if (failedAt === null) return 0;
  return Math.max(
    0,
    sidebarPullsRetryDelayMs(Math.max(1, entry?.failures ?? 1)) - (nowMs - failedAt),
  );
}

/**
 * How long the effect sleeps before its next scheduled wake: the nearest
 * upcoming due moment (stale listing or elapsed backoff), defaulting to
 * the full refresh interval when nothing is tracked. Excluded ids (fetches
 * already in flight) never schedule an immediate re-wake. The caller still
 * cleans the timer up on unmount/precondition change, and every wake
 * re-runs the due check — a wake alone never fetches.
 */
export function sidebarPrNextWakeDelayMs(input: {
  cache: SidebarPullsCache;
  gitIds: readonly string[];
  freshness: SidebarPullsFreshnessMap;
  nowMs: number;
  exclude?: ReadonlySet<string>;
}): number {
  const { cache, gitIds, freshness, nowMs, exclude } = input;
  let delay = SIDEBAR_PULLS_REFRESH_MS;
  for (const id of gitIds) {
    if (exclude?.has(id)) continue;
    if (!cache.has(id)) return 0;
    const listing = cache.get(id);
    const entry = freshness.get(id);
    if (listing === null) {
      delay = Math.min(delay, sidebarPrBackoffRemainingMs(entry, nowMs));
      continue;
    }
    if (entry?.fetchedAt == null) return 0;
    const staleIn = SIDEBAR_PULLS_REFRESH_MS - (nowMs - entry.fetchedAt);
    if (staleIn <= 0) return 0;
    const dueIn =
      entry.failedAt !== null && entry.failures > 0
        ? Math.min(staleIn, sidebarPrBackoffRemainingMs(entry, nowMs))
        : staleIn;
    delay = Math.min(delay, dueIn);
  }
  return Math.max(0, delay);
}

/**
 * Projects currently showing last-good data behind a failed refresh: the
 * card keeps their markers (facts don't expire) but lets the ready-claim
 * lapse via `applySidebarPrStaleness` until the next success. A `null`
 * entry shows nothing at all — `unavailable`, never stale.
 */
export function selectStaleSidebarPrProjects(
  cache: SidebarPullsCache,
  freshness: SidebarPullsFreshnessMap,
): ReadonlySet<string> {
  const stale = new Set<string>();
  for (const [id, listing] of cache) {
    if (listing === null) continue;
    if ((freshness.get(id)?.failures ?? 0) > 0) stale.add(id);
  }
  return stale;
}

/** Drops health records for projects no longer visible. Returns the same
 *  reference when nothing leaves. */
export function pruneSidebarPrFreshness(
  freshness: SidebarPullsFreshnessMap,
  liveProjectIds: ReadonlySet<string>,
): SidebarPullsFreshnessMap {
  let pruned: Map<string, SidebarPullsFreshness> | null = null;
  for (const id of freshness.keys()) {
    if (!liveProjectIds.has(id)) {
      if (!pruned) pruned = new Map(freshness);
      pruned.delete(id);
    }
  }
  return pruned ?? freshness;
}

/**
 * True while a page walk must continue past the current window: at least
 * one visible worktree carries a branch with no matched review and no
 * stored link of its own (a stored link gets its targeted show lookup
 * regardless of paging, so it never holds a page walk open).
 */
export function sidebarProjectHasUnresolvedBranches(
  group: ProjectGroup,
  pulls: readonly TaskPullRequest[],
): boolean {
  return group.worktrees.some((worktree) => {
    if (!worktree.branch) return false;
    if (selectCardPull(worktree, pulls) !== null) return false;
    if (hasSidebarLinkedPr(worktree)) return false;
    return true;
  });
}

/**
 * True while a page walk must continue past the current window to avoid
 * missing a live review: like `sidebarProjectHasUnresolvedBranches`, but
 * a branch whose best-known match is CONCLUDED (merged/closed) still
 * holds the walk open — a later page may carry the branch's still-live
 * review, and stopping on the concluded match would pin the concluded
 * one while defeating live-first selection. A branch with a live match
 * (open/draft) is resolved; a stored link still never holds a walk open.
 * The walk stays bounded by `SIDEBAR_PULLS_MAX_PAGES`, and an exhausted
 * budget with live-unresolved branches reports `incomplete` (retryable,
 * never "no PR").
 */
export function sidebarProjectHasUnresolvedLiveBranches(
  group: ProjectGroup,
  pulls: readonly TaskPullRequest[],
): boolean {
  return group.worktrees.some((worktree) => {
    if (!worktree.branch) return false;
    if (hasSidebarLinkedPr(worktree)) return false;
    const match = selectCardPull(worktree, pulls);
    if (match === null) return true;
    return !isLivePullRequest(match);
  });
}

/**
 * One project's page-walk outcome. `pulls: null` means NO page succeeded
 * (a page-1 failure): the merge keeps the last good listing and records
 * `null` only when nothing was ever fetched. A mid-walk failure returns
 * the successfully fetched earlier pages with `incomplete: true` and
 * `failed: true` — known data is preserved, the project reads stale (so
 * no Ready claim is made from incomplete knowledge), and the failure
 * streak schedules a bounded retry. A clean walk reports `failed: false`.
 */
export type SidebarPullsWalkOutcome = {
  projectId: string;
  pulls: readonly TaskPullRequest[] | null;
  incomplete: boolean;
  failed: boolean;
};

/**
 * Folds a thrown or typed page failure into an honest walk outcome: the
 * earlier pages of THIS walk survive (page 1 replaces, so they are the
 * provider's current truth for what they cover), marked incomplete and
 * failed so the refresh backoff retries and the ready-claim lapses until
 * a clean walk confirms it. With no successful page at all the outcome is
 * `null` — the merge then keeps the previous verified listing, never an
 * empty masquerade.
 */
export function sidebarPullsWalkErrorOutcome(
  pages: SidebarPullsCache,
  projectId: string,
): SidebarPullsWalkOutcome {
  const partial = pages.get(projectId) ?? null;
  if (!partial) return { projectId, pulls: null, incomplete: false, failed: true };
  return { projectId, pulls: partial, incomplete: true, failed: true };
}

/**
 * Folds one fetched page into a project's listing: page 1 replaces (the
 * provider's current truth), later pages append without duplicating
 * numbers, always best-first so the card picker and the shared first-match
 * grouping helper keep naming the same review.
 */
export function mergeSidebarPrPageResults(
  cache: SidebarPullsCache,
  projectId: string,
  pagePulls: readonly TaskPullRequest[],
  page: number,
): SidebarPullsCache {
  const current = cache.get(projectId);
  const combined =
    page <= 1 || !current
      ? [...pagePulls]
      : [...current, ...pagePulls.filter((pull) => !current.some((item) => item.number === pull.number))];
  const next = new Map(cache);
  next.set(projectId, sortSidebarPullsBestFirst(combined));
  return next;
}

/** What the sidebar honestly knows about one worktree's review: a branch
 *  match, a genuinely empty search, a search cut short by the page budget
 *  (`incomplete` — retryable, never "no PR"), or a listing that failed or
 *  was never fetched. */
export type SidebarPrBranchCoverage =
  | "matched"
  | "none"
  | "incomplete"
  | "unavailable";

export type SidebarPrBranchCoverageEntry = {
  worktreeId: string;
  projectId: string;
  branch: string;
  coverage: SidebarPrBranchCoverage;
};

/**
 * Per-worktree coverage over the current cache: `unavailable` while the
 * listing failed or was never fetched (never `none`), `incomplete` while
 * the project still has unresolved branches behind an exhausted page
 * budget, `none` only after the provider's own windows prove the branch
 * review-less. Branch-less worktrees (folder implicits, detached HEAD)
 * report `none` — there is nothing to correlate.
 */
export function sidebarPrBranchCoverage(
  groups: readonly ProjectGroup[],
  cache: SidebarPullsCache,
  incompleteProjectIds: ReadonlySet<string>,
): SidebarPrBranchCoverageEntry[] {
  const entries: SidebarPrBranchCoverageEntry[] = [];
  for (const group of groups) {
    if (group.project.kind !== "git") continue;
    const pulls = cache.get(group.project.id);
    for (const worktree of group.worktrees) {
      const branch = worktree.branch ?? "";
      if (!branch) {
        entries.push({ worktreeId: worktree.id, projectId: group.project.id, branch, coverage: "none" });
        continue;
      }
      if (!pulls) {
        entries.push({ worktreeId: worktree.id, projectId: group.project.id, branch, coverage: "unavailable" });
        continue;
      }
      if (selectCardPull(worktree, pulls) !== null) {
        entries.push({ worktreeId: worktree.id, projectId: group.project.id, branch, coverage: "matched" });
        continue;
      }
      const linked = worktree.linkedPr ?? null;
      if (
        linked !== null &&
        Number.isInteger(linked) &&
        linked > 0 &&
        pulls.some((pull) => pull.number === linked)
      ) {
        entries.push({ worktreeId: worktree.id, projectId: group.project.id, branch, coverage: "matched" });
        continue;
      }
      entries.push({
        worktreeId: worktree.id,
        projectId: group.project.id,
        branch,
        coverage: incompleteProjectIds.has(group.project.id) ? "incomplete" : "none",
      });
    }
  }
  return entries;
}
