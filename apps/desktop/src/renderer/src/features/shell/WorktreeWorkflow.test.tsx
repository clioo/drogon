// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import { DEFAULT_GRAPH_POLICY } from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import { TooltipProvider } from "../../components/ui/tooltip";
import { WorktreeCard } from "./WorktreeCard";
import { WorktreeWorkflow } from "./WorktreeWorkflow";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const run: OrchestratorRun = {
  id: "workflow-1",
  workspaceId: "ws",
  policy: DEFAULT_GRAPH_POLICY,
  main: {
    id: "bootstrap",
    title: "Bootstrap demo",
    prompt: "Scaffold",
    harness: "pi",
    model: "fixture",
    dependsOn: [],
    enabled: true,
  },
  status: "running",
  phase: "main",
  iteration: 1,
  steps: [
    {
      nodeId: "main-1",
      phase: "main",
      iteration: 1,
      status: "running",
      runId: "execution-1",
      isFallback: false,
      runtime: { harness: "pi", model: "fixture" },
      attempts: [{ harness: "pi", model: "fixture", outcome: "launched" }],
    },
  ],
  startedAt: "2026-09-13T03:00:00Z",
  updatedAt: "2026-09-13T03:01:00Z",
};
function bridgeFor(observed: OrchestratorRun | null = run) {
  return {
    graphOrchestratorStatus: vi.fn(async () => ({
      ok: true,
      result: { run: observed },
    })),
    graphOrchestratorStop: vi.fn(),
    graphOrchestratorStart: vi.fn(),
  } as unknown as GraphBridge;
}

