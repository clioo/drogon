// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorktreeCardLinkedMetadata } from "./WorktreeCardLinkedMetadata";
import type { Worktree } from "../../../../shared/session-contract";
import { worktreeIssueLinkSchema } from "../../../../shared/worktree-issue-contract";
const worktree: Worktree = { id: "wt", projectId: "project", workspaceId: "workspace", path: "/fixture", branch: "feature", head: "", baseRef: null, createdAt: "2026-09-01T00:00:00Z" };
const linear = worktreeIssueLinkSchema.parse({ worktreeId: "wt", provider: "linear", identifier: "ENG-123", title: "Real linked Linear title", url: "https://linear.app/acme/issue/ENG-123" });
const jira = worktreeIssueLinkSchema.parse({ worktreeId: "wt", provider: "jira", identifier: "KAN-1", title: "Real linked Jira title", url: "https://company.atlassian.net/browse/KAN-1" });
afterEach(cleanup);
test("provider properties reveal real associated issue identifiers and titles", () => {
  render(<WorktreeCardLinkedMetadata worktree={worktree} ports={[]} properties={{}} {...{ issueLinks: [linear, jira] }} />);
  expect(screen.getByText("ENG-123")).toBeTruthy();
  expect(screen.getByTitle(`Real linked Linear title · ${linear.url}`)).toBeTruthy();
  expect(screen.getByText("KAN-1")).toBeTruthy();
  expect(screen.getByTitle(`Real linked Jira title · ${jira.url}`)).toBeTruthy();
});
test("each provider toggle hides only its own association; foreign worktree links are ignored", () => {
  render(<WorktreeCardLinkedMetadata worktree={worktree} ports={[]} properties={{ "linear-issue": false }} {...{ issueLinks: [linear, jira, { ...jira, worktreeId: "foreign", identifier: "KAN-2" }] }} />);
  expect(screen.queryByText("ENG-123")).toBeNull();
  expect(screen.getByText("KAN-1")).toBeTruthy();
  expect(screen.queryByText("KAN-2")).toBeNull();
});
test("opening an associated URL uses its own action and does not select the parent card", () => {
  const onOpenIssue = vi.fn(); const onSelect = vi.fn();
  render(<div onClick={onSelect}><WorktreeCardLinkedMetadata worktree={worktree} ports={[]} properties={{}} {...{ issueLinks: [linear], onOpenIssue }} /></div>);
  fireEvent.click(screen.getByRole("button", { name: "Open Linear ENG-123" }));
  expect(onOpenIssue).toHaveBeenCalledWith(linear.url);
  expect(onSelect).not.toHaveBeenCalled();
});
