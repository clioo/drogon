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
