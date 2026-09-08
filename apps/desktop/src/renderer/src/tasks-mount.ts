// Mount adapter for the Tasks page (features/tasks, journey J6). Binds
// the real factory through the route-panel-contract boundary, mirroring
// changes-mount.ts. Registers nothing on import.

import {
  TASKS_CAPABILITY,
  type TasksBridge,
} from "../../shared/tasks-contract";
import {
  createTasksPanelDescriptor,
  TASKS_ROUTE_ID as FEATURE_TASKS_ROUTE_ID,
  isTasksAvailable,
  type TasksPageHost,
} from "./features/tasks";
import {
  PROJECT_CAPABILITY,
  WORKTREE_CAPABILITY,
  type ProjectRpcBridge,
} from "./features/shell/project-adapter";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

/** Branded form of the feature route id; empty ids throw at import. */
export const TASKS_ROUTE_ID = routeId(FEATURE_TASKS_ROUTE_ID);

export { TASKS_CAPABILITY, isTasksAvailable };

/**
 * The granted `window.drogon.tasks.*` namespace. DesktopBridge
 * (coordinator-owned) does not declare it yet, so the cast lives here —
 * one place — rather than at every call site. Follow-up for the
 * coordinator: declare `tasks: TasksBridge` on DesktopBridge and delete
 * this helper.
 */
export function windowTasksBridge(): TasksBridge {
  return (window.drogon as unknown as { tasks: TasksBridge }).tasks;
}

/**
 * Fail-closed capability gate around a TasksBridge. Every call evaluates
 * isAllowed at call time: when the live service withholds tasks.v1 the
 * call is refused locally (never reaching the service) with an explicit
 * retryable error.
 */
export function createGatedTasksBridge(
  source: TasksBridge,
  isAllowed: () => boolean,
): TasksBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "tasks.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return {
    tasksList: (input) => (isAllowed() ? source.tasksList(input) : refused()),
    tasksShow: (input) => (isAllowed() ? source.tasksShow(input) : refused()),
    tasksStart: (input) =>
      isAllowed() ? source.tasksStart(input) : refused(),
    tasksLinks: (input) =>
      isAllowed() ? source.tasksLinks(input) : refused(),
    tasksRemotes: (input) =>
      isAllowed() ? source.tasksRemotes(input) : refused(),
    tasksProjects: () => (isAllowed() ? source.tasksProjects() : refused()),
    tasksWorktrees: (input) =>
      isAllowed() ? source.tasksWorktrees(input) : refused(),
  };
}

/** True exactly when the live service advertises the project RPCs. */
export function isTasksProjectsAvailable(
  capabilities: readonly string[],
): boolean {
  return (
    capabilities.includes(PROJECT_CAPABILITY) &&
    capabilities.includes(WORKTREE_CAPABILITY)
  );
}

/**
 * Interim project bridge (journey J6): adapts the tasks namespaced
 * project/worktree passthroughs onto the sidebar's ProjectRpcBridge until
 * the coordinator lands the first-class project bridge. Gated on
 * project.v1/worktree.v1, never on tasks.v1.
 */
export function createGatedTasksProjectBridge(
  source: TasksBridge,
  isAllowed: () => boolean,
): ProjectRpcBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "project.v1/worktree.v1 capabilities are not advertised",
        retryable: true,
      },
    });
  return {
    projectList: () =>
      isAllowed() ? source.tasksProjects() : refused(),
    worktreeList: (input) =>
      isAllowed()
        ? source.tasksWorktrees({ projectId: input.projectId })
        : refused(),
  };
}

/** Registers the real Tasks route (capability-gated on tasks.v1). */
export function registerTasksRoute(
  registry: RouteRegistry,
  bridge: TasksBridge,
  host: Omit<TasksPageHost, "bridge">,
): RouteRegistry {
  const descriptor = createTasksPanelDescriptor({ bridge, ...host });
  const adapted: PanelDescriptor = {
    ...descriptor,
    id: routeId(descriptor.id),
  };
  return registerRoute(registry, adapted);
}
