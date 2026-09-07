/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/task-page/TaskPage.tsx,
   task-page/github/List.tsx and task-page/github/Filters.tsx (adapter:
   Orca's zustand multi-provider page becomes a props-driven GitHub-only
   page over this repo's tasks.* RPCs; no store, no provider abstraction
   beyond GitHub). */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  TASKS_CAPABILITY,
  type TaskIssue,
  type TaskIssueState,
  type TasksBridge,
} from "../../../../shared/tasks-contract";
import type { Session } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { ProjectGroup } from "../shell/project-adapter";
import { relativeActivityTime } from "../shell/project-adapter";
import {
  collectAssignees,
  collectLabels,
  filterIssues,
  startDisabledReason,
} from "./issue-filters";
import { refreshWorktreeIssueLinks } from "./issue-links";

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

type ListLoad =
  | { phase: "loading" }
  | { phase: "ready"; repo: string }
  | { phase: "error"; message: string };

type DetailLoad =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export type TasksViewData = {
  projects: { id: string; name: string; kind: "git" | "folder" }[];
  projectId: string | null;
  projectKind: "git" | "folder" | null;
  listState: "open" | "closed";
  query: string;
  activeLabel: string | null;
  activeAssignee: string | null;
  labels: string[];
  assignees: string[];
  issues: TaskIssue[];
  list: ListLoad;
  selectedNumber: number | null;
  detail: TaskIssue | null;
  detailLoad: DetailLoad;
  startBusy: boolean;
  startError: string | null;
  startDisabledReason: string | null;
};

export type TasksViewCallbacks = {
  onSelectProject: (id: string) => void;
  onListState: (state: "open" | "closed") => void;
  onQuery: (query: string) => void;
  onToggleLabel: (label: string) => void;
  onToggleAssignee: (assignee: string) => void;
  onSelectIssue: (number: number | null) => void;
  onStart: (number: number) => void;
  onRefresh: () => void;
};

function issueLabels(issue: TaskIssue): string {
  return issue.labels.map((label) => label.name).join(", ");
}

function issueAssignees(issue: TaskIssue): string {
  if (issue.assignees.length === 0) return "Unassigned";
  if (issue.assignees.length === 1) return issue.assignees[0] ?? "";
  return `${issue.assignees[0]} +${issue.assignees.length - 1}`;
}

