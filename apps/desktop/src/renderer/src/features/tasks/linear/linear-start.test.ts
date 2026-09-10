// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { IssueDetails } from "../../../../../shared/worktree-issue-contract";
import type { ProjectRpcBridge } from "../../shell/project-adapter";
import {
  clearLinearStartCoalescing,
  linkLinearIssueToWorktree,
  startWorkspaceFromLinearIssue,
  unlinkLinearIssueFromWorktree,
} from "./linear-start";

function issue(overrides: Partial<IssueDetails> = {}): IssueDetails {
  return {
    provider: "linear",
    identifier: "ENG-123",
    title: "Linked Linear work",
    siteId: null,
    url: "https://linear.app/drogon/issue/ENG-123",
    stateName: "In Progress",
    labels: ["backend"],
    ...overrides,
  };
}

const createdWorktree = {
  id: "wt-1",
  projectId: "p1",
  workspaceId: "ws-1",
  path: "/tmp/wt-1",
  branch: "eng-123-linked-linear-work",
  head: "abc",
  baseRef: null,
  title: null,
  createdAt: "2026-09-06T12:00:00Z",
};

function linkResult(worktreeId = "wt-1", identifier = "ENG-123") {
  return {
    worktreeId,
    provider: "linear" as const,
    identifier,
    title: "Linked Linear work",
    siteId: null,
    url: "https://linear.app/drogon/issue/ENG-123",
    stateName: "In Progress",
    labels: ["backend"],
  };
}

describe("linear start producer (durable project bridge)", () => {
  test("creates the worktree with the issue seed, then links the issue", async () => {
    clearLinearStartCoalescing();
    const worktreeCreate = vi.fn(
      async (input: { projectId: string; name: string }) => ({
        ok: true as const,
        result: { ...createdWorktree, projectId: input.projectId, branch: input.name },
      }),
    );
    const worktreeLinkIssue = vi.fn(
      async (input: { worktreeId: string; issue: IssueDetails }) => ({
        ok: true as const,
        result: linkResult(input.worktreeId, input.issue.identifier),
      }),
    );
    const bridge = { worktreeCreate, worktreeLinkIssue } as unknown as ProjectRpcBridge;
    const outcome = await startWorkspaceFromLinearIssue(bridge, {
      projectId: "p1",
      issue: issue(),
    });
    expect(outcome).toMatchObject({
      ok: true,
      identifier: "ENG-123",
      worktreeId: "wt-1",
      workspaceId: "ws-1",
      linked: true,
    });
    expect(worktreeCreate).toHaveBeenCalledTimes(1);
    expect(worktreeCreate.mock.calls[0][0]).toMatchObject({ projectId: "p1" });
    expect(String(worktreeCreate.mock.calls[0][0].name)).toContain("eng-123");
    expect(worktreeLinkIssue).toHaveBeenCalledTimes(1);
    expect(worktreeLinkIssue.mock.calls[0][0]).toMatchObject({
      worktreeId: "wt-1",
      issue: expect.objectContaining({ identifier: "ENG-123", provider: "linear" }),
    });
  });

  test("concurrent starts for the same issue coalesce into one create", async () => {
    clearLinearStartCoalescing();
    let resolveCreate!: (value: { ok: true; result: typeof createdWorktree }) => void;
    const worktreeCreate = vi.fn(
      () =>
        new Promise<{ ok: true; result: typeof createdWorktree }>(
          (resolve) => void (resolveCreate = resolve),
        ),
    );
    const worktreeLinkIssue = vi.fn(async () => ({
      ok: true as const,
      result: linkResult(),
    }));
    const bridge = { worktreeCreate, worktreeLinkIssue } as unknown as ProjectRpcBridge;
    const first = startWorkspaceFromLinearIssue(bridge, { projectId: "p1", issue: issue() });
    const second = startWorkspaceFromLinearIssue(bridge, { projectId: "p1", issue: issue() });
    resolveCreate({ ok: true, result: createdWorktree });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(worktreeCreate).toHaveBeenCalledTimes(1);
  });

  test("rejects an invalid issue without calling native", async () => {
    clearLinearStartCoalescing();
    const worktreeCreate = vi.fn();
    const worktreeLinkIssue = vi.fn();
    const bridge = { worktreeCreate, worktreeLinkIssue } as unknown as ProjectRpcBridge;
    const outcome = await startWorkspaceFromLinearIssue(bridge, {
      projectId: "p1",
      issue: issue({ identifier: "nope" }),
    });
    expect(outcome.ok).toBe(false);
    expect(worktreeCreate).not.toHaveBeenCalled();
    expect(worktreeLinkIssue).not.toHaveBeenCalled();
  });

  test("does not confirm a link echoed for another worktree or issue", async () => {
    clearLinearStartCoalescing();
    const bridge = {
      worktreeCreate: vi.fn(async () => ({ ok: true as const, result: createdWorktree })),
      worktreeLinkIssue: vi.fn(async () => ({
        ok: true as const,
        result: linkResult("foreign", "ENG-123"),
      })),
    } as unknown as ProjectRpcBridge;
    const outcome = await startWorkspaceFromLinearIssue(bridge, {
      projectId: "p1",
      issue: issue(),
    });
    expect(outcome.ok).toBe(false);
  });

  test("link attaches to an existing worktree and verifies the echo", async () => {
    const good = {
      worktreeLinkIssue: vi.fn(async () => ({ ok: true as const, result: linkResult("wt-9") })),
    } as unknown as ProjectRpcBridge;
    const linked = await linkLinearIssueToWorktree(good, {
      worktreeId: "wt-9",
      issue: issue(),
    });
    expect(linked).toMatchObject({ ok: true });
    const bad = {
      worktreeLinkIssue: vi.fn(async () => ({ ok: true as const, result: linkResult("wt-9", "ENG-999") })),
    } as unknown as ProjectRpcBridge;
    expect(
      (await linkLinearIssueToWorktree(bad, { worktreeId: "wt-9", issue: issue() })).ok,
    ).toBe(false);
    const missing = {} as ProjectRpcBridge;
    expect(
      (await linkLinearIssueToWorktree(missing, { worktreeId: "wt-9", issue: issue() })).ok,
    ).toBe(false);
  });

  test("unlink detaches and verifies the owner", async () => {
    const good = {
      worktreeUnlinkIssue: vi.fn(async () => ({
        ok: true as const,
        result: { worktreeId: "wt-9", provider: "linear" as const, removed: true },
      })),
    } as unknown as ProjectRpcBridge;
    expect(
      await unlinkLinearIssueFromWorktree(good, { worktreeId: "wt-9" }),
    ).toEqual({ ok: true, removed: true });
    const foreign = {
      worktreeUnlinkIssue: vi.fn(async () => ({
        ok: true as const,
        result: { worktreeId: "wt-other", provider: "linear" as const, removed: true },
      })),
    } as unknown as ProjectRpcBridge;
    expect(
      (await unlinkLinearIssueFromWorktree(foreign, { worktreeId: "wt-9" })).ok,
    ).toBe(false);
  });
});
