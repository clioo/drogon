// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. R17-B: the mounted Jira source
   surface — the issue list renders from the stubbed jira.v1 bridge, the
   provider switch preserves the fork's per-source state, the create dialog
   opens/closes, a row click opens the issue workspace sheet with its paged
   comments, and the row start button drives jira.startIssue into the
   page's terminal seam. */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "./ui/tooltip";
import { TasksPage, clearTasksPageResultCache } from "./TasksPage";
import {
  requestTaskSourceNavigation,
  resetTaskSourceNavigation,
} from "./task-source-navigation";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import type {
  JiraBridge,
  JiraComment,
  JiraIssue,
  JiraProject,
  JiraSite,
} from "../../../../shared/jira-contract";
import type { ProjectGroup } from "../shell/project-adapter";

afterEach(() => {
  cleanup();
  clearTasksPageResultCache();
  resetTaskSourceNavigation();
});

beforeEach(() => {
  localStorage.clear();
});

const SITE: JiraSite = {
  id: "site-1",
  siteUrl: "https://example.atlassian.net",
  email: "carlos@example.com",
  displayName: "Carlos",
  accountId: "acct-1",
  authType: "cloud",
};

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: "10001",
    key: "DROG-1",
    siteId: SITE.id,
    siteName: "Carlos site",
    title: "Project setup and repo bootstrap",
    url: "https://example.atlassian.net/browse/DROG-1",
    project: { id: "10000", key: "DROG", name: "Drogon" },
    issueType: { id: "10001", name: "Task" },
    status: { id: "1", name: "Backlog", categoryKey: "new", categoryName: "To Do" },
    labels: [],
    updatedAt: "2026-09-01T12:00:00Z",
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

const PROJECT: JiraProject = { id: "10000", key: "DROG", name: "Drogon" };

function commentsFixture(): JiraComment[] {
  return [
    {
      id: "90001",
      body: "First comment body",
      createdAt: "2026-09-02T10:00:00Z",
      user: { accountId: "acct-2", displayName: "Reviewer" },
    },
    {
      id: "90002",
      body: "Second comment body",
      createdAt: "2026-09-03T10:00:00Z",
      user: { accountId: "acct-1", displayName: "Carlos" },
    },
  ];
}

type JiraBridgeCalls = {
  listIssues: Array<{ filter?: string; siteId?: string }>;
  searchIssues: Array<{ jql: string }>;
  comments: Array<{ key: string }>;
  startIssue: Array<{ projectId: string; key: string }>;
};

function fakeJiraBridge(issues: JiraIssue[], calls: JiraBridgeCalls): JiraBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: { code: "x", message: "x", retryable: false },
    });
  return {
    jiraConnect: refused,
    jiraDisconnect: refused,
    jiraSelectSite: () =>
      Promise.resolve({
        ok: true as const,
        result: {
          connected: true,
          viewer: null,
          sites: [SITE],
          activeSiteId: SITE.id,
          selectedSiteId: SITE.id,
        },
      }),
    jiraStatus: () =>
      Promise.resolve({
        ok: true as const,
        result: {
          connected: true,
          viewer: { accountId: SITE.accountId, displayName: SITE.displayName, email: SITE.email },
          sites: [SITE],
          activeSiteId: SITE.id,
          selectedSiteId: SITE.id,
        },
      }),
    jiraTestConnection: refused,
    jiraSearchIssues: (input) => {
      calls.searchIssues.push({ jql: input.jql });
      return Promise.resolve({ ok: true as const, result: { issues: [] } });
    },
    jiraCancelSearchIssues: () =>
      Promise.resolve({ ok: true as const, result: { cancelled: false } }),
    jiraListIssues: (input) => {
      calls.listIssues.push({ filter: input.filter, siteId: input.siteId });
      return Promise.resolve({ ok: true as const, result: { issues } });
    },
    jiraListProjects: () =>
      Promise.resolve({ ok: true as const, result: [PROJECT] }),
    jiraListIssueTypes: () =>
      Promise.resolve({ ok: true as const, result: [{ id: "10001", name: "Task" }] }),
    jiraListCreateFields: () => Promise.resolve({ ok: true as const, result: [] }),
    jiraListPriorities: () =>
      Promise.resolve({
        ok: true as const,
        result: [{ id: "1", name: "High" }],
      }),
    jiraSearchUsers: () =>
      Promise.resolve({
        ok: true as const,
        result: [{ accountId: SITE.accountId, displayName: SITE.displayName }],
      }),
    jiraGetIssue: (input) =>
      Promise.resolve({
        ok: true as const,
        result: issues.find((candidate) => candidate.key === input.key) ?? null,
      }),
    jiraComments: (input) => {
      calls.comments.push({ key: input.key });
      return Promise.resolve({ ok: true as const, result: commentsFixture() });
    },
    jiraListTransitions: () =>
      Promise.resolve({
        ok: true as const,
        result: [
          {
            id: "11",
            name: "Start progress",
            to: { id: "2", name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" },
          },
        ],
      }),
    jiraCreateIssue: () =>
      Promise.resolve({
        ok: true as const,
        result: { ok: true as const, id: "10002", key: "DROG-2", url: "https://example.atlassian.net/browse/DROG-2" },
      }),
    jiraUpdateIssue: () =>
      Promise.resolve({ ok: true as const, result: { ok: true as const } }),
    jiraAddComment: () =>
      Promise.resolve({ ok: true as const, result: { ok: true as const, id: "90003" } }),
    jiraStartIssue: (input) => {
      calls.startIssue.push({ projectId: input.projectId, key: input.key });
      return Promise.resolve({
        ok: true as const,
        result: {
          ok: true,
          key: input.key,
          url: `https://example.atlassian.net/browse/${input.key}`,
          displayName: `${input.key} ${input.title ?? ""}`.trim(),
          seedName: "drog-1-project-setup-and-repo-bootstrap",
          worktree: {
            id: "wt-1",
            projectId: input.projectId,
            workspaceId: "ws-1",
            path: "/tmp/wt-1",
            branch: "drog-1-project-setup",
            head: "abc",
            baseRef: null,
            title: `${input.key} ${input.title ?? ""}`.trim(),
            createdAt: "2026-09-06T12:00:00Z",
          },
        },
      });
    },
  };
}

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
        result: {
          repo: "example/repo",
          issues: [
            {
              number: 7,
              title: "Fix the sidebar crash",
              state: "open",
              labels: [],
              assignees: [],
              author: "octocat",
              updatedAt: "2026-09-06T12:00:00Z",
              url: "https://github.com/example/repo/issues/7",
              body: null,
            },
          ],
          page: 1,
          perPage: 36,
          hasNextPage: false,
        },
      }),
    tasksShow: refused,
    tasksStart: refused,
    tasksLinks: () =>
      Promise.resolve({ ok: true as const, result: { links: [] } }),
    tasksRemotes: () =>
      Promise.resolve({ ok: true as const, result: { origin: "example/repo" } }),
    tasksProjects: () =>
      Promise.resolve({ ok: true as const, result: { projects: [] } }),
    tasksWorktrees: () =>
      Promise.resolve({ ok: true as const, result: { worktrees: [] } }),
  };
}