export function TasksView({
  data,
  callbacks,
}: {
  data: TasksViewData;
  callbacks: TasksViewCallbacks;
}) {
  const project = data.projects.find((item) => item.id === data.projectId);
  return (
    <div className="tasks-page" aria-label="Tasks">
      <div className="tasks-toolbar">
        <label className="tasks-field">
          <span>Project</span>
          <select
            aria-label="Project"
            value={data.projectId ?? ""}
            onChange={(event) => callbacks.onSelectProject(event.target.value)}
          >
            {data.projects.length === 0 && <option value="">No projects</option>}
            {data.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.kind === "folder" ? " (folder)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="tasks-field">
          <span>State</span>
          <select
            aria-label="Issue state"
            value={data.listState}
            onChange={(event) =>
              callbacks.onListState(
                event.target.value === "closed" ? "closed" : "open",
              )
            }
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <Input
          aria-label="Search GitHub issues"
          placeholder="Search GitHub issues..."
          value={data.query}
          onChange={(event) => callbacks.onQuery(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={callbacks.onRefresh}>
          Refresh
        </Button>
      </div>
      {(data.labels.length > 0 || data.assignees.length > 0) && (
        <div className="tasks-chips">
          {data.labels.map((label) => (
            <button
              key={label}
              type="button"
              className="tasks-chip"
              data-active={data.activeLabel === label}
              aria-pressed={data.activeLabel === label}
              onClick={() => callbacks.onToggleLabel(label)}
            >
              {label}
            </button>
          ))}
          {data.assignees.map((assignee) => (
            <button
              key={assignee}
              type="button"
              className="tasks-chip tasks-chip-assignee"
              data-active={data.activeAssignee === assignee}
              aria-pressed={data.activeAssignee === assignee}
              onClick={() => callbacks.onToggleAssignee(assignee)}
            >
              @{assignee}
            </button>
          ))}
        </div>
      )}
      <div className="tasks-columns">
        <section className="tasks-list" aria-label="Issues">
          {data.projects.length === 0 && (
            <p className="tasks-empty" role="status">
              No Git repository projects yet. Register one with{" "}
              <code>drogon-cli project add &lt;path&gt;</code>, then return
              here to list its GitHub issues.
            </p>
          )}
          {data.projectKind === "folder" && (
            <p className="tasks-empty" role="status">
              “{project?.name}” is a folder project: it has no GitHub remote,
              so there are no issues to list. Select a Git repository instead.
            </p>
          )}
          {data.list.phase === "loading" && (
            <p className="tasks-empty" role="status">
              Loading issues…
            </p>
          )}
          {data.list.phase === "error" && (
            <div className="error-banner" role="alert">
              <span>{data.list.message}</span>
              <Button size="sm" variant="outline" onClick={callbacks.onRefresh}>
                Retry
              </Button>
            </div>
          )}
          {data.list.phase === "ready" && data.issues.length === 0 && (
            <p className="tasks-empty" role="status">
              No {data.listState} issues
              {data.query || data.activeLabel || data.activeAssignee
                ? " match this filter"
                : ` in ${data.list.repo}`}
              .
            </p>
          )}
          {data.list.phase === "ready" && data.issues.length > 0 && (
            <ul className="tasks-rows">
              {data.issues.map((issue) => (
                <li key={issue.number}>
                  <button
                    type="button"
                    className="tasks-row"
                    data-current={data.selectedNumber === issue.number}
                    aria-current={
                      data.selectedNumber === issue.number ? "true" : undefined
                    }
                    onClick={() => callbacks.onSelectIssue(issue.number)}
                  >
                    <span className="tasks-row-number">#{issue.number}</span>
                    <span className="tasks-row-main">
                      <span className="tasks-row-title">{issue.title}</span>
                      <span className="tasks-row-meta">
                        {issueLabels(issue) || "no labels"} ·{" "}
                        {issueAssignees(issue)} ·{" "}
                        {relativeActivityTime(issue.updatedAt) || "updated"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tasks-detail" aria-label="Issue detail">
          {data.selectedNumber === null && (
            <p className="tasks-empty" role="status">
              Select an issue to read it and start a task.
            </p>
          )}
          {data.selectedNumber !== null && data.detailLoad.phase === "loading" && (
            <p className="tasks-empty" role="status">
              Loading issue #{data.selectedNumber}…
            </p>
          )}
          {data.selectedNumber !== null &&
            data.detailLoad.phase === "error" && (
              <div className="error-banner" role="alert">
                <span>{data.detailLoad.message}</span>
              </div>
            )}
          {data.detail !== null && (
            <article>
              <p className="tasks-detail-number">#{data.detail.number}</p>
              <h2 className="tasks-detail-title">{data.detail.title}</h2>
              <p className="tasks-detail-meta">
                {data.detail.state} · {issueLabels(data.detail) || "no labels"}{" "}
                · {issueAssignees(data.detail)} ·{" "}
                {relativeActivityTime(data.detail.updatedAt) || "updated"}
              </p>
              {data.detail.body ? (
                <pre className="tasks-detail-body">{data.detail.body}</pre>
              ) : (
                <p className="tasks-empty">This issue has no body text.</p>
              )}
              <div className="tasks-start-row">
                <Button
                  size="sm"
                  disabled={
                    data.startDisabledReason !== null || data.startBusy
                  }
                  title={data.startDisabledReason ?? "Create a worktree and open a terminal for this issue"}
                  onClick={() => callbacks.onStart(data.detail?.number ?? 0)}
                >
                  {data.startBusy ? "Starting…" : "Start task"}
                </Button>
                {data.startDisabledReason !== null && (
                  <span className="tasks-start-reason" role="status">
                    {data.startDisabledReason}
                  </span>
                )}
              </div>
              {data.startError !== null && (
                <div className="error-banner" role="alert">
                  <span>{data.startError}</span>
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => callbacks.onSelectIssue(null)}
              >
                Back to list
              </Button>
            </article>
          )}
        </section>
      </div>
    </div>
  );
}

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

export function TasksPage({ bridge, loadGroups, onOpenTerminal }: TasksPageHost) {
  const [groups, setGroups] = useState<ProjectGroup[]>(() => loadGroups());
  const [projectId, setProjectId] = useState<string | null>(() =>
    pickDefaultProject(loadGroups()),
  );
  const [listState, setListState] = useState<"open" | "closed">("open");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [activeAssignee, setActiveAssignee] = useState<string | null>(null);
  const [issues, setIssues] = useState<TaskIssue[]>([]);
  const [list, setList] = useState<ListLoad>({ phase: "loading" });
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskIssue | null>(null);
  const [detailLoad, setDetailLoad] = useState<DetailLoad>({ phase: "idle" });
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Debounces the text filter into the server-side query: typing never
  // fires a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const refreshGroups = () => {
    const next = loadGroups();
    setGroups(next);
    setProjectId((current) =>
      current && next.some((group) => group.project.id === current)
        ? current
        : pickDefaultProject(next),
    );
  };

  const projectKind =
    groups.find((group) => group.project.id === projectId)?.project.kind ??
    null;

  // Reloads the list whenever the project, state or applied query changes.
  // A late response for a previous project is dropped, never rendered.
  useEffect(() => {
    if (projectId === null || projectKind !== "git") {
      setIssues([]);
      setList({ phase: "loading" });
      return;
    }
    let cancelled = false;
    setList({ phase: "loading" });
    const state: TaskIssueState = listState;
    void bridge
      .tasksList({ projectId, state, query: appliedQuery || undefined })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setIssues([]);
          setList({ phase: "error", message: result.error.message });
          return;
        }
        setIssues(result.result.issues);
        setList({ phase: "ready", repo: result.result.repo });
      })
      .catch(() => {
        if (!cancelled)
          setList({ phase: "error", message: "Could not load issues." });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectId, projectKind, listState, appliedQuery]);

  // Loads the selected issue's body; clearing the selection clears it.
  useEffect(() => {
    if (selectedNumber === null || projectId === null) {
      setDetail(null);
      setDetailLoad({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoad({ phase: "loading" });
    const number = selectedNumber;
    void bridge
      .tasksShow({ projectId, number })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setDetailLoad({ phase: "error", message: result.error.message });
          return;
        }
        setDetail(result.result.issue);
        setDetailLoad({ phase: "ready" });
      })
      .catch(() => {
        if (!cancelled)
          setDetailLoad({ phase: "error", message: "Could not load the issue." });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, projectId, selectedNumber]);

  const visibleIssues = useMemo(
    () =>
      filterIssues(issues, "", {
        label: activeLabel,
        assignee: activeAssignee,
      }),
    [issues, activeLabel, activeAssignee],
  );

  const start = (number: number) => {
    if (projectId === null || number === 0) return;
    setStartBusy(true);
    setStartError(null);
    void bridge
      .tasksStart({ projectId, number })
      .then((result) => {
        if (!result.ok) {
          setStartError(result.error.message);
          return;
        }
        // The sidebar badge reads this store; refresh it before opening
        // the terminal so the card already shows the link.
        void refreshWorktreeIssueLinks(bridge, [projectId]).then(() => {
          onOpenTerminal(result.result.worktree.workspaceId);
        });
      })
      .catch(() => {
        setStartError("Could not start the task.");
      })
      .finally(() => {
        setStartBusy(false);
      });
  };

  const data: TasksViewData = {
    projects: servableGroups(groups).map((group) => ({
      id: group.project.id,
      name: group.project.name,
      kind: group.project.kind,
    })),
    projectId,
    projectKind,
    listState,
    query,
    activeLabel,
    activeAssignee,
    labels: collectLabels(issues),
    assignees: collectAssignees(issues),
    issues: visibleIssues,
    list,
    selectedNumber,
    detail: detail && detail.number === selectedNumber ? detail : null,
    detailLoad,
    startBusy,
    startError,
    startDisabledReason: startDisabledReason({ projectKind, busy: startBusy }),
  };
  const callbacks: TasksViewCallbacks = {
    onSelectProject: (id) => {
      setProjectId(id);
      setSelectedNumber(null);
      setActiveLabel(null);
      setActiveAssignee(null);
    },
    onListState: (state) => {
      setListState(state);
      setSelectedNumber(null);
    },
    onQuery: setQuery,
    onToggleLabel: (label) =>
      setActiveLabel((current) => (current === label ? null : label)),
    onToggleAssignee: (assignee) =>
      setActiveAssignee((current) => (current === assignee ? null : assignee)),
    onSelectIssue: setSelectedNumber,
    onStart: start,
    onRefresh: () => {
      refreshGroups();
      setSelectedNumber(null);
      setAppliedQuery(query);
    },
  };
  return <TasksView data={data} callbacks={callbacks} />;
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
      />
    ),
    capability: TASKS_CAPABILITY,
  };
}