it("shows a bot-dispatched headless workflow on an unselected card with no terminal sessions", async () => {
  const bridge = bridgeFor();
  const onSelect = vi.fn();
  const view = render(
    <TooltipProvider>
      <WorktreeCard
        worktree={{
          id: "wt",
          projectId: "p",
          workspaceId: "ws",
          path: "/fixture",
          branch: "bootstrap",
          head: "",
          baseRef: null,
          createdAt: run.startedAt,
        }}
        workspaces={[]}
        sessions={[]}
        selected={false}
        disabled={false}
        projectKind="folder"
        implicitFolderWorktree
        onSelect={onSelect}
        onRemove={null}
        onRename={null}
        graphBridge={bridge}
      />
    </TooltipProvider>,
  );
  const summary = await screen.findByText("Work Graph · Running");
  await waitFor(() =>
    expect(summary.closest("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    ),
  );
  const details = screen.getByText("Main agent · running").parentElement
    ?.parentElement;
  expect(details?.classList.contains("hidden")).toBe(false);
  expect(screen.getByText("pi · fixture")).toBeTruthy();
  expect(screen.getByText("Background workflow · no terminal")).toBeTruthy();
  // The automatic reveal happens once. The owner can still collapse it and
  // polling the same run must not override that choice.
  fireEvent.click(summary);
  expect(summary.closest("button")?.getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(
    view.container.querySelectorAll("[data-worktree-agent-row]"),
  ).toHaveLength(0);
  expect(bridge.graphOrchestratorStatus).toHaveBeenCalledWith({
    workspaceId: "ws",
  });
  expect(onSelect).not.toHaveBeenCalled();
  view.unmount();
  expect(bridge.graphOrchestratorStop).not.toHaveBeenCalled();
  expect(bridge.graphOrchestratorStart).not.toHaveBeenCalled();
});

it("keeps the headless main separate from an exited Bot and two live worker terminals", async () => {
  const session = (id: string, workspaceId = "ws"): Session => ({
    id, workspaceId, hostId: "host", incarnation: `inc-${id}`, command: "pi",
    harnessId: "pi", args: [], cols: 80, rows: 24, verdict: "live",
    agentState: "working", exitCode: null, createdAt: run.startedAt,
  });
  const bridge = bridgeFor();
  const onSelectSession = vi.fn();
  const view = render(
    <TooltipProvider>
      <WorktreeCard
        worktree={{ id: "wt", projectId: "p", workspaceId: "ws", path: "/fixture",
          branch: "bootstrap", head: "", baseRef: null, createdAt: run.startedAt }}
        workspaces={[]}
        sessions={[
          { ...session("bot-dispatcher", "bot-home"), verdict: "exited", agentState: "exited", exitCode: 0 },
          session("worker-deck"), session("worker-page"),
        ]}
        selected={false} disabled={false} projectKind="folder" implicitFolderWorktree
        onSelect={vi.fn()} onSelectSession={onSelectSession}
        onRemove={null} onRename={null} graphBridge={bridge}
      />
    </TooltipProvider>,
  );
  const summary = await screen.findByRole("button", { name: "Work Graph · Running" });
  await waitFor(() => expect(summary.getAttribute("aria-expanded")).toBe("true"));
  expect(screen.getByText("Main agent · running")).toBeTruthy();
  expect(screen.getByText("Background workflow · no terminal")).toBeTruthy();
  const rows = [...view.container.querySelectorAll("[data-worktree-agent-row]")];
  expect(rows.map((row) => row.getAttribute("data-worktree-agent-row")).sort()).toEqual(["worker-deck", "worker-page"]);
  fireEvent.click(view.container.querySelector('[data-worktree-agent-row="worker-deck"]')!);
  expect(onSelectSession).toHaveBeenCalledWith("worker-deck");
  expect(bridge.graphOrchestratorStart).not.toHaveBeenCalled();
  expect(bridge.graphOrchestratorStop).not.toHaveBeenCalled();
});

it("respects collapse across polling and loss of contact, then reveals only a new run", async () => {
  vi.useFakeTimers();
  const bridge = bridgeFor();
  const status = vi.mocked(bridge.graphOrchestratorStatus!);
  render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  await act(async () => {});
  const summary = () => screen.getByRole("button", { name: /Work Graph ·/ });
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(summary());
  status.mockResolvedValue({ ok: true, result: { run: { ...run, updatedAt: "2026-09-13T03:02:00Z" } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  status.mockRejectedValue(new Error("Disconnected"));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText("Work Graph · Unverifiable")).toBeTruthy();
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  status.mockResolvedValue({ ok: true, result: { run: { ...run } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText("Work Graph · Running")).toBeTruthy();
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  status.mockResolvedValue({ ok: true, result: { run: { ...run, id: "stale-workflow" } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Run stale-workflow")).toBeNull();
  status.mockResolvedValue({ ok: true, result: { run: { ...run, id: "workflow-2", updatedAt: "2026-09-13T03:03:00Z" } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Run workflow-2")).toBeTruthy();
  expect(bridge.graphOrchestratorStart).not.toHaveBeenCalled();
  expect(bridge.graphOrchestratorStop).not.toHaveBeenCalled();
});

it.each(["running", "stopping", "unverifiable"] as const)("reveals a newly observed %s workflow without starting or stopping it", async (state) => {
  const bridge = bridgeFor({ ...run, status: state });
  render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  const summary = await screen.findByRole("button", { name: /Work Graph ·/ });
  await waitFor(() => expect(summary.getAttribute("aria-expanded")).toBe("true"));
  expect(bridge.graphOrchestratorStart).not.toHaveBeenCalled();
  expect(bridge.graphOrchestratorStop).not.toHaveBeenCalled();
});

it("does not bypass the app capability gate through the raw window bridge", async () => {
  const rawBridge = bridgeFor();
  vi.stubGlobal("drogon", {
    graph: rawBridge,
  } as unknown as typeof window.drogon);
  const view = render(
    <TooltipProvider>
      <WorktreeCard
        worktree={{
          id: "wt",
          projectId: "p",
          workspaceId: "ws",
          path: "/fixture",
          branch: "bootstrap",
          head: "",
          baseRef: null,
          createdAt: run.startedAt,
        }}
        workspaces={[]}
        sessions={[]}
        selected={false}
        disabled={false}
        projectKind="folder"
        implicitFolderWorktree
        onSelect={vi.fn()}
        onRemove={null}
        onRename={null}
        graphBridge={null}
      />
    </TooltipProvider>,
  );
  await act(async () => {});
  expect(rawBridge.graphOrchestratorStatus).not.toHaveBeenCalled();
  expect(view.container.textContent).not.toContain("Work Graph");
});

it("retains evidence but marks loss of contact unverifiable and recovers on the next poll", async () => {
  vi.useFakeTimers();
  const bridge = bridgeFor();
  const status = vi.mocked(bridge.graphOrchestratorStatus!);
  const view = render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  await act(async () => {});
  expect(screen.getByText("Work Graph · Running")).toBeTruthy();
  status.mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByText("Work Graph · Unverifiable")).toBeTruthy();
  expect(screen.getByText("Main agent · unverifiable")).toBeTruthy();
  expect(screen.getByText("Bootstrap demo")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByText("Work Graph · Running")).toBeTruthy();
  view.unmount();
  const calls = status.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(status).toHaveBeenCalledTimes(calls);
});

it("backs off card polling while no workflow is active", async () => {
  vi.useFakeTimers();
  const bridge = bridgeFor(null);
  const status = vi.mocked(bridge.graphOrchestratorStatus!);
  render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  await act(async () => {});
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_999);
  });
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(status).toHaveBeenCalledTimes(2);
});

it("does not display a different workspace's delayed result", async () => {
  const bridge = bridgeFor();
  const view = render(<WorktreeWorkflow workspaceId="other" bridge={bridge} />);
  await waitFor(() =>
    expect(bridge.graphOrchestratorStatus).toHaveBeenCalled(),
  );
  expect(view.container.textContent).toBe("");
});

it("shows completed adversarial roles and fallback failure evidence without implying a live terminal", async () => {
  const bridge = bridgeFor({
    ...run,
    status: "failed",
    phase: "test",
    steps: [
      { ...run.steps[0], status: "succeeded" },
      {
        ...run.steps[0],
        nodeId: "test-1",
        phase: "test",
        status: "failed",
        isFallback: true,
        attempts: [
          {
            harness: "pi",
            model: "fixture",
            outcome: "failed",
            reason: "Fixture exited 1",
          },
        ],
      },
    ],
  });
  render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  await screen.findByText("Work Graph · Failed");
  expect(screen.getByText("Main agent · succeeded")).toBeTruthy();
  expect(screen.getByText("Adversarial test · failed · 1")).toBeTruthy();
  expect(screen.getByText("pi · fixture · Fallback")).toBeTruthy();
  expect(screen.getByText("pi · failed: Fixture exited 1")).toBeTruthy();
});

it("identifies the provider when the model uses the explicit provider field", async () => {
  const bridge = bridgeFor({
    ...run,
    steps: [
      {
        ...run.steps[0],
        runtime: {
          harness: "pi",
          provider: "fixture-provider",
          model: "fixture-model",
        },
      },
    ],
  });
  render(<WorktreeWorkflow workspaceId="ws" bridge={bridge} />);
  await screen.findByText("pi · fixture-provider/fixture-model");
});

it("creates neither a phantom workflow nor poll timers on an older bridge", () => {
  vi.useFakeTimers();
  const view = render(<WorktreeWorkflow workspaceId="ws" bridge={null} />);
  expect(view.container.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
