// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Inspector edit-mode tests: the fork's field affordances (backend,
// dependencies, timeout, retries, verify commands, Save) render from the
// draft step, and Save forwards the edited draft to the controller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type { MentuRecipeStep } from "./recipe-validation/mentu-recipe-document";
import type { RecipeGraphNode } from "./recipe-graph";
import { SelectedNodeInspector } from "./recipe-pane-inspector";

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
