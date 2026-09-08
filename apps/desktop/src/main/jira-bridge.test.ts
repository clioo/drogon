import { describe, expect, it } from "vitest";
import { dispatchJiraRequest } from "./jira-bridge";
import type { Result } from "../shared/session-contract";

const statusResult = {
  connected: true,
  viewer: {
    accountId: "a1",
    displayName: "Carlos Fixture",
    email: "carlos@example.com",
  },
  sites: [
    {
      id: "s1",
      siteUrl: "https://example.atlassian.net",
      email: "carlos@example.com",
      displayName: "Carlos Fixture",
      accountId: "a1",
      authType: "cloud",
    },
  ],
  activeSiteId: "s1",
  selectedSiteId: "s1",
};

const searchResult = {
  issues: [
    {
      id: "10001",
      key: "DROG-1",
      siteId: "s1",
      siteName: "Carlos Fixture",
      title: "Project setup",
      url: "https://example.atlassian.net/browse/DROG-1",
      project: { id: "10000", key: "DROG", name: "Drogon" },
      issueType: { id: "10001", name: "Task" },
      status: {
        id: "3",
        name: "Backlog",
        categoryKey: "new",
        categoryName: "To Do",
      },
      labels: ["setup"],
      assignee: { accountId: "a1", displayName: "Carlos Fixture" },
      updatedAt: "2026-09-01T09:00:00.000+0000",
      createdAt: "2026-08-01T09:00:00.000+0000",
    },
  ],
  total: 1,
  isLast: true,
};

