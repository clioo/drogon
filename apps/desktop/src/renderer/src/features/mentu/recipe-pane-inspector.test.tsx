// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Inspector edit-mode tests: the fork's field affordances (backend,
// dependencies, timeout, retries, verify commands, Save) render from the
// draft step, and Save forwards the edited draft to the controller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { Harness } from "../../../../shared/session-contract";
import type {
  MentuRecipeDefinition,
  MentuRecipeStep,
} from "./recipe-validation/mentu-recipe-document";
import type { RecipeGraphNode } from "./recipe-graph";
import { SelectedNodeInspector } from "./recipe-pane-inspector";

// Radix Select/Popover defer open/highlight focus work to a setTimeout
// (same helper `select.test.tsx` uses for the source-ported Select).
const flushDeferredFocus = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const step: MentuRecipeStep = {
  label: "build",
  prompt: "make",
  timeout: 30,
  depends_on: [],
  verify: { commands: ["test -f out.txt"] },
};

const node: RecipeGraphNode = {
  id: "step:build",
  label: "build",
  kind: "step",
  dependencies: [],
  depth: 0,
};

function renderInspector(onSave = vi.fn()) {
  return render(
    <SelectedNodeInspector
      node={node}
      editStep={step}
      backends={["shell", "pi"]}
      inheritBackendLabel="shell"
      editable
      disabled={false}
      saving={false}
      onSave={onSave}
    />,
  );
}

