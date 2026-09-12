// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { FileBridge } from "../../../../shared/file-contract";
import type {
  GraphBridge,
  GraphWritePolicyParams,
} from "../../../../shared/graph-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { WorkGraphPane } from "./WorkGraphPane";
import { WorkGraphPanel, MENTU_OPEN_TAB_EVENT } from "./WorkGraphPanel";
beforeEach(installRadixJsdomStubs);
function graphWithAdversarialPolicy(): WorkGraphDocument {
  return {
    version: 1,
    intent: {
      nodes: [],
      policy: {
        approvedRuntimes: [],
        fallbackRuntime: null,
        adversarial: { enabled: true, maxIterations: 1 },
        delegate: false,
      },
    },
    state: { updatedAt: "now", nodes: [] },
  } as unknown as WorkGraphDocument;
}

/** A mutable fake graph bridge tracking every write/failover call, exactly
 *  like `use-adversarial-loop.test.tsx`'s own fixture — this test drives it
 *  through the REAL `WorkGraphPane` component instead of the hook directly. */
function mutableOrchestratorGraphBridge(policyDoc: WorkGraphDocument): {
  bridge: GraphBridge;
  writes: unknown[];
  failovers: { nodeId: string }[];
} {
  let intentNodes = policyDoc.intent.nodes as unknown as Record<
    string,
    unknown
  >[];
  const policy = (policyDoc.intent as unknown as { policy: unknown }).policy;
  const statuses = new Map<string, string>();
  const writes: unknown[] = [];
  const failovers: { nodeId: string }[] = [];
  const bridge: GraphBridge = {
    graphRead: async () => ({
      ok: true,
      result: {
        graph: {
          version: 1,
          intent: { nodes: intentNodes, policy } as never,
          state: {
            updatedAt: "now",
            nodes: [...statuses.entries()].map(([id, status]) => ({
              id,
              status,
            })) as never,
          },
        },
      },
    }),
    graphWriteIntent: async (params) => {
      writes.push(params);
      intentNodes = (params.intent as { nodes: Record<string, unknown>[] })
        .nodes;
      const newNode = intentNodes[intentNodes.length - 1];
      statuses.set(newNode.id as string, "idle");
      return {
        ok: true,
        result: {
          graph: {
            version: 1,
            intent: { nodes: intentNodes, policy } as never,
            state: { updatedAt: "now", nodes: [] },
          },
        },
      };
    },
    graphCompile: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRun: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRunNodeFailover: async (params) => {
      failovers.push({ nodeId: params.nodeId });
      statuses.set(params.nodeId, "succeeded");
      return {
        ok: true,
        result: {
          run: { id: `run-${params.nodeId}`, status: "running" },
          runtime: { harness: "pi", model: "qwen3.8-flash-next-nvidia-nvfp4" },
          isFallback: false,
          attemptNumber: 1,
          attempts: [
            {
              harness: "pi",
              model: "qwen3.8-flash-next-nvidia-nvfp4",
              outcome: "launched",
            },
          ],
        },
      };
    },
  };
  return { bridge, writes, failovers };
}

