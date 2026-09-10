// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the ported recipe-pane views: the evidence view
// spells per-step status, exit codes, evidence paths and error text from
// the daemon run record; the metrics view aggregates reported durations
// and observed token usage, staying honestly unavailable for everything
// the record does not carry.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MentuRecipeDetail, MentuRun } from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { buildRecipeGraph } from "./recipe-graph";
import { EmptyRecipeState, EvidenceView, GraphView, MetricsView } from "./recipe-pane-views";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const HASH = "a".repeat(64);

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
        verifyCommands: ["test -f out.txt"],
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
    source: "{}",
  };
}

function run(): MentuRun {
  return {
    id: "run-1",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-1",
    mentuRunId: "run_fixture_1",
    status: "failed",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:00:05Z",
    steps: [
      {
        label: "build",
        backend: "shell",
        status: "succeeded",
        exitCode: 0,
        durationSeconds: 4,
        attempts: 1,
        outputPath: "build.stdout",
        errorPath: "build.stderr",
        error: null,
        verification: {
          errors: ["Verification command failed: test -f out.txt"],
          warnings: [],
        },
      },
      {
        label: "test",
        backend: "shell",
        status: "failed",
        exitCode: 3,
        durationSeconds: null,
        attempts: 2,
        outputPath: null,
        errorPath: null,
        error: "step exited with code 3",
        verification: null,
      },
    ],
    error: "test failed",
    retryOf: null,
  };
}