describe("jira bridge admission", () => {
  it("validates input before invoking the service", async () => {
    let called = false;
    const result = await dispatchJiraRequest(
      "jiraConnect",
      { siteUrl: "https://example.atlassian.net", apiToken: "" },
      async () => {
        called = true;
        return { ok: true, result: { ok: true, viewer: statusResult.viewer } };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("rejects searchIssues without a JQL", async () => {
    let called = false;
    const result = await dispatchJiraRequest(
      "jiraSearchIssues",
      { jql: "  " },
      async () => {
        called = true;
        return { ok: true, result: searchResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("maps channels to the fork's native method names", async () => {
    const seen: string[] = [];
    const call = async (method: string): Promise<Result<unknown>> => {
      seen.push(method);
      return { ok: true, result: statusResult };
    };
    await dispatchJiraRequest("jiraStatus", undefined, call);
    await dispatchJiraRequest("jiraSelectSite", { siteId: "s1" }, call);
    expect(seen).toEqual(["jira.status", "jira.selectSite"]);
  });

  it("passes a contract-valid search result through", async () => {
    const result = await dispatchJiraRequest(
      "jiraSearchIssues",
      { jql: "project = DROG", limit: 30 },
      async () => ({ ok: true, result: searchResult }),
    );
    expect(result).toEqual({ ok: true, result: searchResult });
  });

  it("refuses a result that breaks the contract (honest failure)", async () => {
    const broken = { ...searchResult, issues: [{ key: "DROG-1" }] };
    const result = await dispatchJiraRequest(
      "jiraSearchIssues",
      { jql: "project = DROG" },
      async () => ({ ok: true, result: broken }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });

  it("passes typed service errors through untouched", async () => {
    const result = await dispatchJiraRequest(
      "jiraSearchIssues",
      { jql: "JQL_RATE_LIMIT" },
      async () => ({
        ok: false,
        error: {
          code: "jira_rate_limited",
          message: "Error 429: Rate limit exceeded. (retry after 7s)",
          retryable: true,
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "jira_rate_limited",
        message: "Error 429: Rate limit exceeded. (retry after 7s)",
        retryable: true,
      },
    });
  });

  it("accepts the screenshot-shape rows the Tasks list renders", async () => {
    const noAssigneeNoPriority = {
      ...searchResult,
      issues: [
        {
          ...searchResult.issues[0],
          key: "DROG-3",
          assignee: undefined,
          priority: undefined,
        },
      ],
    };
    const result = await dispatchJiraRequest(
      "jiraListIssues",
      { filter: "all" },
      async () => ({ ok: true, result: noAssigneeNoPriority }),
    );
    expect(result.ok).toBe(true);
  });
});

const detailIssue = {
  ...searchResult.issues[0],
  description: "## Plan\n\n- cargo workspace layout",
};

const commentsResult = [
  {
    id: "20001",
    body: "Repo skeleton looks good.",
    createdAt: "2026-08-02T09:00:00.000+0000",
    updatedAt: "2026-08-02T09:00:00.000+0000",
    user: { accountId: "a2", displayName: "Ana Garcia" },
  },
];

const transitionsResult = [
  {
    id: "11",
    name: "Start Progress",
    to: {
      id: "4",
      name: "In Progress",
      categoryKey: "indeterminate",
      categoryName: "In Progress",
    },
  },
];

const worktreeResult = {
  id: "wt-1",
  projectId: "p1",
  workspaceId: "ws-1",
  path: "/tmp/wt",
  branch: "drog-1-project-setup",
  head: "abc123",
  baseRef: null,
  title: "DROG-1 Project setup",
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("jira bridge issue creation and detail (R17-C)", () => {
  it("maps the new channels to the fork's native method names", async () => {
    const seen: string[] = [];
    const call = async (method: string): Promise<Result<unknown>> => {
      seen.push(method);
      return { ok: true, result: null };
    };
    await dispatchJiraRequest("jiraGetIssue", { key: "DROG-1" }, call);
    await dispatchJiraRequest("jiraComments", { key: "DROG-1" }, call);
    await dispatchJiraRequest("jiraListTransitions", { key: "DROG-1" }, call);
    await dispatchJiraRequest(
      "jiraCreateIssue",
      { projectId: "10000", issueTypeId: "10001", title: "x" },
      call,
    );
    await dispatchJiraRequest("jiraUpdateIssue", { key: "DROG-1" }, call);
    await dispatchJiraRequest("jiraAddComment", { key: "DROG-1", body: "y" }, call);
    await dispatchJiraRequest(
      "jiraStartIssue",
      { projectId: "p1", key: "DROG-1" },
      call,
    );
    expect(seen).toEqual([
      "jira.getIssue",
      "jira.comments",
      "jira.transitions",
      "jira.createIssue",
      "jira.updateIssue",
      "jira.addComment",
      "jira.startIssue",
    ]);
  });

  it("passes a detail issue with a markdown description through", async () => {
    const result = await dispatchJiraRequest(
      "jiraGetIssue",
      { key: "DROG-1" },
      async () => ({ ok: true, result: detailIssue }),
    );
    expect(result).toEqual({ ok: true, result: detailIssue });
  });

  it("accepts the honest null for an unknown issue", async () => {
    const result = await dispatchJiraRequest(
      "jiraGetIssue",
      { key: "NOPE-1" },
      async () => ({ ok: true, result: null }),
    );
    expect(result).toEqual({ ok: true, result: null });
  });

  it("passes comments and transitions through", async () => {
    const comments = await dispatchJiraRequest(
      "jiraComments",
      { key: "DROG-1" },
      async () => ({ ok: true, result: commentsResult }),
    );
    expect(comments).toEqual({ ok: true, result: commentsResult });
    const transitions = await dispatchJiraRequest(
      "jiraListTransitions",
      { key: "DROG-1" },
      async () => ({ ok: true, result: transitionsResult }),
    );
    expect(transitions).toEqual({ ok: true, result: transitionsResult });
  });

  it("passes a created issue key/url and the business-failure envelope", async () => {
    const created = await dispatchJiraRequest(
      "jiraCreateIssue",
      {
        projectId: "10000",
        issueTypeId: "10001",
        title: "Ship",
        description: "body",
        customFields: { custom_10003: "a2" },
        userFieldKeys: ["custom_10003"],
      },
      async () => ({
        ok: true,
        result: { ok: true, id: "10020", key: "DROG-20", url: "u" },
      }),
    );
    expect(created.ok).toBe(true);
    const failed = await dispatchJiraRequest(
      "jiraCreateIssue",
      { projectId: "10000", issueTypeId: "10001", title: "Nope" },
      async () => ({ ok: true, result: { ok: false, error: "bad" } }),
    );
    expect(failed).toEqual({
      ok: true,
      result: { ok: false, error: "bad" },
    });
  });

  it("rejects a createIssue result missing the discriminant", async () => {
    const result = await dispatchJiraRequest(
      "jiraCreateIssue",
      { projectId: "10000", issueTypeId: "10001", title: "x" },
      async () => ({ ok: true, result: { key: "DROG-1" } }),
    );
    expect(result.ok).toBe(false);
  });

  it("carries null clears for assignee and priority through admission", async () => {
    let sent: unknown = null;
    const result = await dispatchJiraRequest(
      "jiraUpdateIssue",
      { key: "DROG-1", assigneeAccountId: null, priorityId: null },
      async (_method: string, params: object) => {
        sent = params;
        return { ok: true, result: { ok: true } };
      },
    );
    expect(result.ok).toBe(true);
    expect(sent).toEqual({
      key: "DROG-1",
      assigneeAccountId: null,
      priorityId: null,
    });
  });

  it("passes the startIssue worktree result through", async () => {
    const result = await dispatchJiraRequest(
      "jiraStartIssue",
      { projectId: "p1", key: "DROG-1" },
      async () => ({
        ok: true,
        result: {
          ok: true,
          key: "DROG-1",
          url: "https://example.atlassian.net/browse/DROG-1",
          displayName: "DROG-1 Project setup",
          seedName: "drog-1-project-setup",
          worktree: worktreeResult,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
