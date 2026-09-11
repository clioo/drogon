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

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FileBridge, FileReadResult } from "../../../../shared/file-contract";
import type {
  MentuBridge,
  MentuRunEvidenceResult,
} from "../../../../shared/mentu-contract";
import type { Result } from "../../../../shared/session-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { WorkGraphPane } from "./WorkGraphPane";

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
          error: { code: "not_found", message: "run directory is gone", retryable: false },
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

    expect(screen.getAllByTestId("work-graph-canvas").length).toBeGreaterThan(0);

    // Status badges render the daemon's own words.
    expect(document.querySelector('[data-work-graph-status="running"]')).not.toBeNull();
    const unverifiable = document.querySelector('[data-work-graph-status="unverifiable"]');
    expect(unverifiable).not.toBeNull();
    expect(unverifiable?.textContent).toContain("Unverifiable");

    // Aggregates: one running, one succeeded, one unverifiable; duration
    // from the step's recorded durationSeconds; tokens from the one agent
    // record (the shell node contributes nothing at all).
    expect(screen.getByTestId("work-graph-total-running").textContent).toContain("1");
    expect(screen.getByTestId("work-graph-total-succeeded").textContent).toContain("1");
    expect(screen.getByTestId("work-graph-total-unverifiable").textContent).toContain("1");
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
    await waitFor(() =>
      expect(evidence.calls).toEqual([{ runId: "run-1" }]),
    );
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
      const found = inspector.querySelector('[data-testid="work-graph-node-usage-na"]');
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
      const found = inspector.querySelector('[data-testid="work-graph-node-disabled-badge"]');
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
        error: { code: "not_found", message: "file not found", retryable: false },
      }),
      fileWrite: async () => {
        throw new Error("work-graph pane attempted a write");
      },
    };
    render(
      <WorkGraphPane fileBridge={missingBridge} hostId="host" workspaceId="ws" />,
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
    expect(document.querySelector('[data-work-graph-status="running"]')).not.toBeNull();

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
      expect(document.querySelector('[data-work-graph-status="failed"]')).not.toBeNull(),
    );

    // The failing node carries its error and exit code on the node.
    fireEvent.click(screen.getByText("Build"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    await waitFor(() =>
      expect(inspector.textContent).toContain("Completion policy was not satisfied"),
    );
    expect(inspector.textContent).toContain("Exit code:");
    expect(inspector.textContent).toContain("1");
    // state.lastError is the primary error; step.error renders when the
    // state carries no lastError of its own.
    expect(inspector.textContent).toContain("30s");
  });

  it("writes nothing — a static scan over features/work-graph finds no write call", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const sources = readdirSync(dir).filter(
      (file) =>
        /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
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