describe("WorkGraphPane durable orchestrator", () => {
  afterEach(cleanup);
  it("saves policy changes without an invalid empty main node", async () => {
    const document = graphWithAdversarialPolicy();
    const { bridge } = mutableOrchestratorGraphBridge(document);
    const write = vi.fn(async (input: GraphWritePolicyParams) => ({
      ok: true as const,
      result: {
        graph: {
          ...document,
          intent: {
            nodes: input.main ? [input.main] : [],
            policy: input.policy,
          },
        },
      },
    }));
    bridge.graphWritePolicy = write;
    const fileBridge = {
      fileRead: async () => ({
        ok: false,
        error: { code: "not_found", message: "missing", retryable: false },
      }),
    } as unknown as FileBridge;

    render(
      <WorkGraphPane
        fileBridge={fileBridge}
        graphBridge={bridge}
        hostId="host"
        workspaceId="ws"
      />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Main task",
          }) as HTMLTextAreaElement
        ).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByTestId("adversarial-toggle"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0]).toMatchObject({
      workspaceId: "ws",
      policy: { adversarial: { enabled: false } },
    });
    expect(write.mock.calls[0][0]).not.toHaveProperty("main");
    await waitFor(() =>
      expect(
        screen.getByTestId("orchestrator-save-status").textContent,
      ).toContain("Saved automatically"),
    );
  });
  it("retries the unsaved main task with the next policy edit before reporting Saved", async () => {
    const document = graphWithAdversarialPolicy();
    const { bridge } = mutableOrchestratorGraphBridge(document);
    const writes: unknown[] = [];
    bridge.graphWritePolicy = async (input) => {
      writes.push(input);
      if (writes.length === 1)
        return {
          ok: false,
          error: {
            code: "io_error",
            message: "Save unavailable",
            retryable: true,
          },
        };
      return {
        ok: true,
        result: {
          graph: {
            ...document,
            intent: {
              nodes: input.main ? [input.main] : [],
              policy: input.policy,
            },
          },
        },
      };
    };
    const fileBridge = {
      fileRead: async () => ({
        ok: false,
        error: { code: "not_found", message: "missing", retryable: false },
      }),
    } as unknown as FileBridge;
    render(
      <WorkGraphPane
        fileBridge={fileBridge}
        graphBridge={bridge}
        hostId="host"
        workspaceId="ws"
      />,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Main task",
          }) as HTMLTextAreaElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Main task" }), {
      target: { value: "Do not lose this task" },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("orchestrator-save-status").textContent,
      ).toContain("Save failed"),
    );
    fireEvent.click(screen.getByTestId("adversarial-toggle"));
    await waitFor(() =>
      expect(
        screen.getByTestId("orchestrator-save-status").textContent,
      ).toContain("Saved automatically"),
    );
    expect(writes[1]).toMatchObject({
      main: { id: "orchestrator-main", prompt: "Do not lose this task" },
      policy: { adversarial: { enabled: false } },
    });
  });
  it.each([false, true])(
    "starts concrete main task when testing enabled=%s",
    async (enabled) => {
      const document = graphWithAdversarialPolicy();
      document.intent.nodes.push({
        id: "orchestrator-main",
        title: "Main agent",
        harness: "pi",
        model: "fixture-model",
        prompt: "Task",
        enabled: true,
        dependsOn: [],
      });
      document.intent.policy!.adversarial.enabled = enabled;
      const { bridge, failovers } = mutableOrchestratorGraphBridge(document);
      bridge.graphWritePolicy = async ({ policy, main }) => ({
        ok: true,
        result: {
          graph: { ...document, intent: { nodes: main ? [main] : [], policy } },
        },
      });
      const start = vi.fn(async (_input: unknown) => ({
        ok: true as const,
        result: { run: null },
      }));
      bridge.graphOrchestratorStart = start;
      const fileBridge = {
        fileRead: async () => ({
          ok: false,
          error: { code: "not_found", message: "missing", retryable: false },
        }),
      } as unknown as FileBridge;
      render(
        <WorkGraphPane
          fileBridge={fileBridge}
          graphBridge={bridge}
          hostId="host"
          workspaceId="ws"
        />,
      );
      await waitFor(() =>
        expect(
          (
            screen.getByRole("textbox", {
              name: "Main task",
            }) as HTMLTextAreaElement
          ).disabled,
        ).toBe(false),
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Main task" }), {
        target: { value: "Implement the selected task" },
      });
      fireEvent.click(screen.getByTestId("orchestrator-run-workflow"));
      await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
      expect(start.mock.calls[0][0]).toMatchObject({
        workspaceId: "ws",
        main: {
          prompt: "Implement the selected task",
          id: "orchestrator-main",
        },
      });
      expect(failovers).toHaveLength(0);
    },
  );
});

describe("Work Graph is the orchestrator", () => {
  afterEach(cleanup);
  it("opens the policy directly for existing graphs, without legacy controls or file writes", async () => {
    const document = graphWithAdversarialPolicy();
    document.intent.nodes.push({
      id: "old-node",
      title: "Saved legacy task",
      harness: "shell",
      model: "",
      prompt: "true",
      enabled: true,
      dependsOn: [],
    });
    const { bridge, writes } = mutableOrchestratorGraphBridge(document);
    const fileRead = vi.fn();
    render(
      <WorkGraphPane
        fileBridge={{ fileRead } as unknown as FileBridge}
        graphBridge={bridge}
        hostId="host"
        workspaceId="ws"
      />,
    );
    await screen.findByRole("heading", { name: "Work Graph" });
    expect(
      screen.getByRole("heading", { name: "Subagent policy" }),
    ).toBeTruthy();
    for (const name of [
      "Add node",
      "Save intent",
      "New workflow",
      "Design graph",
      "Back to Work Graph",
      "Orchestrator",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByTestId("work-graph-orchestrator")).toBeNull();
    expect(fileRead).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(document.intent.nodes[0].id).toBe("old-node");
  });
  it("blocks writes and Run when an existing graph cannot be read", async () => {
    const { bridge } = mutableOrchestratorGraphBridge(
      graphWithAdversarialPolicy(),
    );
    bridge.graphRead = async () => ({
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid JSON",
        retryable: false,
      },
    });
    const write = vi.fn();
    bridge.graphWritePolicy = write;
    render(
      <WorkGraphPane
        fileBridge={null}
        graphBridge={bridge}
        hostId="host"
        workspaceId="ws"
      />,
    );
    await screen.findByRole("alert");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Main task",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("orchestrator-run-workflow") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
  it("sidebar opens the same persisted Work Graph tab, not the recipe editor", () => {
    const open = vi.fn();
    window.addEventListener(MENTU_OPEN_TAB_EVENT, open);
    try {
      render(<WorkGraphPanel workspaceId="ws" />);
      fireEvent.click(screen.getByRole("button", { name: "Open Work Graph" }));
      expect(open).toHaveBeenCalledTimes(1);
      expect((open.mock.calls[0][0] as CustomEvent).detail).toEqual({
        workspaceId: "ws",
      });
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByText("Select a recipe")).toBeNull();
    } finally {
      window.removeEventListener(MENTU_OPEN_TAB_EVENT, open);
    }
  });
});
