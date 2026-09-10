// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. The Linear source journey through
   the real Tasks page: the connect prompt renders while disconnected, a
   connected profile lists the local fixture issues, and Start drives the
   durable project bridge (worktreeCreate, then worktreeLinkIssue) before
   opening the new workspace's terminal. No network anywhere. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "./ui/tooltip";
import { TasksPage, clearTasksPageResultCache } from "./TasksPage";
import {
  requestTaskSourceNavigation,
  resetTaskSourceNavigation,
} from "./task-source-navigation";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import { jiraSurfaceRefusedBridge } from "./jira/jira-surface-defaults";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  connectLinear,
  LINEAR_CONNECTION_STORAGE_KEY,
} from "./linear/linear-connection";
import { clearLinearStartCoalescing } from "./linear/linear-start";

afterEach(() => {
  cleanup();
  clearTasksPageResultCache();
  clearLinearStartCoalescing();
  resetTaskSourceNavigation();
  localStorage.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).drogon;
});

beforeEach(() => {
  localStorage.clear();
});

function fakeTasksBridge(): TasksBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: { code: "x", message: "x", retryable: false },
    });
  return {
    tasksList: () =>
      Promise.resolve({
        ok: true as const,
        result: { repo: "example/repo", issues: [], page: 1, perPage: 36, hasNextPage: false },
      }),
    tasksShow: refused,
    tasksStart: refused,
    tasksLinks: () =>
      Promise.resolve({ ok: true as const, result: { links: [] } }),
    tasksRemotes: () =>
      Promise.resolve({ ok: true as const, result: {} }),
    tasksProjects: () =>
      Promise.resolve({ ok: true as const, result: { projects: [] } }),
    tasksWorktrees: () =>
      Promise.resolve({ ok: true as const, result: { worktrees: [] } }),
  };
}

function groups(): ProjectGroup[] {
  return [
    {
      project: {
        id: "p1",
        hostId: "host-1",
        path: "/repo",
        name: "repo",
        kind: "git",
        defaultBaseRef: "main",
      },
      worktrees: [
        {
          id: "wt-existing",
          projectId: "p1",
          workspaceId: "ws-existing",
          path: "/repo/wt-existing",
          branch: "main",
          head: "abc",
          baseRef: null,
          createdAt: "2026-09-06T12:00:00Z",
        },
      ],
    } as unknown as ProjectGroup,
  ];
}

function stubProjectBridge(hooks: {
  created?: (worktreeId: string) => void;
  links?: () => Array<{
    worktreeId: string;
    provider: "linear";
    identifier: string;
    title: string;
    siteId: null;
    url: string;
    stateName: string;
    labels: string[];
  }>;
}) {
  const calls = { create: [] as unknown[], link: [] as unknown[], unlink: [] as unknown[] };
  const createdId = "wt-1";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).drogon = {
    project: {
      worktreeCreate: vi.fn(async (input: { projectId: string; name: string }) => {
        calls.create.push(input);
        hooks.created?.(createdId);
        return {
          ok: true as const,
          result: {
            id: createdId,
            projectId: input.projectId,
            workspaceId: "ws-1",
            path: `/repo/${createdId}`,
            branch: input.name,
            head: "abc",
            baseRef: null,
            title: null,
            createdAt: "2026-09-06T12:00:00Z",
          },
        };
      }),
      worktreeLinkIssue: vi.fn(
        async (input: { worktreeId: string; issue: { identifier: string } }) => {
          calls.link.push(input);
          const issue = input.issue as {
            identifier: string;
            title: string;
            siteId: null;
            url: string;
            stateName: string;
            labels: string[];
          };
          return {
            ok: true as const,
            result: { worktreeId: input.worktreeId, provider: "linear", ...issue },
          };
        },
      ),
      worktreeUnlinkIssue: vi.fn(async (input: { worktreeId: string }) => {
        calls.unlink.push(input);
        return {
          ok: true as const,
          result: { worktreeId: input.worktreeId, provider: "linear", removed: true },
        };
      }),
      worktreeIssueLinks: vi.fn(async () => ({
        ok: true as const,
        result: { links: hooks.links?.() ?? [] },
      })),
    },
  };
  return calls;
}

function renderLinear(onOpenTerminal: (workspaceId: string) => void = () => {}) {
  requestTaskSourceNavigation("linear");
  return render(
    <TooltipProvider>
      <TasksPage
        bridge={fakeTasksBridge()}
        loadGroups={groups}
        onOpenTerminal={onOpenTerminal}
        jiraBridge={jiraSurfaceRefusedBridge()}
      />
    </TooltipProvider>,
  );
}

describe("TasksPage Linear source", () => {
  test("disconnected profiles get the connect prompt, never a list", async () => {
    stubProjectBridge({});
    renderLinear();
    expect(await screen.findByRole("button", { name: "Connect Linear" })).toBeTruthy();
    expect(screen.queryByText("ENG-123")).toBeNull();
  });

  test("connected profiles list the local fixture issues", async () => {
    connectLinear("lin_api_test");
    stubProjectBridge({});
    renderLinear();
    expect(await screen.findByText("ENG-123")).toBeTruthy();
    expect(screen.getByText("ENG-124")).toBeTruthy();
    expect(screen.getByLabelText("Filter Linear issues")).toBeTruthy();
  });

  test("Start creates the worktree, links the issue, then opens its terminal", async () => {
    connectLinear("lin_api_test");
    const calls = stubProjectBridge({});
    const onOpenTerminal = vi.fn();
    renderLinear(onOpenTerminal);
    const start = await screen.findByLabelText("Start workspace from ENG-123");
    fireEvent.click(start);
    await waitFor(() => expect(calls.create).toHaveLength(1));
    await waitFor(() => expect(calls.link).toHaveLength(1));
    const created = calls.create[0] as { projectId: string; name: string };
    expect(created.projectId).toBe("p1");
    expect(created.name).toContain("eng-123");
    const linked = calls.link[0] as { worktreeId: string; issue: { identifier: string } };
    expect(linked.worktreeId).toBe("wt-1");
    expect(linked.issue.identifier).toBe("ENG-123");
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("ws-1"));
  });

  test("a linked issue offers Open and Unlink over the durable rows", async () => {
    connectLinear("lin_api_test");
    stubProjectBridge({
      links: () => [
        {
          worktreeId: "wt-existing",
          provider: "linear",
          identifier: "ENG-123",
          title: "Linked Linear work",
          siteId: null,
          url: "https://linear.app/drogon/issue/ENG-123",
          stateName: "In Progress",
          labels: [],
        },
      ],
    });
    const onOpenTerminal = vi.fn();
    renderLinear(onOpenTerminal);
    const open = await screen.findByLabelText("Open workspace attached to ENG-123");
    fireEvent.click(open);
    expect(onOpenTerminal).toHaveBeenCalledWith("ws-existing");
    expect(screen.getByLabelText("Unlink ENG-123")).toBeTruthy();
  });

  test("the source option and the API key round-trip through storage", () => {
    connectLinear("lin_api_test");
    expect(
      JSON.parse(localStorage.getItem(LINEAR_CONNECTION_STORAGE_KEY) ?? "{}").apiKey,
    ).toBe("lin_api_test");
  });
});