function groups(): ProjectGroup[] {
  return [
    {
      project: { id: "p1", name: "repo", kind: "git" },
      workspaces: [],
    } as unknown as ProjectGroup,
  ];
}

function renderPage(jiraBridge: JiraBridge, onOpenTerminal: (workspaceId: string) => void = () => {}) {
  return render(
    <TooltipProvider>
      <TasksPage
        bridge={fakeTasksBridge()}
        loadGroups={groups}
        onOpenTerminal={onOpenTerminal}
        jiraBridge={jiraBridge}
      />
    </TooltipProvider>,
  );
}

/** The row is a role=button div; the key renders twice (desktop + mobile
 *  spans, CSS-hidden only), so take the cell that lives inside a row. */
function rowFor(key: string): HTMLElement {
  for (const keyCell of screen.getAllByText(key)) {
    const row = keyCell.closest('[role="button"]');
    if (row instanceof HTMLElement) {
      return row;
    }
  }
  throw new Error(`no Jira row for ${key}`);
}

describe("TasksPage Jira surface (R17-B)", () => {
  test("renders the Jira issue list from the stubbed bridge (chrome + rows)", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    const issues = [
      issue(),
      issue({
        id: "10002",
        key: "DROG-2",
        title: "Wire the daemon socket",
        status: { id: "2", name: "In Progress", categoryKey: "indeterminate", categoryName: "In Progress" },
        priority: { id: "1", name: "High" },
        assignee: { accountId: "acct-1", displayName: "Carlos" },
      }),
    ];
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge(issues, calls));

    // Header chrome: the fork's "Jira issues" bar with the shown counter.
    expect(await screen.findByText("Jira issues")).not.toBeNull();
    expect(await screen.findByText("2 shown")).not.toBeNull();
    // The fork's preset pills and JQL placeholder.
    expect(screen.getByRole("button", { name: "Assigned" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reported" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "All Open" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).not.toBeNull();
    expect(
      screen.getByPlaceholderText("Jira JQL, e.g. project = ABC AND statusCategory != Done"),
    ).not.toBeNull();
    // The action buttons.
    expect(screen.getByRole("button", { name: "New Jira issue" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Refresh Jira issues" })).not.toBeNull();
    // The sort header row (fork columns).
    expect(screen.getByRole("button", { name: "Key" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Updated, descending" })).not.toBeNull();
    // Rows grouped per status section.
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(rowFor("DROG-1").textContent).toContain("Project setup and repo bootstrap");
    expect(rowFor("DROG-2").textContent).toContain("Wire the daemon socket");
    expect(rowFor("DROG-2").textContent).toContain("High");
    expect(rowFor("DROG-2").textContent).toContain("Carlos");
    expect(rowFor("DROG-1").textContent).toContain("Unassigned");
    // The default preset is the fork's 'assigned' with the site scope.
    await waitFor(() => {
      expect(calls.listIssues.length).toBeGreaterThan(0);
    });
    expect(calls.listIssues[0].filter).toBe("assigned");
    expect(calls.listIssues[0].siteId).toBe(SITE.id);
  });

  test("typing a JQL query searches verbatim; Enter commits immediately", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge([issue()], calls));
    await screen.findByText("1 shown");

    const box = screen.getByPlaceholderText(
      "Jira JQL, e.g. project = ABC AND statusCategory != Done",
    );
    fireEvent.change(box, { target: { value: "project = DROG" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => {
      expect(calls.searchIssues.some((call) => call.jql === "project = DROG")).toBe(true);
    });
    // The preset pills detach once a query is typed (fork active rule).
    expect(screen.getByRole("button", { name: "Assigned" }).getAttribute("aria-pressed")).toBeNull();
  });

  test("switching providers preserves the fork's per-source state", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge([issue()], calls));
    const jiraBox = await screen.findByPlaceholderText(
      "Jira JQL, e.g. project = ABC AND statusCategory != Done",
    );
    fireEvent.change(jiraBox, { target: { value: "project = DROG" } });

    // Switch to GitHub: the GitHub list renders, the Jira state stays alive.
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    expect(await screen.findByText("Fix the sidebar crash")).not.toBeNull();
    expect(screen.queryByText("Jira issues")).toBeNull();

    // Switch back: the typed JQL draft survived (fork state preservation).
    fireEvent.click(screen.getByRole("button", { name: "Jira" }));
    await screen.findByText("1 shown");
    expect(
      (screen.getByPlaceholderText("Jira JQL, e.g. project = ABC AND statusCategory != Done") as HTMLInputElement).value,
    ).toBe("project = DROG");
  });

  test("the create entry opens the ported IssueDialog and Cancel closes it", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge([issue()], calls));
    await screen.findByText("1 shown");

    fireEvent.click(screen.getByRole("button", { name: "New Jira issue" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New Jira issue")).not.toBeNull();
    expect(within(dialog).getByText("Creates a new issue in DROG.")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Create issue" })).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("row open shows the workspace sheet with its comments", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge([issue()], calls));
    await screen.findByText("1 shown");

    fireEvent.click(rowFor("DROG-1"));

    const sheet = await screen.findByRole("dialog");
    // The fork's sheet chrome: header title, metadata, comments, composer.
    // (The title renders twice — the accessible SheetTitle lands in a
    // VisuallyHidden node — so assert presence, not uniqueness.)
    expect(within(sheet).getAllByText("Project setup and repo bootstrap").length).toBeGreaterThan(0);
    expect(await within(sheet).findByText("First comment body")).not.toBeNull();
    expect(within(sheet).getByText("Second comment body")).not.toBeNull();
    expect(calls.comments).toContainEqual({ key: "DROG-1" });
    expect(within(sheet).getByPlaceholderText("Add a Jira comment...")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // The reconciliation effect closes the selection with the sheet.
    expect(rowFor("DROG-1").getAttribute("aria-current")).toBeNull();
  });

  test("start-from-issue drives jira.startIssue into the terminal seam", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    const onOpenTerminal = vi.fn();
    requestTaskSourceNavigation("jira");
    renderPage(fakeJiraBridge([issue()], calls), onOpenTerminal);
    await screen.findByText("1 shown");

    fireEvent.click(
      within(rowFor("DROG-1")).getByRole("button", { name: "Start workspace from DROG-1" }),
    );

    await waitFor(() => {
      expect(calls.startIssue).toContainEqual({ projectId: "p1", key: "DROG-1" });
    });
    await waitFor(() => {
      expect(onOpenTerminal).toHaveBeenCalledWith("ws-1");
    });
  });

  test("the not-connected state renders the fork's connect prompt", async () => {
    const calls: JiraBridgeCalls = { listIssues: [], searchIssues: [], comments: [], startIssue: [] };
    const disconnected: JiraBridge = {
      ...fakeJiraBridge([], calls),
      jiraStatus: () =>
        Promise.resolve({
          ok: true as const,
          result: {
            connected: false,
            viewer: null,
            sites: [],
            activeSiteId: null,
            selectedSiteId: null,
          },
        }),
    };
    requestTaskSourceNavigation("jira");
    renderPage(disconnected);

    expect(await screen.findByText("Connect your Jira site")).not.toBeNull();
    expect(
      screen.getByText("Browse, edit, create, and start work from Jira issues directly from here."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Connect Jira" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hide Jira" })).not.toBeNull();
    // Never hit the list RPC while disconnected.
    expect(calls.listIssues).toHaveLength(0);
  });
});
