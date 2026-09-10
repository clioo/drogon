// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Workspace } from "../../../../shared/session-contract";
import { useWorkspaceCardPorts } from "./use-workspace-card-ports";
const local: Workspace = { id: "local", hostId: "host", name: "Local", path: "/fixture/local", kind: "folder" };
const remote: Workspace = { ...local, id: "remote", hostId: "other-host" };
const row = (workspaceId: string, port: number, kind = "workspace") => ({ kind, port, owner: { workspaceId } });
const snapshot = (...ports: ReturnType<typeof row>[]) => ({ ok: true, result: { ports, unavailableReason: null } });
function bridge(list = vi.fn().mockResolvedValue(snapshot(row("local", 3000)))) {
  const status = vi.fn().mockResolvedValue({ ok: true, result: { hostId: "host" } });
  window.drogon = { status, workspacePorts: { list } } as unknown as typeof window.drogon;
  return { list, status };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
test("one host scan attributes only local workspace rows, deduplicated and sorted", async () => {
  const { list } = bridge(vi.fn().mockResolvedValue(snapshot(row("local", 4000), row("remote", 9000), row("local", 3000), row("local", 3000), row("local", 8000, "other"))));
  const view = renderHook(() => useWorkspaceCardPorts([local, remote], true));
  await waitFor(() => expect(view.result.current.get("local")).toEqual([3000, 4000]));
  expect(view.result.current.has("remote")).toBe(false);
  expect(list.mock.calls).toEqual([[{ workspaceId: "local" }]]);
});
test("a changed host cannot display badges from the previous host while discovery is pending", async () => {
  const { status } = bridge();
  const view = renderHook(({ workspaces }) => useWorkspaceCardPorts(workspaces, true), { initialProps: { workspaces: [local] } });
  await waitFor(() => expect(view.result.current.get("local")).toEqual([3000]));
  status.mockImplementation(() => new Promise(() => {}));
  view.rerender({ workspaces: [{ ...local, hostId: "other-host" }] });
  expect(view.result.current.size).toBe(0);
});
test("disabled properties and unknown ownership never initiate a process scan", async () => {
  const { list } = bridge();
  const view = renderHook(({ enabled }) => useWorkspaceCardPorts([remote], enabled), { initialProps: { enabled: false } });
  view.rerender({ enabled: true });
  await act(async () => {});
  expect(list).not.toHaveBeenCalled();
  expect(view.result.current.size).toBe(0);
});
test("a late response after disabling cannot repopulate badges", async () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  const { list } = bridge(vi.fn().mockReturnValue(new Promise((yes) => { resolve = yes; })));
  const view = renderHook(({ enabled }) => useWorkspaceCardPorts([local], enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  view.rerender({ enabled: false });
  await act(async () => resolve(snapshot(row("local", 3000))));
  expect(view.result.current.size).toBe(0);
});
test("an unavailable scan clears previously observed ports", async () => {
  vi.useFakeTimers();
  const { list } = bridge();
  const view = renderHook(() => useWorkspaceCardPorts([local], true));
  await act(async () => {});
  expect(view.result.current.get("local")).toEqual([3000]);
  list.mockResolvedValue({ ok: true, result: { ports: [], unavailableReason: "unavailable" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(view.result.current.size).toBe(0);
  expect(list).toHaveBeenCalledTimes(2);
});
