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
  fireEvent.click(summary);
  expect(screen.getByText("Main agent · running")).toBeTruthy();
  expect(screen.getByText("pi · fixture")).toBeTruthy();
  expect(screen.getByText("Background workflow · no terminal")).toBeTruthy();
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

it("does not bypass the app capability gate through the raw window bridge", async () => {
  const rawBridge = bridgeFor();
  window.drogon = { graph: rawBridge } as unknown as typeof window.drogon;
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
    await vi.advanceTimersByTimeAsync(29_999);
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
