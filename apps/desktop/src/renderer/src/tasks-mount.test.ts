import { describe, expect, test } from "vitest";
import {
  TASKS_ROUTE_ID,
  createGatedTasksBridge,
  createGatedTasksProjectBridge,
  isTasksAvailable,
  isTasksProjectsAvailable,
  registerTasksRoute,
  windowTasksBridge,
} from "./tasks-mount";
import { createRouteRegistry, routeId } from "./route-panel-contract";
import { TASKS_CAPABILITY } from "../../shared/tasks-contract";

const okBridge = {
  tasksList: async () => ({ ok: true as const, result: { repo: "o/r", issues: [] } }),
  tasksShow: async () => ({
    ok: true as const,
    result: {
      issue: {
        number: 1,
        title: "t",
        state: "open" as const,
        labels: [],
        assignees: [],
        updatedAt: "",
        url: "https://github.com/o/r/issues/1",
        body: null,
      },
    },
  }),
  tasksStart: async () => ({
    ok: true as const,
    result: {
      issueNumber: 1,
      worktree: {
        id: "w",
        projectId: "p",
        workspaceId: "ws",
        path: "/w",
        branch: "issue-1-t",
        head: "abc",
        baseRef: null,
        createdAt: "",
      },
      link: {
        projectId: "p",
        issueNumber: 1,
        worktreeId: "w",
        branch: "issue-1-t",
        createdAt: "",
      },
    },
  }),
  tasksLinks: async () => ({ ok: true as const, result: { links: [] } }),
  tasksProjects: async () => ({ ok: true as const, result: { projects: [] } }),
  tasksWorktrees: async () => ({ ok: true as const, result: { worktrees: [] } }),
};

describe("tasks mount", () => {
  test("route id and capability gate match the service contract", () => {
    expect(String(TASKS_ROUTE_ID)).toBe("tasks");
    expect(TASKS_CAPABILITY).toBe("tasks.v1");
    expect(isTasksAvailable(["tasks.v1"])).toBe(true);
    expect(isTasksAvailable(["files.v1"])).toBe(false);
  });

  test("gated bridge refuses every method while withheld", async () => {
    const gated = createGatedTasksBridge(okBridge, () => false);
    for (const result of [
      await gated.tasksList({ projectId: "p" }),
      await gated.tasksShow({ projectId: "p", number: 1 }),
      await gated.tasksStart({ projectId: "p", number: 1 }),
      await gated.tasksLinks({ projectId: "p" }),
      await gated.tasksProjects(),
      await gated.tasksWorktrees({}),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("unsupported_capability");
    }
    const allowed = createGatedTasksBridge(okBridge, () => true);
    expect((await allowed.tasksLinks({ projectId: "p" })).ok).toBe(true);
  });

  test("project bridge adapts the tasks namespace onto project methods", async () => {
    expect(isTasksProjectsAvailable(["project.v1", "worktree.v1"])).toBe(true);
    expect(isTasksProjectsAvailable(["project.v1"])).toBe(false);
    const adapted = createGatedTasksProjectBridge(okBridge, () => true);
    const projects = await adapted.projectList!();
    expect(projects.ok).toBe(true);
    const trees = await adapted.worktreeList!({});
    expect(trees.ok).toBe(true);
    const withheld = createGatedTasksProjectBridge(okBridge, () => false);
    const refused = await withheld.projectList!();
    expect(refused.ok).toBe(false);
  });

  test("registers the tasks route on the shared registry", () => {
    const registry = registerTasksRoute(
      createRouteRegistry({
        capabilities: [TASKS_CAPABILITY],
        fallbackId: routeId("x"),
      }),
      okBridge,
      { loadGroups: () => [], onOpenTerminal: () => {} },
    );
    expect(registry).toBeDefined();
  });

  test("window bridge reads the granted namespace", () => {
    const tasks = { tasksList: () => {} };
    (globalThis as { window: unknown }).window = {
      drogon: { tasks },
    };
    expect(windowTasksBridge()).toBe(tasks);
    delete (globalThis as { window?: unknown }).window;
  });
});
