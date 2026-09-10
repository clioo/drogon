// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ProjectGroup } from "./project-adapter";
import { useWorktreeIssueLinks } from "./use-worktree-issue-links";
import { WORKTREE_ISSUE_LINKS_CAPABILITY, worktreeIssueLinkSchema } from "../../../../shared/worktree-issue-contract";
const group: ProjectGroup = {
  project: { id: "p", hostId: "host", name: "Project", path: "/fixture", kind: "folder", defaultBaseRef: null },
  worktrees: [{ id: "wt", projectId: "p", workspaceId: "ws", path: "/fixture", branch: "", head: "", baseRef: null, createdAt: "2026-01-01" }],
};
const link = worktreeIssueLinkSchema.parse({ worktreeId: "wt", provider: "linear", identifier: "ENG-123", title: "Linked title", url: null });
const reply = (...links: typeof link[]) => ({ ok: true, result: { links } });
function bridge(list = vi.fn().mockResolvedValue(reply(link))) {
  const status = vi.fn().mockResolvedValue({ ok: true, result: { hostId: "host", capabilities: [WORKTREE_ISSUE_LINKS_CAPABILITY] } });
  const unsubscribe = vi.fn();
  let changed = () => {};
  window.drogon = { status, project: { worktreeIssueLinks: list, onProjectsChanged: (listener: () => void) => { changed = listener; return unsubscribe; } } } as unknown as typeof window.drogon;
  return { list, status, unsubscribe, changed: () => changed() };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
test("loads associations without visiting Tasks and rejects foreign worktree rows", async () => {
  const { list } = bridge(vi.fn().mockResolvedValue(reply(link, { ...link, worktreeId: "foreign" })));
  const view = renderHook(() => useWorktreeIssueLinks([group], true));
  await waitFor(() => expect(view.result.current.get("wt")).toEqual([link]));
  expect(view.result.current.has("foreign")).toBe(false);
  expect(list.mock.calls).toEqual([[{ projectId: "p" }]]);
});
test("disabled properties do not fetch; unknown hosts never use the local issue registry", async () => {
  const { list, status } = bridge();
  const view = renderHook(({ enabled }) => useWorktreeIssueLinks([{ ...group, project: { ...group.project, hostId: "remote" } }], enabled), { initialProps: { enabled: false } });
  expect(status).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  await act(async () => {});
  expect(list).not.toHaveBeenCalled();
  expect(view.result.current.size).toBe(0);
});
test("older services are not sent unsupported issue-link requests", async () => {
  const { list, status } = bridge();
  status.mockResolvedValue({ ok: true, result: { hostId: "host", capabilities: [] } });
  const view = renderHook(() => useWorktreeIssueLinks([group], true));
  await act(async () => {});
  expect(list).not.toHaveBeenCalled();
  expect(view.result.current.size).toBe(0);
});
test("a host change hides the previous host's badges before discovery resolves", async () => {
  const { status } = bridge();
  const view = renderHook(({ groups }) => useWorktreeIssueLinks(groups, true), { initialProps: { groups: [group] } });
  await waitFor(() => expect(view.result.current.get("wt")).toEqual([link]));
  status.mockImplementation(() => new Promise(() => {}));
  view.rerender({ groups: [{ ...group, project: { ...group.project, hostId: "other" } }] });
  expect(view.result.current.size).toBe(0);
});
test("a late reply after disabling cannot republish an association", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const { list } = bridge(vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })));
  const view = renderHook(({ enabled }) => useWorktreeIssueLinks([group], enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  view.rerender({ enabled: false });
  await act(async () => resolve(reply(link)));
  expect(view.result.current.size).toBe(0);
});
test("reenabling a property does not resurrect a stale association while offline", async () => {
  const { status } = bridge();
  const view = renderHook(({ enabled }) => useWorktreeIssueLinks([group], enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(view.result.current.get("wt")).toEqual([link]));
  view.rerender({ enabled: false });
  status.mockImplementation(() => new Promise(() => {}));
  view.rerender({ enabled: true });
  expect(view.result.current.size).toBe(0);
});
test("registry events refresh associations and dispose the subscription", async () => {
  const api = bridge();
  const view = renderHook(() => useWorktreeIssueLinks([group], true));
  await waitFor(() => expect(view.result.current.get("wt")).toEqual([link]));
  api.list.mockResolvedValue(reply());
  await act(async () => api.changed());
  expect(view.result.current.size).toBe(0);
  expect(api.list).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(api.unsubscribe).toHaveBeenCalledOnce();
});
test("an unavailable registry clears the last observed associations", async () => {
  vi.useFakeTimers();
  const { list } = bridge();
  const view = renderHook(() => useWorktreeIssueLinks([group], true));
  await act(async () => {});
  expect(view.result.current.get("wt")).toEqual([link]);
  list.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "Offline", retryable: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(view.result.current.size).toBe(0);
  expect(list).toHaveBeenCalledTimes(2);
});
