// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Pane tests over a fixture graph written through the SAME data seam the
// product uses (the files bridge), with evidence in the daemon's real
// shape (`{ runId, mentuRunId, step }` — the run-record step the backend's
// state writer embeds). Covers: the graph renders the leader/children DAG
// with real statuses; selecting a node shows its evidence (exit code,
// duration, usage) ON the node and resolves the recorded stdout/stderr
// through `mentu.run_evidence`; the shell vs agent metrics distinction;
// `unverifiable` renders as its own outcome; a live re-read changes a
// node's status mid-"run"; and the pane never writes — the fake bridge
// throws on fileWrite, and the static scan test pins that
// features/work-graph contains no write call at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  FileBridge,
  FileReadResult,
} from "../../../../shared/file-contract";
import type {
  MentuBridge,
  MentuRunEvidenceResult,
} from "../../../../shared/mentu-contract";
import type { GraphBridge } from "../../../../shared/graph-contract";
import type { Result, Session } from "../../../../shared/session-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { WorkGraphPane } from "./WorkGraphPane";
import type { MentuDispatchDeps } from "../mentu/mentu-run-dispatch";
import {
  reviewNodeId,
  runToken,
} from "../work-graph-workflows/adversarial-loop";

beforeEach(installRadixJsdomStubs);

function stepEvidence(label: string, overrides: Record<string, unknown> = {}) {
  return {
    label,
    backend: "pi",
    status: "succeeded",
    exitCode: 0,
    durationSeconds: 60,
    attempts: 1,
    outputPath: ".drogon/runs/run-1/leader.out",
    errorPath: null,
    error: null,
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    usage: {
      inputTokens: 120,
      outputTokens: 45,
      usageKnown: true,
      invalid: [],
    },
    ...overrides,
  };
}

const GRAPH: WorkGraphDocument = {
  version: 1,
  intent: {
    nodes: [
      {
        id: "leader",
        title: "Plan the migration",
        harness: "pi",
        model: "qwen3.8-flash-next-nvidia-nvfp4",
        dependsOn: [],
        prompt: "Read the repo and plan the migration.",
        enabled: true,
      },
      {
        id: "build",
        title: "Build",
        harness: "shell",
        model: "",
        dependsOn: ["leader"],
        prompt: "pnpm build",
        enabled: true,
      },
      {
        id: "review",
        title: "Review changes",
        harness: "pi",
        model: "",
        dependsOn: ["leader"],
        prompt: "",
        enabled: false,
      },
    ],
  },
  state: {
    updatedAt: "2026-09-11T12:00:00.000Z",
    nodes: [
      {
        id: "leader",
        status: "succeeded",
        runId: "run-1",
        mentuRunId: "run_abc123",
        startedAt: "2026-09-11T11:58:00.000Z",
        endedAt: "2026-09-11T11:59:00.000Z",
        evidence: {
          runId: "run-1",
          mentuRunId: "run_abc123",
          step: stepEvidence("leader"),
        },
      },
      { id: "build", status: "running" },
      // Loss of contact: the graph must SAY unverifiable, never succeed/fail.
      { id: "review", status: "unverifiable" },
    ],
  },
};

function bridgeWith(
  raw: string,
  evidence?: {
    calls: { runId: string }[];
    result: MentuRunEvidenceResult | null;
  },
): FileBridge {
  return {
    fileList: async () => {
      throw new Error("not used");
    },
    fileRead: async (): Promise<Result<FileReadResult>> => ({
      ok: true,
      result: {
        hostId: "host",
        workspaceId: "ws",
        path: ".drogon/graph.json",
        content: raw,
        size: raw.length,
        mtime: "2026-09-11T12:00:00.000Z",
      },
    }),
    // The pane is read-only: any write is a test failure, not a silent no-op.
    fileWrite: async () => {
      throw new Error("work-graph pane attempted a write");
    },
    // Satisfy the structural type; evidence resolution rides the Mentu bridge.
    fileCreate: async () => {
      throw new Error("work-graph pane attempted a create");
    },
  } as unknown as FileBridge;
}

function mentuBridgeWith(evidence: {
  calls: { runId: string }[];
  result: MentuRunEvidenceResult | null;
}): MentuBridge {
  const bridge = {
    mentuRunEvidence: async (input: { runId: string }) => {
      evidence.calls.push(input);
      if (!evidence.result) {
        return {
          ok: false as const,
          error: {
            code: "not_found",
            message: "run directory is gone",
            retryable: false,
          },
        };
      }
      return { ok: true as const, result: evidence.result };
    },
  };
  return bridge as unknown as MentuBridge;
}

