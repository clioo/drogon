// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Integration tests for the ported MentuPanel over a fake `MentuBridge`:
// header copy and the full-tab affordance, recipe selection through the
// shared store, the Review → Approve & run flow into a running execution,
// the execution-failed message with its evidence shortcut, and the
// selected step's in-panel inspector (the panel IS the recipe surface:
// the wide tab shows the work graph).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  MentuBridge,
  MentuRecipeDetail,
  MentuRun,
} from "../../../../shared/mentu-contract";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { MENTU_OPEN_TAB_EVENT, MentuPanel } from "./MentuPanel";
import { mentuStore } from "./mentu-store";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const HASH = "c".repeat(64);

function recipe(): MentuRecipeDetail {
  return {
    id: "demo",
    path: ".mentu/recipes/demo.json",
    name: "demo",
    description: null,
    contentHash: HASH,
    steps: [
      {
        label: "build",
        backend: "shell",
        description: "Build it.",
        dependsOn: [],
        timeoutSeconds: 30,
        verifyCommands: [],
      },
      {
        label: "test",
        backend: "shell",
        description: null,
        dependsOn: ["build"],
        timeoutSeconds: null,
        verifyCommands: [],
      },
    ],
    // The real recipe JSON (the editor's fork shape, `depends_on`), so the
    // selected step is editable in the inspector exactly like a recipe the
    // daemon parsed.
    source: JSON.stringify({
      name: "demo",
      steps: [
        {
          label: "build",
          backend: "shell",
          depends_on: [],
          prompt: "Build it.",
        },
        { label: "test", backend: "shell", depends_on: ["build"], prompt: "Test it." },
      ],
    }),
  };
}

function failedRun(): MentuRun {
  return {
    id: "run-9",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-9",
    mentuRunId: "run_fixture_9",
    status: "failed",
    startedAt: "t",
    endedAt: "t",
    steps: [],
    error: "test failed",
    retryOf: null,
  };
}

function runningRun(): MentuRun {
  return { ...failedRun(), id: "run-10", status: "running", error: null };
}

function agentSession(): Session {
  return {
    id: "s-agent",
    workspaceId: "ws",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-07T00:00:00Z",
    harnessId: "claude",
    agentState: "idle",
  };
}

/** A bridge plus a dispatch context whose fake agent session "starts" the
 *  run when the prompt is written: the run row appears only after the write,
 *  exactly like the real daemon's row appearing after the agent's CLI call. */
function delegatedHarness() {
  const bridge = fakeBridge();
  let started = false;
  const write = vi.fn(
    async (_input: { sessionId: string; incarnation: string; text: string }) => {
      started = true;
      return ok({ acceptedBytes: 1 });
    },
  );
  bridge.mentuRuns = vi.fn(async () =>
    ok({ runs: started ? [{ ...runningRun(), approvalId: "approval-1" }] : [] }),
  );
  const dispatchContext = {
    activeSessionId: "s-agent",
    mainSession: agentSession(),
    deps: {
      sessions: async () => ok({ sessions: [agentSession()] }),
      write,
    },
  };
  return { bridge, write, dispatchContext };
}

const ok = <T,>(result: T) => ({ ok: true as const, result });

function fakeBridge(): MentuBridge & Record<string, ReturnType<typeof vi.fn>> {
  return {
    mentuRecipes: vi.fn(async () => ok({ recipes: [{ id: "demo", path: "demo", name: "demo", valid: true, issue: null }] })),
    mentuRecipe: vi.fn(async () => ok({ recipe: recipe() })),
    mentuRuntime: vi.fn(async () =>
      ok({
        runtime: {
          available: true,
          path: "/bin/mentu-recipes",
          version: "fixture",
          expectedRevision: "r",
          expectedSha256: "s",
          actualSha256: "s",
          lockMatches: true,
          message: null,
        },
      }),
    ),
    mentuApprove: vi.fn(async () =>
      ok({
        approval: { id: "approval-1", workspaceId: "ws", recipeId: "demo", contentHash: HASH, approvedAt: "t" },
      }),
    ),
    mentuRun: vi.fn(async () => ok({ run: runningRun() })),
    mentuRuns: vi.fn(async () => ok({ runs: [] as MentuRun[] })),
    mentuRunStatus: vi.fn(async () => ok({ run: runningRun() })),
    mentuRetry: vi.fn(async () => ok({ run: runningRun() })),
    mentuCancel: vi.fn(async () => ok({ run: { ...runningRun(), status: "cancelled" as const } })),
  };
}

async function selectRecipe(ws: string) {
  mentuStore.set(ws, { selectedRecipeId: "demo" });
  await waitFor(() => expect(screen.getByTestId("mentu-panel-plan")).toBeTruthy());
}