describe("GraphView", () => {
  it("renders one tree node per step with run badges", () => {
    const graph = buildRecipeGraph(recipe().steps);
    render(
      <GraphView graph={graph} run={run()} selectedNodeId={null} onSelectNode={() => {}} />,
    );
    const tree = screen.getByTestId("recipe-graph");
    expect(tree.getAttribute("role")).toBe("tree");
    expect(screen.getByText("build")).toBeTruthy();
    expect(screen.getByText("Depends on 1 node")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});

describe("EvidenceView", () => {
  it("spells status, exit codes, evidence paths and error text", () => {
    render(<EvidenceView run={run()} recipe={recipe()} />);
    expect(screen.getByTestId("recipe-evidence")).toBeTruthy();
    expect(screen.getByText("run_fixture_1")).toBeTruthy();
    expect(screen.getByText("Failed · exit 3")).toBeTruthy();
    expect(screen.getByText("stdout: build.stdout")).toBeTruthy();
    expect(screen.getByText("step exited with code 3")).toBeTruthy();
    expect(screen.getByText("test failed")).toBeTruthy();
    // Recorded verification results surface with counts and details…
    expect(screen.getByText("Verification: 1 error, 0 warnings")).toBeTruthy();
    fireEvent.click(screen.getByText("Verification details"));
    expect(screen.getByText("Verification command failed: test -f out.txt")).toBeTruthy();
    // …while a step the record says nothing about stays honestly unrecorded.
    expect(screen.getByText("Verification: not recorded")).toBeTruthy();
  });

  it("is honest when no run is loaded", () => {
    render(<EvidenceView run={null} recipe={recipe()} />);
    expect(screen.getByText("No run evidence is loaded for this recipe.")).toBeTruthy();
  });
});

describe("MetricsView", () => {
  it("aggregates reported durations and marks the rest unavailable", () => {
    render(<MetricsView run={run()} />);
    expect(screen.getByTestId("recipe-metrics")).toBeTruthy();
    // One of two steps reports a duration: partial total, not exact.
    expect(screen.getByText("Duration: 4s + 1 unknown")).toBeTruthy();
    expect(screen.getAllByText("Input tokens: unavailable")).toHaveLength(3);
    expect(screen.getAllByText("Output tokens: unavailable")).toHaveLength(3);
    expect(screen.getByText("Cost: unavailable")).toBeTruthy();
    expect(screen.getByText("Scope: recipe · session aggregate: unavailable")).toBeTruthy();
    // Per-step rows carry outcome, duration, exit and harness.
    expect(screen.getByText("Outcome: Succeeded")).toBeTruthy();
    expect(screen.getByText("Process exit: 0")).toBeTruthy();
    expect(screen.getAllByText("Harness: shell")).toHaveLength(2);
    expect(screen.getAllByText("Model: unavailable")).toHaveLength(2);
  });

  it("marks duration unavailable when the record carries none", () => {
    const empty = run();
    empty.steps = empty.steps.map((step) => ({ ...step, durationSeconds: null }));
    render(<MetricsView run={empty} />);
    expect(screen.getByText("Duration: unavailable")).toBeTruthy();
  });

  it("is honest when no run is loaded", () => {
    render(<MetricsView run={null} />);
    expect(
      screen.getByText("No measurements are available until a run record is loaded."),
    ).toBeTruthy();
  });

  it("aggregates retry token totals once per recorded attempt", () => {
    // Ported from the reference's "aggregates duration/tokens once per
    // recorded attempt without deduplicating by label": each entry is one
    // attempt's own counts; the lifetime `attempts` counter never sums.
    const retried = run();
    retried.steps = [
      {
        label: "recover",
        backend: "pi",
        status: "failed",
        exitCode: 1,
        durationSeconds: 3,
        attempts: 1,
        outputPath: null,
        errorPath: null,
        error: null,
        verification: null,
        model: "model-a",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          usageKnown: true,
          invalid: [],
        },
      },
      {
        label: "recover",
        backend: "pi",
        status: "succeeded",
        exitCode: 0,
        durationSeconds: 2,
        attempts: 2,
        outputPath: null,
        errorPath: null,
        error: null,
        verification: null,
        model: "model-b",
        usage: {
          inputTokens: 40,
          outputTokens: null,
          usageKnown: true,
          invalid: [],
        },
      },
    ];
    render(<MetricsView run={retried} />);
    expect(screen.getByText("Duration: 5s")).toBeTruthy();
    expect(screen.getByText("Input tokens: 140")).toBeTruthy();
    expect(screen.getByText("Output tokens: 50 + 1 unknown")).toBeTruthy();
    expect(screen.getByText("Attempt 1 of 2")).toBeTruthy();
    expect(screen.getByText("Attempt 2 of 2")).toBeTruthy();
    expect(screen.getByText("Model: model-a")).toBeTruthy();
    expect(screen.getByText("Model: model-b")).toBeTruthy();
    expect(screen.getByText("Input tokens: 100 (exact)")).toBeTruthy();
    expect(screen.getByText("Input tokens: 40 (exact)")).toBeTruthy();
    expect(screen.getByText("Output tokens: 50 (exact)")).toBeTruthy();
    expect(screen.getByText("Output tokens: unavailable")).toBeTruthy();
  });

  it("distinguishes a measured zero from unreported and rejected values", () => {
    const mixed = run();
    mixed.steps = [
      {
        label: "measured",
        backend: "pi",
        status: "succeeded",
        exitCode: 0,
        durationSeconds: 1,
        attempts: 1,
        outputPath: null,
        errorPath: null,
        error: null,
        verification: null,
        usage: {
          inputTokens: 0,
          outputTokens: 5,
          usageKnown: true,
          invalid: [],
        },
      },
      {
        label: "rejected",
        backend: "pi",
        status: "succeeded",
        exitCode: 0,
        durationSeconds: 1,
        attempts: 1,
        outputPath: null,
        errorPath: null,
        error: null,
        verification: null,
        usage: {
          inputTokens: null,
          outputTokens: null,
          usageKnown: null,
          invalid: [{ field: "input_tokens", reason: "negative" }],
        },
      },
    ];
    render(<MetricsView run={mixed} />);
    expect(screen.getByText("Input tokens: 0 + 1 unknown + 1 invalid")).toBeTruthy();
    expect(screen.getByText("Output tokens: 5 + 1 unknown")).toBeTruthy();
    expect(screen.getByText("Input tokens: 0 (exact)")).toBeTruthy();
    expect(screen.getByText("Input tokens: unavailable (negative)")).toBeTruthy();
  });

  it("keeps cost unavailable even when the record reports tokens", () => {
    const billed = run();
    billed.steps = billed.steps.map((step) => ({
      ...step,
      usage: { inputTokens: 10, outputTokens: 10, usageKnown: true, invalid: [] },
    }));
    render(<MetricsView run={billed} />);
    expect(screen.getByText("Cost: unavailable")).toBeTruthy();
    expect(screen.getByText("Scope: recipe · session aggregate: unavailable")).toBeTruthy();
  });
});

describe("EmptyRecipeState", () => {
  it("counts hidden invalid recipes", () => {
    render(<EmptyRecipeState invalidCount={2} />);
    expect(screen.getByText("Select a valid workspace recipe to view its graph.")).toBeTruthy();
    expect(screen.getByText("2 invalid recipe files hidden from selection.")).toBeTruthy();
  });
});
