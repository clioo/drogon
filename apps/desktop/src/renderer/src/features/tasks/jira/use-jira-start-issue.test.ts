// R17-C: the start-from-issue helpers — the fork's prompt strings and the
// bridge mapping (daemon result → caller-facing outcome with fallback to
// the renderer-side seed).
import { describe, expect, it, vi } from "vitest";
import {
  buildJiraIssueContextPrompt,
  buildJiraStartIssuePrompt,
  startWorkspaceFromJiraIssue,
} from "./use-jira-start-issue";
import type { JiraBridge } from "../../../../../shared/jira-contract";

const issue = {
  key: "DROG-42",
  title: "Fix the flux capacitor",
  url: "https://acme.atlassian.net/browse/DROG-42",
};

describe("start-from-issue prompts", () => {
  it("uses the fork's default issue command", () => {
    expect(buildJiraStartIssuePrompt(issue)).toBe(
      "Complete https://acme.atlassian.net/browse/DROG-42",
    );
  });

  it("builds the copy-prompt context string", () => {
    expect(buildJiraIssueContextPrompt(issue)).toBe(
      "Complete Jira issue DROG-42: Fix the flux capacitor\n\nhttps://acme.atlassian.net/browse/DROG-42",
    );
  });
});

describe("startWorkspaceFromJiraIssue", () => {
  function bridgeWith(result: unknown): JiraBridge {
    return {
      jiraStartIssue: vi.fn().mockResolvedValue(result),
    } as unknown as JiraBridge;
  }

  it("maps a daemon success to the outcome", async () => {
    const bridge = bridgeWith({
      ok: true,
      result: {
        ok: true,
        key: "DROG-42",
        url: "https://acme.atlassian.net/browse/DROG-42",
        displayName: "DROG-42 Fix the flux capacitor",
        seedName: "drog-42-fix-the-flux-capacitor",
        worktree: {
          id: "wt-1",
          workspaceId: "ws-1",
          repoPath: "/tmp/repo",
          branch: "issue-42-fix-the-flux-capacitor",
          title: "DROG-42 Fix the flux capacitor",
          createdAt: "2026-01-01T00:00:00Z",
          lastSessionAt: null,
          baseRef: "main",
        },
      },
    });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue,
    });
    expect(outcome).toEqual({
      ok: true,
      key: "DROG-42",
      url: "https://acme.atlassian.net/browse/DROG-42",
      displayName: "DROG-42 Fix the flux capacitor",
      seedName: "drog-42-fix-the-flux-capacitor",
      worktreeId: "wt-1",
      workspaceId: "ws-1",
      identity: null,
      intentId: expect.any(String),
    });
    expect(bridge.jiraStartIssue).toHaveBeenCalledWith({
      projectId: "p1",
      key: "DROG-42",
      siteId: undefined,
      title: "Fix the flux capacitor",
      intentId: expect.any(String),
    });
  });

  it("surfaces bridge failures", async () => {
    const bridge = bridgeWith({ ok: false, error: { message: "offline" } });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue,
    });
    expect(outcome).toEqual({ ok: false, error: "offline" });
  });

  it("surfaces business failures", async () => {
    const bridge = bridgeWith({
      ok: true,
      result: { ok: false, url: "", displayName: "", seedName: "", worktree: null },
    });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue,
    });
    expect(outcome.ok).toBe(false);
  });

  it("falls back to the renderer seed when the daemon leaves names empty", async () => {
    const bridge = bridgeWith({
      ok: true,
      result: {
        ok: true,
        key: "DROG-42",
        url: "",
        displayName: "",
        seedName: "",
        worktree: {
          id: "wt-1",
          workspaceId: "ws-1",
          repoPath: "/tmp/repo",
          branch: "b",
          title: "DROG-42 Fix the flux capacitor",
          createdAt: "2026-01-01T00:00:00Z",
          lastSessionAt: null,
          baseRef: "main",
        },
      },
    });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.displayName).toBe("DROG-42");
      expect(outcome.seedName).toBe("drog-42-fix-the-flux-capacitor");
    }
  });

  // C06: the resolved site URL yields the stable identity on the outcome;
  // no site URL stays unresolved (null), never derived from email/siteId.
  it("carries the stable identity when the instance site URL resolves", async () => {
    const bridge = bridgeWith({
      ok: true,
      result: {
        ok: true,
        key: "DROG-42",
        url: "https://acme.atlassian.net/browse/DROG-42",
        displayName: "DROG-42 Fix the flux capacitor",
        seedName: "drog-42-fix-the-flux-capacitor",
        worktree: {
          id: "wt-1",
          workspaceId: "ws-1",
          repoPath: "/tmp/repo",
          branch: "b",
          title: "DROG-42 Fix the flux capacitor",
          createdAt: "2026-01-01T00:00:00Z",
          lastSessionAt: null,
          baseRef: "main",
        },
      },
    });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue: { ...issue, id: "10001" },
      siteUrl: "https://ACME.atlassian.net/",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.identity).toMatchObject({
        provider: "jira",
        instanceUrl: "https://acme.atlassian.net",
        issueId: "10001",
        key: "DROG-42",
      });
      expect(outcome.identity?.instanceId).toHaveLength(24);
    }
  });

  it("a legacy issue without an immutable id stays unresolved", async () => {
    const bridge = bridgeWith({
      ok: true,
      result: {
        ok: true,
        key: "DROG-42",
        url: "",
        displayName: "DROG-42",
        seedName: "drog-42",
        worktree: {
          id: "wt-1",
          workspaceId: "ws-1",
          repoPath: "/tmp/repo",
          branch: "b",
          title: "DROG-42",
          createdAt: "2026-01-01T00:00:00Z",
          lastSessionAt: null,
          baseRef: "main",
        },
      },
    });
    const outcome = await startWorkspaceFromJiraIssue(bridge, {
      projectId: "p1",
      issue: { key: "DROG-42", title: "t", url: "", siteId: "legacy-site" },
      siteUrl: "https://acme.atlassian.net",
    });
    expect(outcome).toMatchObject({ ok: true, identity: null });
  });

  it("coalesces a double click into one start operation", async () => {
    const jiraStartIssue = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                result: {
                  ok: true,
                  key: "DROG-42",
                  url: "u",
                  displayName: "DROG-42",
                  seedName: "drog-42",
                  worktree: {
                    id: "wt-1",
                    workspaceId: "ws-1",
                    repoPath: "/r",
                    branch: "b",
                    title: "DROG-42",
                    createdAt: "2026-01-01T00:00:00Z",
                    lastSessionAt: null,
                    baseRef: "main",
                  },
                },
              }),
            5,
          );
        }),
    );
    const bridge = { jiraStartIssue } as unknown as JiraBridge;
    const input = {
      projectId: "p1",
      issue: { ...issue, id: "10001" },
      siteUrl: "https://acme.atlassian.net",
    };
    const [first, second] = await Promise.all([
      startWorkspaceFromJiraIssue(bridge, input),
      startWorkspaceFromJiraIssue(bridge, input),
    ]);
    expect(jiraStartIssue).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    // A later, separate start is a new operation (not deduped away).
    await startWorkspaceFromJiraIssue(bridge, input);
    expect(jiraStartIssue).toHaveBeenCalledTimes(2);
  });
});
