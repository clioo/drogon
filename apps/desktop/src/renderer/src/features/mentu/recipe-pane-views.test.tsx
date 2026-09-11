// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the ported recipe-pane views: the evidence view
// spells per-step status, exit codes, evidence paths and error text from
// the daemon run record; the metrics view aggregates reported durations
// and observed token usage, staying honestly unavailable for everything
// the record does not carry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("marks the selected node with a SELECTED badge, a destructive border and its named single dependency", () => {
    const graph = buildRecipeGraph(recipe().steps);
    const testNodeId = graph.nodes.find((node) => node.label === "test")!.id;
    render(
      <GraphView graph={graph} run={run()} selectedNodeId={testNodeId} onSelectNode={() => {}} />,
    );
    expect(screen.getByTestId("mentu-node-selected-badge").textContent).toBe("SELECTED");
    const selectedButton = screen.getByRole("treeitem", { selected: true });
    expect(selectedButton.className).toContain("border-destructive");
    expect(selectedButton.textContent).toContain("· (build)");
    // The unselected node keeps the exact pre-existing status badge text,
    // never a SELECTED badge.
    const buildButton = screen.getByText("build").closest("button")!;
    expect(buildButton.querySelector('[data-testid="mentu-node-selected-badge"]')).toBeNull();
  });

  it("keeps the exact dependency-count phrase when nothing is selected (no name suffix)", () => {
    const graph = buildRecipeGraph(recipe().steps);
    render(<GraphView graph={graph} run={run()} selectedNodeId={null} onSelectNode={() => {}} />);
    expect(screen.getByText("Depends on 1 node").textContent).toBe("Depends on 1 node");
  });

  it("offers real, functional zoom controls that change the rendered scale", () => {
    const graph = buildRecipeGraph(recipe().steps);
    render(<GraphView graph={graph} run={run()} selectedNodeId={null} onSelectNode={() => {}} />);
    const canvas = screen.getByTestId("recipe-graph");
    expect(canvas.style.transform).toBe("scale(1)");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(canvas.style.transform).toBe("scale(1.1)");
    expect(screen.getByText("110%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(canvas.style.transform).toBe("scale(0.9)");
    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(canvas.style.transform).toBe("scale(1)");
    expect(screen.getByText("100%")).toBeTruthy();
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
  it("keeps the reference fallback copy when nothing is known", () => {
    render(<EmptyRecipeState invalidCount={0} />);
    expect(screen.getByText("Select a valid workspace recipe to view its graph.")).toBeTruthy();
  });

  it("names every refused recipe file with its reason (never silently skipped)", () => {
    render(
      <EmptyRecipeState
        invalidCount={2}
        invalidRecipes={[
          { id: "broken.json", path: ".mentu/recipes/broken.json", issue: "Invalid JSON: unexpected token" },
          { id: "thin.json", path: ".mentu/recipes/thin.json", issue: "Recipe is missing \"name\" or \"steps\"." },
        ]}
        directorySummary="The .mentu/recipes directory holds 2 files and none of them is a valid recipe."
        recipesPathLabel="/tmp/workspace/.mentu/recipes"
      />,
    );
    expect(
      screen.getByText(
        "The .mentu/recipes directory holds 2 files and none of them is a valid recipe.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 recipe files failed validation:")).toBeTruthy();
    expect(screen.getByText(".mentu/recipes/broken.json")).toBeTruthy();
    expect(screen.getByText("Invalid JSON: unexpected token")).toBeTruthy();
    expect(screen.getByText(".mentu/recipes/thin.json")).toBeTruthy();
    expect(screen.getByText('Recipe is missing "name" or "steps".')).toBeTruthy();
  });

  it("shows the real recipes path and the CLI status verb", () => {
    render(
      <EmptyRecipeState
        invalidCount={0}
        recipesPathLabel="/tmp/workspace/.mentu/recipes"
        workspaceId="ws-123"
      />,
    );
    expect(screen.getByText("/tmp/workspace/.mentu/recipes")).toBeTruthy();
    expect(
      screen.getByText("drogon-cli mentu status --workspace ws-123"),
    ).toBeTruthy();
  });

  it("blames the host, not the workspace, when the runtime is missing", () => {
    render(
      <EmptyRecipeState
        invalidCount={0}
        runtimeNote="No Mentu runtime is installed for this data directory."
      />,
    );
    expect(
      screen.getByText("No Mentu runtime is installed for this data directory."),
    ).toBeTruthy();
  });

  it("reports nested subproject recipes with provenance and a way forward", () => {
    render(
      <EmptyRecipeState
        invalidCount={0}
        directorySummary="No .mentu/recipes directory yet — this workspace has never had a recipe."
        recipesPathLabel="/Users/carlos/Documents/mentu-ai/.mentu/recipes"
        nestedFindings={[
          {
            relativeDir: "mentu-recipes/.mentu/recipes",
            total: 11,
            fileNames: ["demo-tareas.json", "claude-smoke.json", "demo-parallel.json"],
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "Recipes were found one directory down, under this workspace's subprojects:",
      ),
    ).toBeTruthy();
    expect(screen.getByText("mentu-recipes/.mentu/recipes")).toBeTruthy();
    expect(
      screen.getByText("demo-tareas.json, claude-smoke.json, demo-parallel.json, +8 more"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Mentu reads only the workspace root path above/),
    ).toBeTruthy();
    // Without the shell reveal affordance the button hides instead of lying.
    expect(screen.queryByRole("button", { name: /Reveal/ })).toBeNull();
  });

  it("offers the reveal affordance only when it can really act", () => {
    const onRevealNested = vi.fn();
    render(
      <EmptyRecipeState
        invalidCount={0}
        nestedFindings={[
          { relativeDir: "sub/.mentu/recipes", total: 2, fileNames: ["a.json"] },
        ]}
        onRevealNested={onRevealNested}
      />,
    );
    const reveal = screen.getByRole("button", { name: /Reveal/ });
    fireEvent.click(reveal);
    expect(onRevealNested).toHaveBeenCalledWith("sub/.mentu/recipes");
  });

  it("offers the starter-recipe affordance and reports a failed write", () => {
    const onCreateStarter = vi.fn();
    const { rerender } = render(
      <EmptyRecipeState
        invalidCount={0}
        canCreateStarter
        creatingStarter={false}
        onCreateStarter={onCreateStarter}
      />,
    );
    const button = screen.getByRole("button", { name: "Create a starter recipe" });
    fireEvent.click(button);
    expect(onCreateStarter).toHaveBeenCalledTimes(1);
    rerender(
      <EmptyRecipeState
        invalidCount={0}
        canCreateStarter
        creatingStarter={false}
        createStarterError="workspace path's parent is not a directory"
        onCreateStarter={onCreateStarter}
      />,
    );
    expect(
      screen.getByText("workspace path's parent is not a directory"),
    ).toBeTruthy();
  });

  it("hides the affordance when it cannot really write files", () => {
    render(<EmptyRecipeState invalidCount={0} canCreateStarter={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
