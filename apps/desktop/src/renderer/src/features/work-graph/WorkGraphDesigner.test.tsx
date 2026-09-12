// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The authoring canvas's behavior tests over FAKE bridges that record every
// call: save writes ONLY the intent through `graph.write_intent` (the
// recorded payload never carries `state`); validation refusals never reach
// the bridge; designed-but-never-run renders differently from observed
// statuses; a live node's harness is locked and its deletion refused, and
// its model edit says "applies at the next launch"; cycles are refused
// through the real connect path; and Run goes compile → review → run with
// the runtime's own findings shown verbatim before anything launches.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  GraphBridge,
  GraphCompileParams,
  GraphCompileResult,
  GraphRunParams,
  GraphWriteIntentParams,
} from "../../../../shared/graph-contract";
import type { Harness } from "../../../../shared/session-contract";
import type { Result } from "../../../../shared/session-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { WorkGraphDesigner } from "./WorkGraphDesigner";

const HARNESS_FIXTURE: Harness[] = [
  {
    harnessId: "claude",
    displayName: "Claude Code",
    availability: "available",
    executable: "/fixture/claude",
  },
];

function ok<T>(result: T): Result<T> {
  return { ok: true, result };
}

type Recorded = {
  writes: GraphWriteIntentParams[];
  compiles: GraphCompileParams[];
  runs: GraphRunParams[];
};

function graphBridgeWith(input: {
  compile?: GraphCompileResult;
  runError?: string;
  runId?: string;
  writeResult?: WorkGraphDocument;
}): { bridge: GraphBridge; recorded: Recorded } {
  const recorded: Recorded = { writes: [], compiles: [], runs: [] };
  const bridge: GraphBridge = {
    graphRead: async () => ({
      ok: false as const,
      error: { code: "not_implemented", message: "not used in this test", retryable: false },
    }),
    graphWriteIntent: async (params) => {
      recorded.writes.push(params);
      return ok({
        graph: input.writeResult ?? {
          version: 1,
          intent: { nodes: (params.intent as { nodes: unknown[] }).nodes as never },
          state: { updatedAt: "now", nodes: [] },
        },
      });
    },
    graphCompile: async (params) => {
      recorded.compiles.push(params);
      return ok(
        input.compile ?? {
          recipeId: "graph-abc",
          recipe: {},
          contentHash: "deadbeefcafe0000",
          nodeIds: ["a", "b"],
          findings: [],
        },
      );
    },
    graphRun: async (params) => {
      recorded.runs.push(params);
      if (input.runError)
        return {
          ok: false as const,
          error: { code: "invalid_argument", message: input.runError, retryable: false },
        };
      return ok({
        run: { id: input.runId ?? "run-77", status: "running" },
        compile: input.compile ?? {
          recipeId: "graph-abc",
          recipe: {},
          contentHash: "deadbeefcafe0000",
          nodeIds: ["a", "b"],
          findings: [],
        },
      });
    },
    graphRunNodeFailover: async () => ({
      ok: false as const,
      error: { code: "not_implemented", message: "not used in this test", retryable: false },
    }),
  };
  return { bridge, recorded };
}

function seedDocument(nodes: Record<string, unknown>[]): WorkGraphDocument {
  return {
    version: 1,
    intent: { nodes: nodes as WorkGraphDocument["intent"]["nodes"] },
    state: {
      updatedAt: "2026-09-11T12:00:00.000Z",
      nodes: [
        {
          id: "live",
          status: "running" as const,
          runId: "run-live",
        },
      ],
    },
  };
}

