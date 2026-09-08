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
