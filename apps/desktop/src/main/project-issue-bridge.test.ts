import { expect, test, vi } from "vitest";
import { dispatchProjectRequest } from "./project-bridge";
import { issueDetailsSchema, worktreeIssueLinkSchema } from "../shared/worktree-issue-contract";
const issue = issueDetailsSchema.parse({ provider: "jira", identifier: "KAN-1", title: "Observed title", siteId: "site-a", url: "https://example.atlassian.net/browse/KAN-1" });
const link = worktreeIssueLinkSchema.parse({ worktreeId: "wt", ...issue });
test("issue reads and writes route through the validated project bridge", async () => {
  const call = vi.fn().mockResolvedValue({ ok: true, result: link });
  expect(await dispatchProjectRequest("worktreeLinkIssue", { worktreeId: "wt", issue }, call)).toEqual({ ok: true, result: link });
  expect(call).toHaveBeenLastCalledWith("worktree.linkIssue", { worktreeId: "wt", issue });
  call.mockResolvedValue({ ok: true, result: { links: [link] } });
  expect(await dispatchProjectRequest("worktreeIssueLinks", { projectId: "p" }, call)).toEqual({ ok: true, result: { links: [link] } });
  expect(call).toHaveBeenLastCalledWith("worktree.issueLinks", { projectId: "p" });
  const removed = { worktreeId: "wt", provider: "jira", removed: true };
  call.mockResolvedValue({ ok: true, result: removed });
  expect(await dispatchProjectRequest("worktreeUnlinkIssue", { worktreeId: "wt", provider: "jira" }, call)).toEqual({ ok: true, result: removed });
  expect(call).toHaveBeenLastCalledWith("worktree.unlinkIssue", { worktreeId: "wt", provider: "jira" });
});
test.each(["javascript:alert(1)", "https://:", "https://user:secret@example.com/issue", "https://example.com:99999"])("rejects unsafe input %s without calling native", async (url) => {
  const call = vi.fn();
  const result = await dispatchProjectRequest("worktreeLinkIssue", { worktreeId: "wt", issue: { ...issue, url } }, call);
  expect(result.ok).toBe(false);
  expect(call).not.toHaveBeenCalled();
});
test.each([{ worktreeId: "foreign" }, { identifier: "KAN-2" }, { siteId: "site-b" }, { provider: "linear", url: "https://linear.app/team/issue/KAN-1" }])("does not confirm a link for another owner or issue: %j", async (mismatch) => {
  const call = vi.fn().mockResolvedValue({ ok: true, result: { ...link, ...mismatch } });
  const result = await dispatchProjectRequest("worktreeLinkIssue", { worktreeId: "wt", issue }, call);
  expect(result.ok).toBe(false);
});
test("does not discard an unsupported host selector before a mutation", async () => {
  const call = vi.fn().mockResolvedValue({ ok: true, result: link });
  const result = await dispatchProjectRequest("worktreeLinkIssue", { worktreeId: "wt", issue, hostId: "remote" }, call);
  expect(result.ok).toBe(false);
  expect(call).not.toHaveBeenCalled();
});
test("does not confirm an unlink belonging to another worktree", async () => {
  const result = await dispatchProjectRequest("worktreeUnlinkIssue", { worktreeId: "wt", provider: "jira" }, async () => ({ ok: true, result: { worktreeId: "foreign", provider: "jira", removed: true } }));
  expect(result.ok).toBe(false);
});