function renderPane(raw: string, mentuBridge?: MentuBridge) {
  return render(
    <WorkGraphPane
      fileBridge={bridgeWith(raw)}
      mentuBridge={mentuBridge}
      hostId="host"
      workspaceId="ws"
    />,
  );
}

describe("WorkGraphPane", () => {
  afterEach(cleanup);

  it("renders the DAG with real statuses and the aggregate strip", async () => {
    renderPane(JSON.stringify(GRAPH));
    await screen.findByTestId("work-graph-pane");
    await screen.findByText("Plan the migration");
    await screen.findByText("Build");
    await screen.findByText("Review changes");

    expect(screen.getAllByTestId("work-graph-canvas").length).toBeGreaterThan(
      0,
    );

    // Status badges render the daemon's own words.
    expect(
      document.querySelector('[data-work-graph-status="running"]'),
    ).not.toBeNull();
    const unverifiable = document.querySelector(
      '[data-work-graph-status="unverifiable"]',
    );
    expect(unverifiable).not.toBeNull();
    expect(unverifiable?.textContent).toContain("Unverifiable");

    // Aggregates: one running, one succeeded, one unverifiable; duration
    // from the step's recorded durationSeconds; tokens from the one agent
    // record (the shell node contributes nothing at all).
    expect(
      screen.getByTestId("work-graph-total-running").textContent,
    ).toContain("1");
    expect(
      screen.getByTestId("work-graph-total-succeeded").textContent,
    ).toContain("1");
    expect(
      screen.getByTestId("work-graph-total-unverifiable").textContent,
    ).toContain("1");
    const totals = screen.getByTestId("work-graph-totals").textContent ?? "";
    // Only the leader recorded a duration; the running and unverifiable
    // nodes' durations stay unknown and are COUNTED, never estimated.
    expect(totals).toContain("Duration: 1m 00s + 2 unknown");
    // The review agent node reported no usage: counted as unavailable,
    // never estimated. The shell node contributes nothing at all.
    expect(totals).toContain("Input tokens: 120 + 1 unavailable");
    expect(totals).toContain("Output tokens: 45 + 1 unavailable");
    expect(totals).toContain("Cost: unavailable");
  });

  it("shows the selected node's evidence ON the node and resolves its streams", async () => {
    const evidence: {
      calls: { runId: string }[];
      result: MentuRunEvidenceResult | null;
    } = {
      calls: [],
      result: {
        runId: "run-1",
        mentuRunId: "run_abc123",
        evidence: [
          {
            label: "leader",
            stdout: {
              reference: "leader.out",
              path: ".drogon/runs/run-1/leader.out",
              content: "plan ready",
              error: null,
            },
            stderr: {
              reference: "leader.err",
              path: ".drogon/runs/run-1/leader.err",
              content: null,
              error: null,
            },
          },
        ],
      },
    };
    renderPane(JSON.stringify(GRAPH), mentuBridgeWith(evidence));
    fireEvent.click(await screen.findByText("Plan the migration"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    // Streams resolved through the EXISTING mentu.run_evidence seam.
    await waitFor(() => expect(evidence.calls).toEqual([{ runId: "run-1" }]));
    const stdout = await waitFor(() => {
      const found = inspector.querySelector('pre[aria-label="stdout output"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(stdout.textContent).toContain("plan ready");
    const inspectorText = inspector.textContent ?? "";
    expect(inspectorText).toContain("Exit code:");
    expect(inspectorText).toContain("run-1");
    expect(inspectorText).toContain("run_abc123");
    expect(inspectorText).toContain("qwen3.8-flash-next-nvidia-nvfp4");
    expect(inspectorText).toContain("120");
    expect(inspectorText).toContain("45");
  });

  it("renders a shell node's token metrics as NOT APPLICABLE, not unavailable", async () => {
    renderPane(JSON.stringify(GRAPH));
    fireEvent.click(await screen.findByText("Build"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    const na = await waitFor(() => {
      const found = inspector.querySelector(
        '[data-testid="work-graph-node-usage-na"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(na.textContent).toContain("not applicable (shell node)");
  });

  it("marks a disabled intent node as not-to-relaunch (deleting ≠ killing)", async () => {
    renderPane(JSON.stringify(GRAPH));
    fireEvent.click(await screen.findByText("Review changes"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    const badge = await waitFor(() => {
      const found = inspector.querySelector(
        '[data-testid="work-graph-node-disabled-badge"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(badge.textContent).toContain("not to relaunch");
  });

  it("shows an honest empty state when the workspace has no graph yet", async () => {
    const missingBridge: FileBridge = {
      fileList: async () => {
        throw new Error("not used");
      },
      fileRead: async () => ({
        ok: false as const,
        error: {
          code: "not_found",
          message: "file not found",
          retryable: false,
        },
      }),
      fileWrite: async () => {
        throw new Error("work-graph pane attempted a write");
      },
    };
    render(
      <WorkGraphPane
        fileBridge={missingBridge}
        hostId="host"
        workspaceId="ws"
      />,
    );
    const empty = await screen.findByTestId("work-graph-empty");
    expect(empty.textContent).toContain(".drogon/graph.json");
  });

  it("refuses an unsupported graph version honestly", async () => {
    const future = { ...GRAPH, version: 99 };
    renderPane(JSON.stringify(future));
    const invalid = await screen.findByTestId("work-graph-invalid");
    expect(invalid.textContent).toContain("version 99");
  });

  it("live-updates: the next read flips a node's status mid-run", async () => {
    const first = structuredClone(GRAPH);
    const view = renderPane(JSON.stringify(first));
    await screen.findByText("Build");
    expect(
      document.querySelector('[data-work-graph-status="running"]'),
    ).not.toBeNull();

    // The daemon settles the node and the poller re-reads the file.
    const settled = structuredClone(GRAPH);
    settled.state.nodes = settled.state.nodes.map((node) =>
      node.id === "build"
        ? {
            ...node,
            status: "failed" as const,
            endedAt: "2026-09-11T12:01:00.000Z",
            lastError: "Completion policy was not satisfied",
            evidence: {
              runId: "run-2",
              step: stepEvidence("build", {
                status: "failed",
                exitCode: 1,
                durationSeconds: 30,
                error: "recipe compile failed",
                model: null,
                usage: null,
              }),
            },
          }
        : node,
    );
    view.rerender(
      <WorkGraphPane
        fileBridge={bridgeWith(JSON.stringify(settled))}
        hostId="host"
        workspaceId="ws"
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-work-graph-status="failed"]'),
      ).not.toBeNull(),
    );

    // The failing node carries its error and exit code on the node.
    fireEvent.click(screen.getByText("Build"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    await waitFor(() =>
      expect(inspector.textContent).toContain(
        "Completion policy was not satisfied",
      ),
    );
    expect(inspector.textContent).toContain("Exit code:");
    expect(inspector.textContent).toContain("1");
    // state.lastError is the primary error; step.error renders when the
    // state carries no lastError of its own.
    expect(inspector.textContent).toContain("30s");
  });

  it("a graph over the files-read cap is a named, recoverable state — not a dead tab", async () => {
    // The designer permits 65,536-byte prompts across many nodes, so a
    // legal graph can exceed files.v1's 65,536-byte per-read cap. The
    // files fallback must NAME the refusal and keep the tab recoverable:
    // the intact path, what happened, and refresh — never the bare
    // "file exceeds max_bytes limit" dead end.
    const oversize = {
      fileList: async () => {
        throw new Error("not used");
      },
      fileRead: async (): Promise<Result<FileReadResult>> => ({
        ok: false,
        error: {
          code: "invalid_argument",
          message: "file exceeds max_bytes limit",
          retryable: false,
        },
      }),
      fileWrite: async () => {
        throw new Error("work-graph pane attempted a write");
      },
      fileCreate: async () => {
        throw new Error("work-graph pane attempted a create");
      },
    } as unknown as FileBridge;
    render(
      <WorkGraphPane
        fileBridge={oversize}
        mentuBridge={null}
        hostId="host"
        workspaceId="ws"
      />,
    );
    const state = await screen.findByTestId("work-graph-too-large");
    expect(state.textContent).toContain("intact");
    expect(state.textContent).toContain(".drogon/graph.json");
    expect(state.textContent).toContain("65,536");
    // Recovery stays armed: refresh retries, so a fixed file re-renders.
    expect(screen.getByTestId("work-graph-refresh")).toBeTruthy();
    // And the designer must NOT open over an unread graph: an empty
    // canvas saved now would replace the real intent wholesale.
    const design = screen.getByTestId("work-graph-design");
    expect(design.getAttribute("disabled")).not.toBeNull();
    expect(design.getAttribute("data-blocked-reason") ?? "").toContain(
      "too large",
    );
  });

  it("writes nothing — a static scan over features/work-graph finds no write call", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const sources = readdirSync(dir).filter(
      (file) =>
        /\.(ts|tsx)$/.test(file) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, `${file} must not write`).not.toMatch(
        /\.fileWrite\(|\.fileCreate\(|\.fileRename\(|\.fileDelete\(/,
      );
    }
  });
});

function graphBridgeWith(graph: WorkGraphDocument): GraphBridge {
  return {
    graphRead: async () => ({ ok: true, result: { graph } }),
    graphWriteIntent: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphCompile: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRun: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRunNodeFailover: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
  };
}

function emptyGraph(): WorkGraphDocument {
  return {
    version: 1,
    intent: { nodes: [] },
    state: { updatedAt: "now", nodes: [] },
  } as unknown as WorkGraphDocument;
}

function liveSession(): Session {
  return {
    id: "s1",
    workspaceId: "ws",
    hostId: "host",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-01-01T00:00:00Z",
    harnessId: "claude",
  } as Session;
}

describe("WorkGraphPane orchestrator entry point", () => {
  afterEach(cleanup);
  // OrchestratorCanvas persists the last-known main session per workspace
  // (last-known-main-session.ts) so the exited/unverifiable fact survives a
  // reload; every test here reuses the same literal workspaceId "ws", so
  // that store must not leak between tests the way a real per-workspace
  // UUID never would.
  afterEach(() => window.localStorage.clear());

  it("switches to the Orchestrator canvas and threads the real main session through", async () => {
    const fileBridge = {
      fileRead: async () => ({
        ok: false as const,
        error: {
          code: "not_found",
          message: "unused in this test",
          retryable: false,
        },
      }),
    } as unknown as FileBridge;
    render(
      <WorkGraphPane
        fileBridge={fileBridge}
        graphBridge={graphBridgeWith(emptyGraph())}
        hostId="host"
        workspaceId="ws"
        mainSession={liveSession()}
      />,
    );
    fireEvent.click(await screen.findByTestId("work-graph-orchestrator"));
    await screen.findByTestId("orchestrator-canvas");
    expect(screen.getByTestId("orchestrator-main-agent").textContent).toContain(
      "claude",
    );
    expect(screen.getByTestId("subagent-policy-panel")).toBeTruthy();
  });

  it("renders the honest no-session disabled state when there is no main session", async () => {
    const fileBridge = {
      fileRead: async () => ({
        ok: false as const,
        error: {
          code: "not_found",
          message: "unused in this test",
          retryable: false,
        },
      }),
    } as unknown as FileBridge;
    render(
      <WorkGraphPane
        fileBridge={fileBridge}
        graphBridge={graphBridgeWith(emptyGraph())}
        hostId="host"
        workspaceId="ws"
        mainSession={null}
      />,
    );
    fireEvent.click(await screen.findByTestId("work-graph-orchestrator"));
    expect(screen.getByRole("textbox", { name: "Main task" })).toBeTruthy();
    expect(
      (screen.getByTestId("orchestrator-run-workflow") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("Back returns to the read-only Work Graph view", async () => {
    const fileBridge = {
      fileRead: async () => ({
        ok: false as const,
        error: {
          code: "not_found",
          message: "unused in this test",
          retryable: false,
        },
      }),
    } as unknown as FileBridge;
    render(
      <WorkGraphPane
        fileBridge={fileBridge}
        graphBridge={graphBridgeWith(emptyGraph())}
        hostId="host"
        workspaceId="ws"
        mainSession={liveSession()}
      />,
    );
    fireEvent.click(await screen.findByTestId("work-graph-orchestrator"));
    await screen.findByTestId("orchestrator-canvas");
    fireEvent.click(screen.getByTestId("orchestrator-back"));
    await screen.findByTestId("work-graph-orchestrator");
  });
});

// DISHONEST-1: "Run workflow" must actually dispatch the base work to the
// Main agent's live session and wait for it to genuinely settle before the
// review launches — never fire ~instantly against whatever already sits in
// the workspace.
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

function dispatchDepsWithSession(session: Session): {
  deps: MentuDispatchDeps;
  write: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(async () => ({
    ok: true as const,
    result: { acceptedBytes: 1 },
  }));
  const deps: MentuDispatchDeps = {
    sessions: async () => ({ ok: true, result: { sessions: [session] } }),
    write,
  };
  return { deps, write };
}

describe("WorkGraphPane durable orchestrator", () => {
  afterEach(cleanup);
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
    fireEvent.click(await screen.findByTestId("work-graph-orchestrator"));
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
      fireEvent.click(await screen.findByTestId("work-graph-orchestrator"));
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
