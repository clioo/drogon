/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/task-page/TaskPage.tsx and its stage hooks
   (use-task-page-*), adapted to this repo's contracts: Orca's zustand
   multi-provider page becomes a props-driven GitHub-only page over the
   tasks.* RPCs. The ported task-page/ components render the model this
   file assembles; row selection keeps the journey-J6 behavior (start a
   worktree for the issue, then open its terminal). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  TASKS_CAPABILITY,
  TASKS_PAGE_SIZE,
  type TaskLink,
  type TasksBridge,
} from "../../../../shared/tasks-contract";
import type { Session } from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import type {
  JiraBridge,
  JiraConnectionStatus,
  JiraIssue,
} from "../../../../shared/jira-contract";
import {
  consumePendingTaskSource,
  resolveRequestedTaskSource,
  subscribeTaskSourceNavigation,
  type TaskSource,
} from "./task-source-navigation";
import { TaskPageSurface } from "./task-page/Surface";
import { getRepoBackedTaskEmptyState } from "./task-page-empty-state";
import { toPullWorkItem, toWorkItem } from "./task-page-model";
import type {
  TaskPageModel,
  TaskPageWorkItem,
  TaskPickerRepo,
} from "./task-page-model";
import { GITHUB_PR_TASK_GRID_CLASS, GITHUB_TASK_GRID_CLASS, TASK_SEARCH_DEBOUNCE_MS } from "./task-page-source-context";
import type {
  GitHubTaskKind,
  GitHubTaskPresetId,
} from "./task-page-localized-options";
import {
  buildNewGitHubIssueUrl,
  getGitHubDefaultPreset,
  getGitHubDefaultQuery,
  getGitHubModeButtons,
  getGitHubTaskPresetQuery,
  getJiraPresets,
  getSourceOptions,
  projectTasksDaemonQuery,
  projectTasksDaemonState,
  type JiraPresetId,
} from "./task-page-localized-options";
import { windowShellOpenExternal } from "../landing/github-star";
import { toast } from "sonner";
import { useJiraListState } from "./jira/use-jira-list-state";
import { useJiraIssueCreationDialog } from "./jira/use-jira-issue-creation";
import { startWorkspaceFromJiraIssue } from "./jira/use-jira-start-issue";
import { jiraSurfaceRefusedBridge } from "./jira/jira-surface-defaults";
import type {
  GitHubOwnerRepo,
  IssueSourcePreference,
} from "./issue-source-selector";
import {
  loadIssueSourcePreference,
  saveIssueSourcePreference,
} from "./issue-source-preference";
import {
  TASKS_PAGE_HOST_SELECTOR,
  useTaskPageGlobalEscape,
} from "./task-page-global-escape";
import { readTasksPageSeed, writeTasksPageSeed } from "./tasks-page-seed-storage";

/** `tasks.remotes` reports slugs as `owner/repo`; anything else is treated
 *  as absent rather than trusted (the selector's null rules decide from
 *  the two parsed candidates). */
function parseTaskRepoSlug(slug: string | undefined): GitHubOwnerRepo | null {
  if (!slug) return null;
  const slash = slug.indexOf("/");
  if (slash <= 0 || slash === slug.length - 1) return null;
  return { owner: slug.slice(0, slash), repo: slug.slice(slash + 1) };
}

// Why: off-app renders (tests) have no granted jira.v1 namespace; a refused
// stub keeps the chrome renderable and every RPC fails closed.
const refusedJiraBridge = jiraSurfaceRefusedBridge;

/** The workspace sheet's external-link opener (the shell.openExternal seam). */
const openJiraIssueUrlOpener = (url: string): Promise<unknown> | unknown =>
  typeof window === "undefined"
    ? undefined
    : (windowShellOpenExternal(window.drogon)?.(url) ?? undefined);

/** The workspace sheet's clipboard seam (this repo's navigator pattern). */
const writeJiraClipboardTextOpener = (text: string): Promise<unknown> | unknown =>
  typeof navigator === "undefined"
    ? Promise.resolve()
    : (navigator.clipboard?.writeText(text) ?? Promise.resolve());

export const TASKS_ROUTE_ID = "tasks";
export const TASKS_TITLE = "Tasks";

/** Pure capability gate: does the service expose the tasks contract? */
export function isTasksAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(TASKS_CAPABILITY);
}

export type TasksPageHost = {
  bridge: TasksBridge;
  /** Fresh project groups (App-owned ref); re-read on mount and Refresh. */
  loadGroups: () => ProjectGroup[];
  /** Opens a terminal session in the started worktree's workspace. */
  onOpenTerminal: (workspaceId: string) => void;
  /** Closes the Tasks page (SourceBar close / Esc); optional until the app wires it. */
  onClose?: () => void;
  /** The `jira.v1` bridge; defaults to the granted `window.drogon.jira`
   *  namespace (tests inject a stub here). */
  jiraBridge?: JiraBridge;
};