describe("MentuPanel", () => {
  it("renders the header copy and opens the full tab", async () => {
    const ws = `ws-header-${Math.random()}`;
    const bridge = fakeBridge();
    const onOpenFullTab = vi.fn();
    render(<MentuPanel bridge={bridge} workspaceId={ws} onOpenFullTab={onOpenFullTab} />);
    expect(screen.getByText("Workspace source: .mentu/recipes")).toBeTruthy();
    fireEvent.click(screen.getByText("Open full tab"));
    expect(onOpenFullTab).toHaveBeenCalledTimes(1);

    const seen: string[] = [];
    window.addEventListener(MENTU_OPEN_TAB_EVENT, () => seen.push("opened"), { once: true });
    cleanup();
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    fireEvent.click(screen.getByText("Open full tab"));
    expect(seen).toEqual(["opened"]);
  });

  it("delegates Review → Approve & run to the main agent session instead of calling mentu.run", async () => {
    const ws = `ws-flow-${Math.random()}`;
    const { bridge, write, dispatchContext } = delegatedHarness();
    render(
      <MentuPanel bridge={bridge} workspaceId={ws} dispatchContext={dispatchContext} />,
    );
    await selectRecipe(ws);
    expect(screen.getByText("build")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mentu-run"));
    await waitFor(() => expect(screen.getByTestId("mentu-review")).toBeTruthy());
    expect(screen.getByText("Approve & run")).toBeTruthy();

    fireEvent.click(screen.getByText("Approve & run"));
    await waitFor(() => expect(screen.getByTestId("mentu-cancel")).toBeTruthy());
    expect(bridge.mentuApprove).toHaveBeenCalledTimes(1);
    // The thesis in one assertion: the UI did NOT run the recipe; it handed
    // the approved prompt to the agent, which is what creates the run row.
    expect(bridge.mentuRun).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0][0];
    expect(written.sessionId).toBe("s-agent");
    expect(written.text).toContain("drogon-cli mentu run --workspace");
    expect(written.text).toContain("--approval approval-1");
    expect(written.text.endsWith("\r")).toBe(true);
    // The run was adopted from the daemon's own row by approval id.
    expect(screen.getByTestId("mentu-dispatch-notice").textContent).toContain(
      "Run run-10 started by the agent session s-agent",
    );
  });

  it("says nothing was run when the workspace has no agent session", async () => {
    const ws = `ws-nosession-${Math.random()}`;
    const bridge = fakeBridge();
    render(
      <MentuPanel
        bridge={bridge}
        workspaceId={ws}
        dispatchContext={{
          activeSessionId: null,
          mainSession: null,
          deps: {
            sessions: async () => ok({ sessions: [] as Session[] }),
            write: async () => ok({ acceptedBytes: 0 }),
          },
        }}
      />,
    );
    await selectRecipe(ws);
    fireEvent.click(screen.getByTestId("mentu-run"));
    await waitFor(() => expect(screen.getByTestId("mentu-review")).toBeTruthy());
    fireEvent.click(screen.getByText("Approve & run"));
    await waitFor(() =>
      expect(screen.getByTestId("mentu-panel-status").textContent).toContain(
        "No agent session is open in this workspace",
      ),
    );
    expect(bridge.mentuRun).not.toHaveBeenCalled();
    // The approval exists but nothing ran: the row stays absent.
    expect(screen.queryByTestId("mentu-cancel")).toBeNull();
  });

  it("routes an execution failure to the evidence view", async () => {
    const ws = `ws-failed-${Math.random()}`;
    const bridge = fakeBridge();
    bridge.mentuRuns = vi.fn(async () => ok({ runs: [failedRun()] }));
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    await selectRecipe(ws);
    expect(screen.getByText("Recipe execution failed:")).toBeTruthy();
    fireEvent.click(screen.getByText("View evidence"));
    await waitFor(() => expect(screen.getByTestId("recipe-evidence")).toBeTruthy());
    // The failure surfaces both in the runtime message and the evidence.
    expect(screen.getAllByText("test failed")).toHaveLength(2);
  });

  it("returns to idle after a run settles and can run the recipe again", async () => {
    const ws = `ws-rerun-${Math.random()}`;
    const { bridge, write, dispatchContext } = delegatedHarness();
    // The first run settles on the next status poll.
    bridge.mentuRunStatus = vi.fn(async () =>
      ok({
        run: {
          ...runningRun(),
          approvalId: "approval-1",
          status: "succeeded" as const,
          endedAt: "t",
        },
      }),
    );
    render(
      <MentuPanel
        bridge={bridge}
        workspaceId={ws}
        dispatchContext={dispatchContext}
      />,
    );
    await selectRecipe(ws);
    // Review → Approve & run: the run starts through the delegated session.
    const runButton = screen.getByTestId("mentu-run");
    fireEvent.click(runButton);
    await waitFor(() => expect(screen.getByTestId("mentu-review")).toBeTruthy());
    fireEvent.click(runButton);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    // The adoption publishes the run, then its status poll settles it: the
    // button returns to idle instead of staying busy forever.
    await waitFor(() => expect(runButton.getAttribute("data-running")).toBe("false"));

    // A second approve dispatches again, not silently nothing.
    fireEvent.click(runButton);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  });

  it("the selected step inspects IN the panel — never a pointer to a tab that cannot show it", async () => {
    // The Mentu tab is the work graph (.drogon/graph.json); it knows
    // nothing about a mentu recipe step. The panel therefore carries the
    // step's real contract itself: the same SelectedNodeInspector the wide
    // recipe surface used, with the step's fields editable in place — and
    // the stale "Open the full tab" promise is gone.
    const ws = `ws-inspect-${Math.random()}`;
    const bridge = fakeBridge();
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    await selectRecipe(ws);
    expect(
      screen.queryByText("Step selected. Open the full tab for details and execution."),
    ).toBeNull();
    const graph = screen.getByTestId("recipe-graph");
    fireEvent.click(within(graph).getByText("build"));
    const inspector = await screen.findByTestId("recipe-node-inspector");
    expect(inspector.textContent).toContain("build");
  });
});