function renderDesigner(
  graphDocument: WorkGraphDocument | null,
  bridge: GraphBridge | null,
  onDone: () => void = () => {},
) {
  window.drogon = {
    harnesses: async () => ok({ hostId: "host", harnesses: HARNESS_FIXTURE }),
    harnessModels: async () =>
      ok({
        hostId: "host",
        catalog: {
          harness: "claude",
          availability: "available",
          executable: "/fixture/claude",
          provenance: {
            executable: "/fixture/claude",
            argv: ["claude", "--list-models"],
            version: "2.1.0",
            probedAtEpochMs: Date.now(),
            configScope: "user",
          },
          entries: [
            {
              provider: "anthropic",
              id: "claude-sonnet-5",
              context: "200k",
              maxOutput: null,
              thinking: true,
              images: false,
            },
          ],
          status: "enumerated" as const,
          note: null,
          retainedRoots: [],
        },
      }),
  } as unknown as typeof window.drogon;
  return render(
    <WorkGraphDesigner
      graphBridge={bridge}
      workspaceId="ws-1"
      document={graphDocument}
      onDone={onDone}
    />,
  );
}

async function addNode(title: string) {
  fireEvent.click(await screen.findByTestId("design-add-node"));
  const name = await screen.findByTestId("design-field-title");
  fireEvent.change(name, { target: { value: title } });
  const prompt = screen.getByTestId("design-field-prompt");
  fireEvent.change(prompt, { target: { value: `do ${title.toLowerCase()}` } });
}