describe("SelectedNodeInspector edit mode", () => {
  it("renders the fork's field affordances with the step's values", () => {
    renderInspector();
    expect(screen.getByText("Selected node")).toBeTruthy();
    expect(screen.getByText("Step edits are written back to the Mentu JSON.")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    expect(screen.getByDisplayValue("test -f out.txt")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save to Mentu JSON/ })).toBeTruthy();
  });

  it("keeps the shell Model read-only with the reference copy", () => {
    renderInspector();
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.readOnly).toBe(true);
    expect(model.value).toBe("Harness default");
    expect(
      screen.getByText("Steps carry no model selection in this recipe contract."),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("mounts the editable agent selector with a verdict for agent steps", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const agentStep: MentuRecipeStep = {
      label: "review",
      backend: "codex",
      prompt: "review",
      depends_on: ["build"],
    };
    const agentNode: RecipeGraphNode = {
      id: "step:review",
      label: "review",
      kind: "step",
      dependencies: ["build"],
      depth: 1,
    };
    render(
      <SelectedNodeInspector
        node={agentNode}
        editStep={agentStep}
        backends={["shell", "codex"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={onSave}
      />,
    );
    // Editable model (not the shell read-only copy) plus the verdict.
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.readOnly).toBe(false);
    expect(model.placeholder).toBe("Harness default");
    expect(screen.getByRole("status").textContent).toContain("unverified");
    expect(screen.queryByLabelText("Provider binding")).toBeNull();
    fireEvent.change(model, { target: { value: "gpt-5.6-luna" } });
    fireEvent.click(screen.getByRole("button", { name: /Save to Mentu JSON/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-luna" });
  });

  it("shows the provider binding for pi backends", () => {
    const piStep: MentuRecipeStep = { label: "ask", backend: "pi", prompt: "ask" };
    const piNode: RecipeGraphNode = {
      id: "step:ask",
      label: "ask",
      kind: "step",
      dependencies: [],
      depth: 0,
    };
    render(
      <SelectedNodeInspector
        node={piNode}
        editStep={piStep}
        backends={["shell", "pi"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Provider binding")).toBeTruthy();
  });

  it("renders the daemon refusal as the unsupported verdict", () => {
    const agentStep: MentuRecipeStep = { label: "a", backend: "opencode", prompt: "hi" };
    const agentNode: RecipeGraphNode = {
      id: "step:a",
      label: "a",
      kind: "step",
      dependencies: [],
      depth: 0,
    };
    render(
      <SelectedNodeInspector
        node={agentNode}
        editStep={agentStep}
        backends={["shell", "opencode"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        daemonRefusal="Step 'a' selects backend 'opencode', which mentu-recipes 0.5.0 cannot execute"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("cannot execute");
  });

  it("preserves the draft behind a conflict with reload/review choices", () => {
    const onReload = vi.fn();
    const onReview = vi.fn();
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell", "pi"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        saveConflict={{ expectedHash: "a".repeat(64), currentHash: "b".repeat(64) }}
        onReloadRecipe={onReload}
        onReviewCurrent={onReview}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("preserved");
    fireEvent.click(screen.getByRole("button", { name: "Reload recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current source" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
  });
  it("renders the fork's field affordances with the step's values", () => {
    renderInspector();
    expect(screen.getByText("Selected node")).toBeTruthy();
    expect(screen.getByText("Step edits are written back to the Mentu JSON.")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    expect(screen.getByDisplayValue("test -f out.txt")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save to Mentu JSON/ })).toBeTruthy();
  });

  it("forwards the edited draft on Save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderInspector(onSave);
    fireEvent.change(screen.getByLabelText("Depends on"), { target: { value: "setup" } });
    fireEvent.change(screen.getByLabelText("Timeout (seconds)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /Save to Mentu JSON/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      dependencies: "setup",
      timeout: "60",
      verifyCommands: "test -f out.txt",
    });
  });

  it("explains an unprojectable draft instead of offering edits", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={null}
        backends={[]}
        inheritBackendLabel={null}
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Save to Mentu JSON/ })).toBeNull();
    expect(screen.getByText(/draft source has errors/)).toBeTruthy();
  });
});

const CLAUDE_HARNESS: Harness = {
  harnessId: "claude",
  displayName: "Claude Code",
  availability: "available",
  executable: "/usr/local/bin/claude",
};

describe("SelectedNodeInspector real harness catalog", () => {
  it("renders the registered harness with a CLI chip and its real availability, without breaking the plain backend list", async () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        harnessCatalog={[CLAUDE_HARNESS]}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Harness / backend"), { key: "Enter" });
    await flushDeferredFocus();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("CLI")).toBeTruthy();
    // The pre-existing "backends in use" entries (here just shell) still
    // render plainly alongside the registered catalog.
    expect(screen.getAllByText("shell").length).toBeGreaterThan(0);
  });

  it("honestly reflects a missing harness instead of hiding or inventing availability", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={{ ...step, backend: "claude" }}
        backends={["shell", "claude"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        harnessCatalog={[{ ...CLAUDE_HARNESS, availability: "missing", executable: null }]}
      />,
    );
    expect(screen.getByText("Not installed on this host")).toBeTruthy();
  });

  it("surfaces a failed catalog load as an explicit status, never a silent empty list", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        harnessCatalog={[]}
        harnessCatalogError="daemon unreachable"
      />,
    );
    expect(screen.getByText(/Harness catalog unavailable: daemon unreachable/)).toBeTruthy();
  });

  it("wires the refresh affordance to the caller's real refresh call", () => {
    const onRefresh = vi.fn();
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        harnessCatalog={[CLAUDE_HARNESS]}
        onRefreshHarnessCatalog={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh harness catalog" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("SelectedNodeInspector honest model quick-pick", () => {
  const agentStep: MentuRecipeStep = {
    label: "build-and-test",
    backend: "claude",
    prompt: "build",
  };
  const agentNode: RecipeGraphNode = {
    id: "step:build-and-test",
    label: "build-and-test",
    kind: "step",
    dependencies: [],
    depth: 0,
  };

  it("offers the recipe-observed model from a sibling step, not a fabricated live count", async () => {
    const recipe: MentuRecipeDefinition = {
      name: "demo",
      steps: [
        { label: "other", backend: "claude", model: "claude-opus-5" },
        agentStep,
      ],
    };
    render(
      <SelectedNodeInspector
        node={agentNode}
        editStep={agentStep}
        backends={["shell", "claude"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        recipeDefinition={recipe}
      />,
    );
    expect(
      screen.getByText(/model ids available/).textContent,
    ).toContain("from this recipe");
    fireEvent.keyDown(screen.getByLabelText("Model quick pick"), { key: "Enter" });
    await flushDeferredFocus();
    expect(screen.getByText("claude-opus-5")).toBeTruthy();
  });

  it("says plainly when nothing is known or observed for the backend", () => {
    render(
      <SelectedNodeInspector
        node={agentNode}
        editStep={{ ...agentStep, backend: "opencode" }}
        backends={["shell", "opencode"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
        recipeDefinition={{ name: "demo", steps: [] }}
      />,
    );
    expect(screen.getByText(/enter an exact id manually/)).toBeTruthy();
  });
});

describe("SelectedNodeInspector JSON-synced chip", () => {
  it("reads JSON synced when the draft matches the saved step", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("JSON synced");
  });

  it("reads Unsaved edits the moment the in-progress draft diverges", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Timeout (seconds)"), { target: { value: "90" } });
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("Unsaved edits");
  });

  it("reads Saving… while a save is in flight", () => {
    render(
      <SelectedNodeInspector
        node={node}
        editStep={step}
        backends={["shell"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("Saving…");
  });
});