export type TasksPanelProps = {
  routeId: string;
  session: Session | null;
  workspace: { id: string; path: string; name: string };
  status: { hostId: string };
  restoreState?: unknown;
  focusTarget: HTMLElement | null;
};

export type TasksPanelDescriptor = {
  id: string;
  title: string;
  component: (props: TasksPanelProps) => ReactNode;
  capability: string;
};

type ListPhase = "loading" | "ready" | "error";

/**
 * Projects the page can actually serve: real daemon projects only. The
 * sidebar may additionally show synthetic `folder:` entries for plain
 * workspaces (see the interim project bridge); those have no project
 * binding, so `tasks.*` would only answer `not_found` for them.
 */
function servableGroups(groups: ProjectGroup[]): ProjectGroup[] {
  return groups.filter((group) => !group.project.id.startsWith("folder:"));
}

function pickDefaultProject(groups: ProjectGroup[]): string | null {
  const servable = servableGroups(groups);
  const git = servable.find((group) => group.project.kind === "git");
  return (git ?? servable[0])?.project.id ?? null;
}

// Fork parity (#238): the page unmounts on every tab switch, so without a
// cache each return visit replays the full skeleton. The last successful
// result per request key (project, kind, derived state, daemon query,
// page) survives in this module map — the fork's resume cache in local
// form — and seeds the next mount's rows; the mount still revalidates, so
// the seed only ever skips the skeleton, never the fetch. R16-BF persists
// the same results to localStorage (tasks-page-seed-storage): a renderer
// restart drops the module map, and without the persisted seed the next
// cold open would replay the full `gh` round trip before any row paints.
export type TasksPageCacheKey = {
  projectId: string | null;
  kind: GitHubTaskKind;
  state: string;
  query: string | undefined;
  page: number;
  /** The issue-source pin (or "auto"): rows listed from upstream must
   *  never seed a view pinned to origin or vice versa. */
  source: string;
};

export type TasksPageCachedResult = {
  repo: string | null;
  workItems: TaskPageWorkItem[];
  hasNextPage: boolean;
  furthestPage: number;
};

const tasksPageResultCache = new Map<string, TasksPageCachedResult>();

function tasksPageCacheKeyString(key: TasksPageCacheKey): string {
  return [key.projectId ?? "", key.kind, key.state, key.query ?? "", String(key.page), key.source].join("|");
}

/** Test seam: drops every cached result between cases. */
export function clearTasksPageResultCache(): void {
  tasksPageResultCache.clear();
}

export function readTasksPageCache(key: TasksPageCacheKey): TasksPageCachedResult | undefined {
  return tasksPageResultCache.get(tasksPageCacheKeyString(key));
}

function writeTasksPageCache(key: TasksPageCacheKey, result: TasksPageCachedResult): void {
  tasksPageResultCache.set(tasksPageCacheKeyString(key), result);
  // Bounded like the daemon's page window: one project accumulating every
  // page it visits must not grow without limit.
  if (tasksPageResultCache.size > 64) {
    const oldest = tasksPageResultCache.keys().next();
    if (!oldest.done) tasksPageResultCache.delete(oldest.value);
  }
}