describe("WorkGraphDesigner", () => {
  afterEach(() => {
    cleanup();
    delete (window as { drogon?: unknown }).drogon;
  });

  it("a designed-but-never-run node renders differently from an observed one", async () => {
    renderDesigner(
      seedDocument([
        { id: "live", title: "Live node", harness: "shell", model: "", dependsOn: [], prompt: "p", enabled: true },
        { id: "fresh", title: "Fresh idea", harness: "shell", model: "", dependsOn: [], prompt: "p", enabled: true },
      ]),
      graphBridgeWith({}).bridge,
    );
    await screen.findByTestId("design-node-live");
    await screen.findByTestId("design-node-fresh");
    expect(screen.getByTestId("design-node-state-live").textContent).toMatch(/Running/i);
    expect(screen.getByTestId("design-node-state-fresh").textContent).toContain(
      "Designed — never run",
    );
  });

  it("saving a two-node design writes exactly the intent — no state, ever", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(null, bridge);
    await addNode("Plan");
    fireEvent.click(screen.getByTestId("design-add-node"));
    const title = screen.getByTestId("design-field-title");
    fireEvent.change(title, { target: { value: "Build" } });
    fireEvent.change(screen.getByTestId("design-field-prompt"), {
      target: { value: "pnpm build" },
    });
    // Build waits on Plan, via the inspector checkbox (the same connect
    // path the port drag drives).
    const buildCard = screen.getByTestId("design-node-build");
    fireEvent.click(buildCard);
    const dep = await screen.findByTestId("design-dep-plan");
    fireEvent.click(dep);
    fireEvent.click(screen.getByTestId("design-save"));

    await screen.findByTestId("design-status-saved");
    expect(recorded.writes).toHaveLength(1);
    expect(recorded.writes[0].workspaceId).toBe("ws-1");
    const intent = recorded.writes[0].intent as { nodes: Record<string, unknown>[] };
    expect(intent.nodes).toHaveLength(2);
    expect(intent.nodes[0]).toMatchObject({
      id: "plan",
      title: "Plan",
      harness: "shell",
      model: "",
      dependsOn: [],
      prompt: "do plan",
      enabled: true,
    });
    expect(intent.nodes[1]).toMatchObject({ id: "build", dependsOn: ["plan"] });
    expect("state" in recorded.writes[0]).toBe(false);
    expect("state" in recorded.writes[0].intent).toBe(false);
    for (const node of intent.nodes) expect("state" in node).toBe(false);
  });

  it("positions ride in the payload, and a drag then save persists them", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(null, bridge);
    await addNode("Solo");
    fireEvent.click(screen.getByTestId("design-save"));
    await screen.findByTestId("design-status-saved");
    const intent = recorded.writes[0].intent as { nodes: Record<string, unknown>[] };
    // The default placement produced coordinates the daemon preserves.
    expect(intent.nodes[0].position).toEqual({ x: 48, y: 24 });
  });

  it("a validation failure is refused locally — the bridge is never called", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(null, bridge);
    await addNode("Broken");
    // A blank title cannot pass validation.
    fireEvent.change(screen.getByTestId("design-field-title"), { target: { value: "  " } });
    // Clear the prompt too.
    fireEvent.change(screen.getByTestId("design-field-prompt"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("design-save"));
    const error = await screen.findByTestId("design-status-error");
    expect(error.textContent).toContain("title");
    expect(error.textContent).toContain("prompt");
    expect(recorded.writes).toHaveLength(0);
  });

  it("without a graph bridge, saving says honestly that this build cannot", async () => {
    renderDesigner(null, null);
    await addNode("Solo");
    fireEvent.click(screen.getByTestId("design-save"));
    const error = await screen.findByTestId("design-status-error");
    expect(error.textContent).toContain("unavailable in this desktop build");
  });

  it("a live node keeps its harness locked, cannot be deleted, and its model edit says next launch", async () => {
    renderDesigner(
      seedDocument([
        { id: "live", title: "Live node", harness: "claude", model: "", dependsOn: [], prompt: "p", enabled: true },
      ]),
      graphBridgeWith({}).bridge,
    );
    fireEvent.click(await screen.findByTestId("design-node-live"));
    const locked = await screen.findByTestId("design-harness-locked");
    expect(locked.textContent).toContain("live");
    expect(locked.textContent).toMatch(/start a new session/i);
    const harness = screen.getByTestId("design-field-harness");
    expect(harness.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByTestId("design-delete-refused").textContent).toContain("Stop the session");
    expect(screen.queryByTestId("design-delete")).toBeNull();
    // Model editable, but honestly queued.
    fireEvent.change(screen.getByTestId("design-field-model"), {
      target: { value: "claude-sonnet-5" },
    });
    expect(screen.getByTestId("design-next-launch-badge").textContent).toContain(
      "next launch",
    );
  });

  it("the connect path refuses a cycle with an honest notice and changes nothing", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(
      seedDocument([
        { id: "a", title: "A", harness: "shell", model: "", dependsOn: [], prompt: "pa", enabled: true },
        { id: "b", title: "B", harness: "shell", model: "", dependsOn: ["a"], prompt: "pb", enabled: true },
      ]),
      bridge,
    );
    // Select A and try to make it wait on B: B already waits on A.
    fireEvent.click(await screen.findByTestId("design-node-a"));
    fireEvent.click(await screen.findByTestId("design-dep-b"));
    const notice = await screen.findByTestId("design-notice");
    expect(notice.textContent).toMatch(/cycle/i);
    expect(recorded.writes).toHaveLength(0);
    // The checkbox did not flip: the refusal refused the mutation.
    expect(screen.getByTestId("design-dep-b").getAttribute("data-state")).not.toBe("checked");
  });

  it("deleting a node removes it and its incoming edges", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(
      seedDocument([
        { id: "a", title: "A", harness: "shell", model: "", dependsOn: [], prompt: "pa", enabled: true },
        { id: "b", title: "B", harness: "shell", model: "", dependsOn: ["a"], prompt: "pb", enabled: true },
      ]),
      bridge,
    );
    fireEvent.click(await screen.findByTestId("design-node-a"));
    fireEvent.click(await screen.findByTestId("design-delete"));
    await screen.findByTestId("design-node-b");
    expect(screen.queryByTestId("design-node-a")).toBeNull();
    fireEvent.click(screen.getByTestId("design-save"));
    await screen.findByTestId("design-status-saved");
    const intent = recorded.writes[0].intent as { nodes: { id: string; dependsOn: string[] }[] };
    expect(intent.nodes).toHaveLength(1);
    expect(intent.nodes[0].dependsOn).toEqual([]);
  });

  it("run goes through compile → review → run, showing the runtime's findings first", async () => {
    const compile: GraphCompileResult = {
      recipeId: "graph-abc",
      recipe: {},
      contentHash: "deadbeefcafe0000",
      nodeIds: ["a", "b"],
      findings: [
        {
          code: "verify_missing",
          severity: "warning",
          nodeId: "b",
          message: "No verify commands.",
          recommendation: null,
        },
      ],
    };
    const { bridge, recorded } = graphBridgeWith({ compile });
    let done = 0;
    renderDesigner(
      seedDocument([
        { id: "a", title: "A", harness: "shell", model: "", dependsOn: [], prompt: "pa", enabled: true },
        { id: "b", title: "B", harness: "shell", model: "", dependsOn: ["a"], prompt: "pb", enabled: true },
      ]),
      bridge,
      () => {
        done += 1;
      },
    );
    fireEvent.click(await screen.findByTestId("design-run"));
    const review = await screen.findByTestId("design-review");
    expect(review.textContent).toContain("a → b");
    expect(review.textContent).toContain("graph-abc");
    expect(review.textContent).toContain("verify_missing");
    expect(recorded.runs).toHaveLength(0);
    fireEvent.click(screen.getByTestId("design-review-approve"));
    await screen.findByTestId("design-run-launched");
    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0].nodeIds).toEqual(["a", "b"]);
    // Watch the graph returns to the read view.
    fireEvent.click(screen.getByTestId("design-watch"));
    await waitFor(() => expect(done).toBe(1));
  });

  it("an error-severity finding refuses the launch before graph.run is called", async () => {
    const compile: GraphCompileResult = {
      recipeId: "graph-abc",
      recipe: {},
      contentHash: "deadbeefcafe0000",
      nodeIds: ["a"],
      findings: [
        {
          code: "provider_missing",
          severity: "error",
          nodeId: "a",
          message: "a pi node needs an explicit provider binding.",
          recommendation: "set provider.baseUrl",
        },
      ],
    };
    const { bridge, recorded } = graphBridgeWith({ compile, runError: "should not be called" });
    renderDesigner(
      seedDocument([
        { id: "a", title: "A", harness: "pi", model: "m", dependsOn: [], prompt: "pa", enabled: true },
      ]),
      bridge,
    );
    fireEvent.click(await screen.findByTestId("design-run"));
    await screen.findByTestId("design-review");
    fireEvent.click(screen.getByTestId("design-review-approve"));
    const notice = await screen.findByTestId("design-notice");
    expect(notice.textContent).toContain("would not validate");
    expect(recorded.runs).toHaveLength(0);
  });

  it("run-to-selected compiles the node target, not the whole graph", async () => {
    const { bridge, recorded } = graphBridgeWith({});
    renderDesigner(
      seedDocument([
        { id: "a", title: "A", harness: "shell", model: "", dependsOn: [], prompt: "pa", enabled: true },
        { id: "b", title: "B", harness: "shell", model: "", dependsOn: ["a"], prompt: "pb", enabled: true },
      ]),
      bridge,
    );
    fireEvent.click(await screen.findByTestId("design-node-b"));
    fireEvent.click(screen.getByTestId("design-run-selected"));
    await screen.findByTestId("design-review");
    fireEvent.click(screen.getByTestId("design-review-approve"));
    await screen.findByTestId("design-run-launched");
    expect(recorded.compiles[0].nodeId).toBe("b");
    expect(recorded.runs[0].nodeId).toBe("b");
  });

  it("the real model catalog feeds the picker's honest status line", async () => {
    renderDesigner(
      seedDocument([
        { id: "live", title: "Live node", harness: "claude", model: "", dependsOn: [], prompt: "p", enabled: true },
      ]),
      graphBridgeWith({}).bridge,
    );
    fireEvent.click(await screen.findByTestId("design-node-live"));
    const readout = await screen.findByTestId("design-model-readout");
    await waitFor(() =>
      expect(readout.textContent).toContain("1 model enumerated"),
    );
    expect(readout.textContent).toContain("claude 2.1.0");
    // The picker lists the host-enumerated id as host-verified.
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    const listbox = await screen.findByRole("listbox", { name: "Models" });
    expect(listbox.textContent).toContain("claude-sonnet-5");
    // Host-enumerated AND Drogon-recommended → the recommended marker;
    // the known-catalog aliases stay explicitly unverified.
    expect(listbox.textContent).toContain("recommended");
    expect(listbox.textContent).toContain("unverified");
  });
});
