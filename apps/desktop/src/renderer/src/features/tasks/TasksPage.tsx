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
  type TaskIssueState,
  type TaskLink,
  type TasksBridge,
} from "../../../../shared/tasks-contract";
import type { Session } from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { TaskPageSurface } from "./task-page/Surface";
import { getRepoBackedTaskEmptyState } from "./task-page-empty-state";
import { toWorkItem } from "./task-page-model";
import type {
  TaskPageModel,
  TaskPageWorkItem,
  TaskPickerRepo,
} from "./task-page-model";
import { GITHUB_TASK_GRID_CLASS, TASK_SEARCH_DEBOUNCE_MS } from "./task-page-source-context";
import type { GitHubStateFilterId } from "./task-page-localized-options";
import { getSourceOptions } from "./task-page-localized-options";

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

export function TasksPage({ bridge, loadGroups, onOpenTerminal, onClose }: TasksPageHost) {
  const [groups, setGroups] = useState<ProjectGroup[]>(() => loadGroups());
  const [projectId, setProjectId] = useState<string | null>(() =>
    pickDefaultProject(loadGroups()),
  );
  const [stateFilter, setStateFilter] = useState<GitHubStateFilterId>("open");
  const [taskSearchInput, setTaskSearchInput] = useState("");
  const [appliedTaskSearch, setAppliedTaskSearch] = useState("");
  const [workItems, setWorkItems] = useState<TaskPageWorkItem[]>([]);
  const [repo, setRepo] = useState<string | null>(null);
  const [listPhase, setListPhase] = useState<ListPhase>("loading");
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [githubUnavailable, setGithubUnavailable] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [furthestPage, setFurthestPage] = useState(1);
  const [loadingTargetPage, setLoadingTargetPage] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [taskLinks, setTaskLinks] = useState<TaskLink[]>([]);
  const [startBusyNumber, setStartBusyNumber] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const githubListScrollRef = useRef<HTMLDivElement | null>(null);

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

  // Reloads the list whenever the project, state, applied query, page or
  // refresh nonce changes. A late response for an older window is dropped,
  // never rendered.
  useEffect(() => {
    if (projectId === null) {
      setWorkItems([]);
      setListPhase("loading");
      return;
    }
    let cancelled = false;
    setListPhase("loading");
    setStartError(null);
    const state: TaskIssueState = stateFilter;
    void bridge
      .tasksList({
        projectId,
        state,
        query: appliedTaskSearch.trim() || undefined,
        page,
        perPage: TASKS_PAGE_SIZE,
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
        setWorkItems(result.result.issues.map((issue) => toWorkItem(issue, projectId)));
        setHasNextPage(result.result.hasNextPage);
        setFurthestPage((current) => Math.max(current, result.result.page));
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingTargetPage(null);
          setListPhase("error");
          setTasksError("Could not load issues.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectId, stateFilter, appliedTaskSearch, page, refreshNonce]);

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

  const handleTaskSearchChange = useCallback((_value: string) => {
    // The debounce effect above commits the draft; nothing to do per key.
  }, []);

  const handleResetGithubTaskSearch = useCallback(() => {
    setTaskSearchInput("");
    setAppliedTaskSearch("");
    setPage(1);
  }, []);

  // Selecting a row keeps the journey-J6 behavior: start a worktree for
  // the issue (idempotent on the daemon), refresh the #n badge, then open
  // the worktree's terminal.
  const handleStartWorkItem = useCallback(
    (item: TaskPageWorkItem) => {
      if (projectId === null || startBusyNumber !== null) return;
      setStartBusyNumber(item.number);
      setStartError(null);
      void bridge
        .tasksStart({ projectId, number: item.number })
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
    [bridge, projectId, startBusyNumber, refreshLinks, onOpenTerminal],
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
    taskSource: "github",
    visibleSourceOptions: getSourceOptions(),
    taskSourceAvailabilityNoticeByProvider: {},
    taskSourceContextSummary: {
      label: ["GitHub", "Local", selectedRepo?.name ?? repo ?? "No project"].join(" · "),
      title: ["GitHub source", repo ? `Source: ${repo}` : null].filter(Boolean).join(" · "),
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
    githubMode: "items",
    stateFilter,
    onStateFilter: (state) => {
      setPage(1);
      setFurthestPage(1);
      setStateFilter(state);
    },
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
    githubTaskGridClass: GITHUB_TASK_GRID_CLASS,
    currentPage: page - 1,
    totalPages,
    loadingTargetPage: loadingTargetPage === null ? null : loadingTargetPage - 1,
    handleLoadPage,
    handleStartWorkItem,
    startBusyNumber,
    githubListScrollRef,
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
      />
    ),
    capability: TASKS_CAPABILITY,
  };
}
