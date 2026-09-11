// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Pane tests over a real fixture graph written through the SAME data seam
// the product uses (the files bridge). Covers: the graph renders the
// leader/children DAG with real statuses; selecting a node shows its
// evidence (exit code, streams, drift, usage) ON the node; the shell vs
// agent metrics distinction; `unverifiable` renders as its own outcome; a
// live re-read changes a node's status mid-"run"; and the pane never
// writes — the fake bridge throws on fileWrite, and the static scan test
// pins that features/work-graph contains no write call at all.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FileBridge, FileReadResult } from "../../../shared/file-contract";
import type { Result } from "../../../shared/session-contract";
import type { WorkGraphDocument } from "../../../shared/work-graph-contract";
import { WorkGraphPane } from "./WorkGraphPane";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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
        model: null,
        dependsOn: ["leader"],
        prompt: "pnpm build",
        enabled: true,
      },
      {
        id: "review",
        title: "Review changes",
        harness: "pi",
        model: null,
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
        startedAt: "2026-09-11T11:58:00.000Z",
        endedAt: "2026-09-11T11:59:00.000Z",
        evidence: {
          exitCode: 0,
          stdout: "plan ready",
          stderr: null,
          stdoutPath: ".drogon/runs/run-1/leader.out",
          drift: { expected: ["docs/plan.md"], created: ["docs/plan.md"] },
          usage: {
            model: "qwen3.8-flash-next-nvidia-nvfp4",
            inputTokens: 120,
            outputTokens: 45,
            usageKnown: true,
          },
        },
      },
      { id: "build", status: "running" },
      // Loss of contact: the graph must SAY unverifiable, never succeed/fail.
      { id: "review", status: "unverifiable" },
    ],
  },
};

function bridgeWith(raw: string): FileBridge {
  return {
    fileList: async () => {
      throw new Error("not used");
    },
    fileRead: async (): Promise<Result<FileReadResult>> => ({
      ok: true,
      result: {
        hostId: "host",
        workspaceId: "ws",
        content: raw,
        size: raw.length,
        mtime: "2026-09-11T12:00:00.000Z",
      },
    }),
    // The pane is read-only: any write is a test failure, not a silent no-op.
    fileWrite: async () => {
      throw new Error("work-graph pane attempted a write");
    },
  };
}

function renderPane(raw: string) {
  return render(
    <WorkGraphPane fileBridge={bridgeWith(raw)} hostId="host" workspaceId="ws" />,
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

    const statuses = await screen.findAllByTestId("work-graph-canvas");
    expect(statuses.length).toBeGreaterThan(0);

    // Status badges render the daemon's own words.
    expect(document.querySelector('[data-work-graph-status="running"]')).not.toBeNull();
    const unverifiable = document.querySelector('[data-work-graph-status="unverifiable"]');
    expect(unverifiable).not.toBeNull();
    expect(unverifiable?.textContent).toContain("Unverifiable");

    // Aggregates: one running, one succeeded, one unverifiable; duration
    // from the single recorded start/end pair; tokens from the one agent
    // record (the shell node contributes nothing at all).
    expect(screen.getByTestId("work-graph-total-running").textContent).toContain("1");
    expect(screen.getByTestId("work-graph-total-succeeded").textContent).toContain("1");
    expect(screen.getByTestId("work-graph-total-unverifiable").textContent).toContain("1");
    const totals = screen.getByTestId("work-graph-totals").textContent ?? "";
    // Only the leader recorded start+end; the running and unverifiable
    // nodes' durations stay unknown and are COUNTED, never estimated.
    expect(totals).toContain("Duration: 1m 00s + 2 unknown");
    // The review agent node reported no usage: counted as unavailable,
    // never estimated. The shell node contributes nothing at all.
    expect(totals).toContain("Input tokens: 120 + 1 unavailable");
    expect(totals).toContain("Output tokens: 45 + 1 unavailable");
    expect(totals).toContain("Cost: unavailable");
  });

  it("shows the selected node's evidence ON the node", async () => {
    renderPane(JSON.stringify(GRAPH));
    fireEvent.click(await screen.findByText("Plan the migration"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    await waitFor(() => expect(inspector.textContent).toContain("plan ready"));
    expect(inspector.textContent).toContain("Exit code:");
    expect(inspector.textContent).toContain("run-1");
    expect(inspector.textContent).toContain("qwen3.8-flash-next-nvidia-nvfp4");
    expect(inspector.textContent).toContain("120");
    expect(inspector.textContent).toContain("45");
    // Drift: expected vs created paths.
    const drift = inspector.querySelector('[data-testid="work-graph-node-drift"]');
    expect(drift?.textContent).toContain("docs/plan.md");
    const stdout = inspector.querySelector('pre[aria-label="stdout output"]');
    expect(stdout?.textContent).toContain("plan ready");
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
    render(<WorkGraphPane fileBridge={missingBridge} hostId="host" workspaceId="ws" />);
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
            evidence: { exitCode: 1, stderr: "boom" },
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

    // The failing node carries its error and streams on the node.
    fireEvent.click(screen.getByText("Build"));
    const inspector = await screen.findByTestId("work-graph-node-inspector");
    await waitFor(() =>
      expect(inspector.textContent).toContain("Completion policy was not satisfied"),
    );
    expect(inspector.textContent).toContain("boom");
  });

  it("writes nothing — a static scan over features/work-graph finds no write call", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const sources = readdirSync(dir).filter((file) =>
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