export function TasksPage({ bridge, loadGroups, onOpenTerminal, onClose, jiraBridge }: TasksPageHost) {
  // Why: the granted jira.v1 namespace (R17-A preload); off-app (tests that
  // render chrome only) a refused stub keeps the surface renderable.
  const jira = useMemo<JiraBridge>(
    () =>
      jiraBridge ??
      ((typeof window !== "undefined"
        ? (window.drogon as unknown as { jira?: JiraBridge } | undefined)?.jira
        : undefined) ??
        refusedJiraBridge()),
    [jiraBridge],
  );
  // #270: fork `use-task-page-global-effects.ts` — Escape closes the page
  // from anywhere (window capture) once the page is the visible surface.
  useTaskPageGlobalEscape({
    closeTaskPage: () => onClose?.(),
    hostSelector: TASKS_PAGE_HOST_SELECTOR,
  });
  const [groups, setGroups] = useState<ProjectGroup[]>(() => loadGroups());
  const [projectId, setProjectId] = useState<string | null>(() =>
    pickDefaultProject(loadGroups()),
  );
  const [githubTaskKind, setGithubTaskKind] = useState<GitHubTaskKind>("issues");
  // #346: source deep-linked from the sidebar provider chips. The raw
  // request survives even when the source is not renderable yet (Jira
  // arrives with R17-B), so it selects as soon as the option exists;
  // until then the resolution falls back to the default source.
  const [requestedTaskSource, setRequestedTaskSource] =
    useState<TaskSource | null>(null);
  useEffect(() => {
    const pending = consumePendingTaskSource();
    if (pending !== null) setRequestedTaskSource(pending);
    // Why: App keeps this page mounted (hidden) across route switches, so
    // chip clicks after the first visit arrive through the subscription.
    return subscribeTaskSourceNavigation(setRequestedTaskSource);
  }, []);
  // Source preset pill (fork use-task-page-search-actions): set by preset
  // clicks and kind switches, cleared the moment the user types.
  const [activeTaskPreset, setActiveTaskPreset] = useState<GitHubTaskPresetId | null>(() =>
    getGitHubDefaultPreset("issues"),
  );
  // Source default (presetToQuery): the box opens prefilled with the kind's
  // qualifier query; the daemon projection below strips the implied parts.
  const [taskSearchInput, setTaskSearchInput] = useState(() =>
    getGitHubDefaultQuery("issues"),
  );
  const [appliedTaskSearch, setAppliedTaskSearch] = useState(() =>
    getGitHubDefaultQuery("issues"),
  );
  // Fork parity (#238): no Open/Closed/All control — the daemon `state`
  // rides the applied search text (is:closed, or no qualifier for all).
  const tasksDaemonState = projectTasksDaemonState(appliedTaskSearch);
  // Mount seed from the module result cache (read once): a return visit
  // with the default view paints the last rows instantly instead of
  // replaying the skeleton, then revalidates below like the fork's
  // landing refresh.
  const [mountSeed] = useState(() => {
    const defaultQuery = getGitHubDefaultQuery("issues");
    const key: TasksPageCacheKey = {
      projectId: pickDefaultProject(loadGroups()),
      kind: "issues",
      state: projectTasksDaemonState(defaultQuery),
      query: projectTasksDaemonQuery(defaultQuery),
      page: 1,
      source:
        (() => {
          const initial = pickDefaultProject(loadGroups());
          return initial === null
            ? "auto"
            : (loadIssueSourcePreference(initial) ?? "auto");
        })(),
    };
    // The persisted seed only matters when the module map missed (a fresh
    // renderer after a restart); within one lifetime the module map is
    // always fresher.
    return { key, cached: readTasksPageCache(key) ?? readTasksPageSeed(key) };
  });
  const [workItems, setWorkItems] = useState<TaskPageWorkItem[]>(() => mountSeed.cached?.workItems ?? []);
  const [repo, setRepo] = useState<string | null>(() => mountSeed.cached?.repo ?? null);
  // Fork parity (#353): the source's tasksLoading starts false, so a page
  // that opens with no servable project paints the settled empty state
  // directly; only a real project primes the skeleton.
  const [listPhase, setListPhase] = useState<ListPhase>(() =>
    pickDefaultProject(loadGroups()) === null ? "ready" : "loading",
  );
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [githubUnavailable, setGithubUnavailable] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(() => mountSeed.cached?.hasNextPage ?? false);
  const [furthestPage, setFurthestPage] = useState(() => mountSeed.cached?.furthestPage ?? 1);
  const [loadingTargetPage, setLoadingTargetPage] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [taskLinks, setTaskLinks] = useState<TaskLink[]>([]);
  // Issue-source selector (#246): the selected repo's GitHub remote
  // topology (null until `tasks.remotes` answers) and the persisted
  // per-project pin (undefined = the fork's `'auto'`).
  const [issueSourceTopology, setIssueSourceTopology] = useState<{
    projectId: string;
    origin: GitHubOwnerRepo | null;
    upstream: GitHubOwnerRepo | null;
  } | null>(null);
  const [issueSourcePreference, setIssueSourcePreference] = useState<
    IssueSourcePreference | undefined
  >(() => {
    const initial = pickDefaultProject(loadGroups());
    return initial === null ? undefined : loadIssueSourcePreference(initial);
  });
  const [startBusyNumber, setStartBusyNumber] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const githubListScrollRef = useRef<HTMLDivElement | null>(null);

  // --- R17-B: Jira source state (fork use-task-page-jira-list-state +
  // store-bindings + repo-selection derivation) ---------------------------
  const [jiraStatusState, setJiraStatusState] = useState<{
    status: JiraConnectionStatus | null;
    checked: boolean;
  }>({ status: null, checked: false });
  const refreshJiraStatus = useCallback(() => {
    let cancelled = false;
    void jira
      .jiraStatus()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setJiraStatusState({ status: result.result, checked: true });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setJiraStatusState((current) =>
            current.checked ? current : { ...current, checked: true },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jira]);
  useEffect(() => refreshJiraStatus(), [refreshJiraStatus]);
  const jiraStatus = jiraStatusState.status;
  // Why: the fork's jiraStatusCurrent keys the status to the provider
  // runtime context; Drogon runs one local runtime, so a fetched status is
  // always current (declared R17-B deviation).
  const jiraStatusReady = jiraStatusState.checked;
  const jiraConnected = jiraStatus?.connected ?? false;
  const jiraSites = useMemo(() => jiraStatus?.sites ?? [], [jiraStatus]);
  // Fork repo-selection derivation: selectedSiteId, else activeSiteId, else
  // the first connected site.
  const selectedJiraSiteId =
    jiraStatus?.selectedSiteId ?? jiraStatus?.activeSiteId ?? jiraSites[0]?.id ?? null;
  const selectedJiraSite =
    selectedJiraSiteId && selectedJiraSiteId !== "all"
      ? (jiraSites.find((site) => site.id === selectedJiraSiteId) ?? null)
      : null;
  const [jiraConnectOpen, setJiraConnectOpen] = useState(false);
  // Fork hideTaskSource semantics: hidden providers drop out of the source
  // options (the fork persists settings.visibleTaskProviders; Drogon keeps
  // the page-mounted set, declared deviation).
  const [hiddenTaskSources, setHiddenTaskSources] = useState<Set<TaskSource>>(
    () => new Set(),
  );
  const sourceOptions = getSourceOptions();
  const visibleSourceOptions = sourceOptions.filter(
    (option) => !hiddenTaskSources.has(option.id),
  );
  // #346 + R17-B: a requested source (sidebar chip, source-icon click)
  // selects as soon as it is renderable; the Jira option now always is.
  const taskSource: TaskSource = resolveRequestedTaskSource(
    requestedTaskSource,
    visibleSourceOptions.map((option) => option.id),
  );
  const jiraList = useJiraListState({
    bridge: jira,
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
  });
  // Fork detail-routing state: the selected issue key + fallback snapshot
  // collapse to one value here (no cross-page cache to reconcile against).
  const [selectedJiraIssue, setSelectedJiraIssue] = useState<JiraIssue | null>(null);
  const openJiraDetailPage = useCallback((issue: JiraIssue) => {
    setSelectedJiraIssue(issue);
  }, []);
  const closeJiraDetailPage = useCallback(() => {
    setSelectedJiraIssue(null);
  }, []);
  // The fork's selected-issue reconciliation: when the issue leaves the
  // displayed list (site switch, preset change, refresh), the sheet closes.
  useEffect(() => {
    if (!jiraConnected || jiraList.jiraIssues.length === 0) {
      if (selectedJiraIssue !== null) {
        setSelectedJiraIssue(null);
      }
      return;
    }
    if (
      selectedJiraIssue &&
      !jiraList.jiraIssues.some(
        (issue) =>
          issue.key === selectedJiraIssue.key &&
          (!selectedJiraIssue.siteId ||
            !issue.siteId ||
            issue.siteId === selectedJiraIssue.siteId),
      )
    ) {
      setSelectedJiraIssue(null);
    }
  }, [jiraConnected, jiraList.jiraIssues, selectedJiraIssue]);

  const onSelectTaskSource = useCallback((source: TaskSource) => {
    setRequestedTaskSource(source);
  }, []);
  const hideTaskSource = useCallback((source: TaskSource) => {
    setHiddenTaskSources((current) => {
      const next = new Set(current);
      next.add(source);
      return next;
    });
  }, []);
  // Fork SourceBar selectJiraSite: clear the list immediately, then let the
  // daemon switch; a failure toasts the fork's copy and keeps the old site.
  const onSelectJiraSite = useCallback(
    (siteId: string) => {
      setSelectedJiraIssue(null);
      jiraList.resetJiraList();
      void jira
        .jiraSelectSite({ siteId })
        .then((result) => {
          if (result.ok) {
            setJiraStatusState({ status: result.result, checked: true });
            return;
          }
          toast.error("Failed to switch Jira site.");
        })
        .catch(() => {
          toast.error("Failed to switch Jira site.");
        });
    },
    [jira, jiraList],
  );
  const onSelectJiraPreset = useCallback(
    (preset: JiraPresetId) => {
      jiraList.setJiraSearchInput("");
      jiraList.setAppliedJiraSearch("");
      jiraList.setActiveJiraPreset(preset);
      jiraList.persistJiraResumeState({ jiraPreset: preset, jiraQuery: "" });
      jiraList.handleRefreshJiraIssues();
    },
    [jiraList],
  );
  const jiraCreationDialog = useJiraIssueCreationDialog({
    bridge: jira,
    connected: jiraConnected,
    siteId: selectedJiraSiteId,
    // The fork inserts the created issue into the list cache and selects
    // it; without a cache the refresh re-reads the list and the sheet opens
    // on the fresh issue.
    onCreated: (issue) => {
      jiraList.handleRefreshJiraIssues();
      openJiraDetailPage(issue);
    },
  });
  // Why: the creation hook's returned object is a fresh literal each render;
  // the open/close setters are stable, so the chrome callbacks key on them.
  const setJiraDialogOpen = jiraCreationDialog.setOpen;
  const onOpenNewJiraIssue = useCallback(() => {
    setJiraDialogOpen(true);
  }, [setJiraDialogOpen]);
  const onJiraIssuePatched = useCallback((issue: JiraIssue) => {
    jiraList.patchJiraIssue(issue);
  }, [jiraList]);
  // handleUseJiraItem lives below next to refreshLinks (it opens the
  // started worktree's terminal and refreshes the issue badges).

  const refreshGroups = useCallback(() => {
    const next = loadGroups();
    setGroups(next);
    setProjectId((current) =>
      current && next.some((group) => group.project.id === current)
        ? current
        : pickDefaultProject(next),
    );
  }, [loadGroups]);

  // Why: loadGroups is a snapshot getter, not a subscription, and projects
  // arrive asynchronously after the page can mount — re-read while mounted
  // so the picker self-heals like the source's store-backed list.
  const groupsKey = groups.map((group) => group.project.id).join(",");
  useEffect(() => {
    const poll = setInterval(() => {
      const next = loadGroups();
      const key = next.map((group) => group.project.id).join(",");
      if (key !== groupsKey) refreshGroups();
    }, 2000);
    return () => clearInterval(poll);
  }, [loadGroups, groupsKey, refreshGroups]);

  // Debounces the text filter into the server-side query: typing never
  // fires a request per keystroke (source: TASK_SEARCH_DEBOUNCE_MS).
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedTaskSearch(taskSearchInput);
      setPage(1);
    }, TASK_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [taskSearchInput]);

  // The picker serves git projects only; a single selection, like the
  // source's single-repo list (Drogon has no cross-repo merge).
  const taskPickerRepos: TaskPickerRepo[] = useMemo(
    () =>
      servableGroups(groups)
        .filter((group) => group.project.kind === "git")
        .map((group) => ({
          id: group.project.id,
          name: group.project.name,
          kind: group.project.kind,
        })),
    [groups],
  );
  const repoSelection = useMemo(
    () => new Set(projectId === null ? [] : [projectId]),
    [projectId],
  );
  const selectedRepos = useMemo(
    () => taskPickerRepos.filter((repo) => repoSelection.has(repo.id)),
    [taskPickerRepos, repoSelection],
  );
  const repoMap = useMemo(
    () =>
      new Map(
        taskPickerRepos.map((repo) => [
          repo.id,
          { ...repo, displayName: repo.name, badgeColor: "" },
        ]),
      ),
    [taskPickerRepos],
  );

  // Refreshes the sidebar issue badges for the selected project; the
  // worktree cards show the #n badge after a start.
  const refreshLinks = useCallback(() => {
    if (projectId === null) return;
    void bridge.tasksLinks({ projectId }).then((result) => {
      if (result.ok) setTaskLinks(result.result.links);
    });
  }, [bridge, projectId]);

  useEffect(() => {
    refreshLinks();
  }, [refreshLinks]);

  // Fork handleUseJiraItem → openComposerForJiraItem: the daemon creates
  // the worktree (jira.startIssue) and the page opens its terminal through
  // the same harness seam as the GitHub rows; the composer-modal repo pick
  // has no Drogon counterpart, so the page's selected project applies.
  const handleUseJiraItem = useCallback(
    (issue: JiraIssue) => {
      if (projectId === null) {
        toast.error("Select a project in the Tasks page before starting a Jira issue.");
        return;
      }
      void startWorkspaceFromJiraIssue(jira, { projectId, issue })
        .then((outcome) => {
          if (!outcome.ok) {
            toast.error(outcome.error);
            return;
          }
          refreshLinks();
          onOpenTerminal(outcome.workspaceId);
        })
        .catch(() => {
          toast.error("Could not start the Jira issue.");
        });
    },
    [jira, projectId, refreshLinks, onOpenTerminal],
  );

  // The pin is per project: switching repos adopts the stored choice of
  // the newly selected repo (or `'auto'` when it was never pinned).
  useEffect(() => {
    setIssueSourcePreference(
      projectId === null ? undefined : loadIssueSourcePreference(projectId),
    );
  }, [projectId]);

  // Remote topology for the selector: local git config via the daemon, so
  // it answers even before (or without) a successful `gh` list. Re-probes
  // on Refresh so an added/removed upstream remote shows up.
  useEffect(() => {
    if (projectId === null) {
      setIssueSourceTopology(null);
      return;
    }
    let cancelled = false;
    void bridge
      .tasksRemotes({ projectId })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setIssueSourceTopology(null);
          return;
        }
        setIssueSourceTopology({
          projectId,
          origin: parseTaskRepoSlug(result.result.origin),
          upstream: parseTaskRepoSlug(result.result.upstream),
        });
      })
      .catch(() => {
        if (!cancelled) setIssueSourceTopology(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectId, refreshNonce]);

  // Fork setIssueSourcePreference: any click writes the explicit pin and
  // the list refetches from the chosen remote's repo (the load effect
  // depends on issueSourcePreference).
  const handleSelectIssueSource = useCallback(
    (next: IssueSourcePreference) => {
      if (projectId === null) return;
      saveIssueSourcePreference(projectId, next);
      setIssueSourcePreference(next);
      setPage(1);
      setFurthestPage(1);
    },
    [projectId],
  );

  // Reloads the list whenever the project, kind, applied query (which
  // carries the daemon state), page or refresh nonce changes. A late
  // response for an older window is dropped, never rendered. Success
  // feeds the module result cache so a tab switch back skips the
  // skeleton; the default query stays unfiltered and keeps the daemon's
  // cheap one-window probe (see tasks_rpc do_tasks_list).
  useEffect(() => {
    if (projectId === null) {
      // #353 fork parity (runTaskPageGitHubLandingRefresh): with zero repos
      // selected the fork's fetch effect early-returns and clears its
      // loading flags, so the page settles into the "No project sources
      // selected" empty state instead of skeletoning forever.
      setWorkItems([]);
      setRepo(null);
      setTasksError(null);
      setGithubUnavailable(false);
      setListPhase("ready");
      return;
    }
    let cancelled = false;
    setListPhase("loading");
    setStartError(null);
    const state = tasksDaemonState;
    const kind = githubTaskKind;
    const daemonQuery = projectTasksDaemonQuery(appliedTaskSearch);
    const source = issueSourcePreference ?? "auto";
    // Stale-while-revalidate (#238): a visited request paints its last
    // rows instantly (kind/project/page switches back never re-skeleton)
    // while the fetch below revalidates underneath.
    const seed = readTasksPageCache({ projectId, kind, state, query: daemonQuery, page, source });
    if (seed) {
      setWorkItems(seed.workItems);
      setRepo(seed.repo);
      setHasNextPage(seed.hasNextPage);
      setFurthestPage((current) => Math.max(current, seed.furthestPage));
    }
    void bridge
      .tasksList({
        projectId,
        state,
        query: daemonQuery,
        page,
        perPage: TASKS_PAGE_SIZE,
        mode: kind,
        source: issueSourcePreference,
      })
      .then((result) => {
        if (cancelled) return;
        setLoadingTargetPage(null);
        if (!result.ok) {
          setWorkItems([]);
          setListPhase("error");
          setTasksError(result.error.message);
          setGithubUnavailable(
            result.error.code === "gh_unavailable" ||
              result.error.code === "gh_unauthenticated",
          );
          return;
        }
        setListPhase("ready");
        setTasksError(null);
        setGithubUnavailable(false);
        setRepo(result.result.repo);
        const nextItems =
          kind === "pulls"
            ? (result.result.pulls ?? []).map((pull) => toPullWorkItem(pull, projectId))
            : result.result.issues.map((issue) => toWorkItem(issue, projectId));
        setWorkItems(nextItems);
        setHasNextPage(result.result.hasNextPage);
        setFurthestPage((current) => Math.max(current, result.result.page));
        const cachedResult = {
          repo: result.result.repo,
          workItems: nextItems,
          hasNextPage: result.result.hasNextPage,
          furthestPage: result.result.page,
        };
        const cacheKey = { projectId, kind, state, query: daemonQuery, page, source };
        writeTasksPageCache(cacheKey, cachedResult);
        // Persist for the next restart's instant paint; the mount above
        // revalidates on every open, so this seed never serves stale rows
        // past the refresh.
        writeTasksPageSeed(cacheKey, cachedResult);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingTargetPage(null);
          setListPhase("error");
          setTasksError(
            kind === "pulls" ? "Could not load pull requests." : "Could not load issues.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectId, githubTaskKind, tasksDaemonState, appliedTaskSearch, page, refreshNonce, issueSourcePreference]);

  // Why: the pagination bar speaks 0-based pages (source contract); the
  // daemon RPC is 1-based, so the adapter converts at the boundary.
  const handleLoadPage = useCallback((targetPage: number) => {
    setLoadingTargetPage(targetPage + 1);
    setPage(targetPage + 1);
  }, []);

  const handleRefreshGithubTasks = useCallback(() => {
    refreshGroups();
    refreshLinks();
    setRefreshNonce((nonce) => nonce + 1);
  }, [refreshGroups, refreshLinks]);

  // Source use-task-page-search-actions: typing detaches the view from any
  // preset (the debounce effect above still commits the draft per key).
  const handleTaskSearchChange = useCallback((_value: string) => {
    setActiveTaskPreset(null);
  }, []);

  // Source preset click: the pill fully determines the query (and through
  // it the derived daemon state). A refresh is forced even when the query
  // is unchanged so stale rows never read as if the filter did nothing.
  const handleSelectTaskPreset = useCallback((preset: GitHubTaskPresetId) => {
    const query = getGitHubTaskPresetQuery(preset);
    setTaskSearchInput(query);
    setAppliedTaskSearch(query);
    setActiveTaskPreset(preset);
    setPage(1);
    setFurthestPage(1);
    setRefreshNonce((nonce) => nonce + 1);
  }, []);

  // Source handleResetGithubTaskSearch: Clear restores the kind default —
  // query and pill — never a bare box. The default carries is:open, so the
  // derived daemon state lands back on open with no extra control.
  const handleResetGithubTaskSearch = useCallback(() => {
    setTaskSearchInput(getGitHubDefaultQuery(githubTaskKind));
    setAppliedTaskSearch(getGitHubDefaultQuery(githubTaskKind));
    setActiveTaskPreset(getGitHubDefaultPreset(githubTaskKind));
    setPage(1);
    setFurthestPage(1);
  }, [githubTaskKind]);

  // Selecting a row keeps the journey-J6 behavior: start a worktree for
  // the issue or PR (idempotent on the daemon), refresh the #n badge, then
  // open the worktree's terminal. PR starts check out the PR head branch.
  const handleStartWorkItem = useCallback(
    (item: TaskPageWorkItem) => {
      if (projectId === null || startBusyNumber !== null) return;
      setStartBusyNumber(item.number);
      setStartError(null);
      void bridge
        .tasksStart({ projectId, number: item.number, mode: githubTaskKind, source: issueSourcePreference })
        .then((result) => {
          if (!result.ok) {
            setStartError(result.error.message);
            return;
          }
          refreshLinks();
          onOpenTerminal(result.result.worktree.workspaceId);
        })
        .catch(() => {
          setStartError("Could not start the task.");
        })
        .finally(() => {
          setStartBusyNumber(null);
        });
    },
    [bridge, projectId, startBusyNumber, refreshLinks, onOpenTerminal, githubTaskKind, issueSourcePreference],
  );

  const selectedRepo = selectedRepos[0] ?? null;
  const githubEmptyState = getRepoBackedTaskEmptyState({
    provider: "github",
    selectedRepoCount: selectedRepos.length,
  });
  const tasksLoading = listPhase === "loading";
  const showGitHubTaskSkeletons = tasksLoading && workItems.length === 0;
  // Why: the daemon reports has-next instead of a total, so the advertised
  // page count is the furthest page proven reachable (plus one while a next
  // page exists) — exactly enough for the source's windowed page numbers.
  const totalPages = hasNextPage ? Math.max(furthestPage, page + 1) : Math.max(1, furthestPage);

  const model: TaskPageModel = {
    taskSource,
    visibleSourceOptions,
    taskSourceAvailabilityNoticeByProvider: {},
    // Fork parity (#238): the pill target is the repo identity
    // (owner/repo slug) like the source's provider-identity label — the
    // project display name is only the pre-resolve fallback. The Jira
    // branch is the fork's account-backed summary
    // (task-source-context-summary.ts getAccountBackedTaskSourceSummary):
    // Jira · Local · <site displayName|siteUrl|Current account>.
    taskSourceContextSummary:
      taskSource === "jira"
        ? {
            label: [
              "Jira",
              "Local",
              selectedJiraSite?.displayName ??
                selectedJiraSite?.siteUrl ??
                "Current account",
            ].join(" · "),
            title: [
              "Jira source",
              "Host: Local",
              `Account: ${selectedJiraSite?.displayName ?? selectedJiraSite?.siteUrl ?? "Current account"}`,
            ].join(" · "),
          }
        : {
            label: ["GitHub", "Local", repo ?? selectedRepo?.name ?? "No project"].join(" · "),
            title: ["GitHub source", repo ? `Source: ${repo}` : null]
              .filter(Boolean)
              .join(" · "),
          },
    closeTaskPage: () => onClose?.(),
    taskSourceAvailabilityNotice: null,
    taskPageListChromeHidden: false,
    taskPickerRepos,
    repoSelection,
    setRepoSelection: (next) => {
      const id = next.values().next().value;
      if (typeof id === "string") {
        setPage(1);
        setFurthestPage(1);
        setProjectId(id);
      }
    },
    selectedGitHubRepoExternalLink:
      selectedRepo && repo
        ? { url: `https://github.com/${repo}`, label: repo }
        : null,
    // Filing stays on GitHub (no create RPC): the button opens this URL
    // in the system browser. Null until the daemon resolves the slug.
    newGitHubIssueUrl: selectedRepo && repo ? buildNewGitHubIssueUrl(repo) : null,
    openExternal:
      typeof window === "undefined" ? null : windowShellOpenExternal(window.drogon),
    githubMode: "items",
    githubTaskKind,
    // Source handleSelectGithubTaskKind: switching kinds always lands on
    // the kind's default preset view (query and pill; the default query
    // carries is:open, so the derived state follows).
    onSelectGithubTaskKind: (kind) => {
      setPage(1);
      setFurthestPage(1);
      setGithubTaskKind(kind);
      setTaskSearchInput(getGitHubDefaultQuery(kind));
      setAppliedTaskSearch(getGitHubDefaultQuery(kind));
      setActiveTaskPreset(getGitHubDefaultPreset(kind));
    },
    githubModeButtons: getGitHubModeButtons(),
    showPRManagementColumns: githubTaskKind === "pulls",
    activeTaskPreset,
    onSelectTaskPreset: handleSelectTaskPreset,
    taskSearchInput,
    setTaskSearchInput,
    appliedTaskSearch,
    handleTaskSearchChange,
    handleResetGithubTaskSearch,
    handleRefreshGithubTasks,
    githubTasksBusy: tasksLoading || loadingTargetPage !== null,
    selectedRepos,
    repoMap,
    filteredWorkItems: workItems,
    taskLinks,
    githubEmptyState,
    tasksLoading,
    tasksError: startError ?? tasksError,
    githubUnavailable,
    showGitHubTaskSkeletons,
    githubTaskGridClass:
      githubTaskKind === "pulls" ? GITHUB_PR_TASK_GRID_CLASS : GITHUB_TASK_GRID_CLASS,
    issueSourceOrigin:
      issueSourceTopology?.projectId === projectId ? issueSourceTopology.origin : null,
    issueSourceUpstream:
      issueSourceTopology?.projectId === projectId ? issueSourceTopology.upstream : null,
    issueSourcePreference,
    onSelectIssueSource: handleSelectIssueSource,
    currentPage: page - 1,
    totalPages,
    loadingTargetPage: loadingTargetPage === null ? null : loadingTargetPage - 1,
    handleLoadPage,
    handleStartWorkItem,
    startBusyNumber,
    githubListScrollRef,

    // R17-B: the Jira source surface.
    onSelectTaskSource,
    hideTaskSource,
    jiraStatus,
    jiraStatusReady,
    jiraConnected,
    jiraSites,
    selectedJiraSiteId,
    onSelectJiraSite,
    jiraConnectOpen,
    setJiraConnectOpen,
    refreshJiraStatus,
    jiraPresets: getJiraPresets(),
    jiraLoading: jiraList.jiraLoading,
    jiraSearchInput: jiraList.jiraSearchInput,
    setJiraSearchInput: jiraList.setJiraSearchInput,
    setAppliedJiraSearch: jiraList.setAppliedJiraSearch,
    activeJiraPreset: jiraList.activeJiraPreset,
    onSelectJiraPreset,
    handleRefreshJiraIssues: jiraList.handleRefreshJiraIssues,
    jiraProjectsLoading: jiraList.jiraProjectsLoading,
    sortedAvailableJiraProjects: jiraList.availableJiraProjects,
    onOpenNewJiraIssue,
    jiraIssues: jiraList.jiraIssues,
    jiraError: jiraList.jiraError,
    jiraErrorDetailsOpen: jiraList.jiraErrorDetailsOpen,
    setJiraErrorDetailsOpen: jiraList.setJiraErrorDetailsOpen,
    jiraOrderBy: jiraList.jiraOrderBy,
    jiraOrderDirection: jiraList.jiraOrderDirection,
    handleJiraSort: jiraList.handleJiraSort,
    sortedJiraIssues: jiraList.sortedJiraIssues,
    selectedJiraIssue,
    openJiraDetailPage,
    closeJiraDetailPage,
    handleUseJiraItem,
    jiraWorkspaceBridge: jira,
    jiraWorkspaceSiteId: selectedJiraSiteId,
    openJiraIssueUrl: openJiraIssueUrlOpener,
    writeJiraClipboardText: writeJiraClipboardTextOpener,
    onJiraIssuePatched,
    jiraCreationDialog,
  };

  return <TaskPageSurface model={model} />;
}

/** Binds the real page through the route-panel-contract boundary. */
export function createTasksPanelDescriptor(host: TasksPageHost): TasksPanelDescriptor {
  return {
    id: TASKS_ROUTE_ID,
    title: TASKS_TITLE,
    component: () => (
      <TasksPage
        bridge={host.bridge}
        loadGroups={host.loadGroups}
        onOpenTerminal={host.onOpenTerminal}
        onClose={host.onClose}
        jiraBridge={host.jiraBridge}
      />
    ),
    capability: TASKS_CAPABILITY,
  };
}
