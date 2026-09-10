// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Inspector edit-mode tests: the fork's field affordances (backend,
// dependencies, timeout, retries, verify commands) render from the draft
// step and every edit AUTOSAVES through `onCommit` — there is no Save
// button any more. A refused commit keeps the draft, shows the error inline
// and never claims "JSON synced".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import type {
  Harness,
  HarnessModelsCatalog,
} from "../../../../shared/session-contract";
import type {
  MentuRecipeDefinition,
  MentuRecipeStep,
} from "./recipe-validation/mentu-recipe-document";
import type { RecipeGraphNode } from "./recipe-graph";
import {
  SelectedNodeInspector,
} from "./recipe-pane-inspector";
import type { RecipeStepDraft } from "./recipe-pane-editor";

// Radix Select/Popover defer open/highlight focus work to a setTimeout
// (same helper `select.test.tsx` uses for the source-ported Select).
const flushDeferredFocus = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const okCommit = () =>
  vi.fn(async (_draft: RecipeStepDraft, _label: string) => ({
    ok: true,
    message: null as string | null,
  }));

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

type InspectorProps = Parameters<typeof SelectedNodeInspector>[0];

function renderInspector(overrides: Partial<InspectorProps> = {}) {
  const onCommit = (overrides.onCommit as InspectorProps["onCommit"]) ?? okCommit();
  const utils = render(
    <SelectedNodeInspector
      node={node}
      editStep={step}
      backends={["shell", "pi"]}
      inheritBackendLabel="shell"
      editable
      disabled={false}
      saving={false}
      onCommit={onCommit}
      {...overrides}
    />,
  );
  return { onCommit, ...utils };
}

describe("SelectedNodeInspector edit mode", () => {
  it("renders the fork's field affordances and no Save button", () => {
    renderInspector();
    expect(screen.getByText("Selected node")).toBeTruthy();
    expect(screen.getByText("Step edits are written back to the Mentu JSON.")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    expect(screen.getByDisplayValue("test -f out.txt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save to Mentu JSON/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });

  it("keeps the shell Model read-only with the reference copy", () => {
    renderInspector();
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.readOnly).toBe(true);
    expect(model.value).toBe("Harness default");
    expect(
      screen.getByText("Steps carry no model selection in this recipe contract."),
    ).toBeTruthy();
  });

  it("autosaves an edited field on blur without any button", async () => {
    const onCommit = okCommit();
    renderInspector({ onCommit });
    const timeout = screen.getByLabelText("Timeout (seconds)");
    fireEvent.change(timeout, { target: { value: "60" } });
    fireEvent.blur(timeout);
    await act(async () => {});
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toMatchObject({ timeout: "60" });
    expect(onCommit.mock.calls[0][1]).toBe("build");
  });

  it("autosaves on Enter too", async () => {
    const onCommit = okCommit();
    renderInspector({ onCommit });
    const depends = screen.getByLabelText("Depends on");
    fireEvent.change(depends, { target: { value: "setup" } });
    fireEvent.keyDown(depends, { key: "Enter" });
    await act(async () => {});
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toMatchObject({ dependencies: "setup" });
  });

  it("shows a refused commit inline and never claims synced", async () => {
    const onCommit = vi.fn(async () => ({
      ok: false,
      message: "Timeout must be a non-negative integer.",
    }));
    renderInspector({ onCommit });
    const timeout = screen.getByLabelText("Timeout (seconds)");
    fireEvent.change(timeout, { target: { value: "-1" } });
    fireEvent.blur(timeout);
    await act(async () => {});
    expect(screen.getByTestId("mentu-step-save-error").textContent).toContain(
      "Timeout must be a non-negative integer.",
    );
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain(
      "Not saved — invalid",
    );
    // The refused value stays in the editor so it can be corrected.
    expect((timeout as HTMLInputElement).value).toBe("-1");
  });

  it("does not re-commit when nothing changed", async () => {
    const onCommit = okCommit();
    renderInspector({ onCommit });
    const depends = screen.getByLabelText("Depends on");
    fireEvent.blur(depends);
    fireEvent.keyDown(depends, { key: "Enter" });
    await act(async () => {});
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("mounts the editable agent selector with a verdict for agent steps", () => {
    const onCommit = okCommit();
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
        onCommit={onCommit}
      />,
    );
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.readOnly).toBe(false);
    expect(model.placeholder).toBe("Harness default");
    expect(screen.getByRole("status").textContent).toContain("unverified");
    expect(screen.queryByLabelText("Provider binding")).toBeNull();
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
        onCommit={okCommit()}
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
        onCommit={okCommit()}
        daemonRefusal="Step 'a' selects backend 'opencode', which mentu-recipes 0.5.0 cannot execute"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("cannot execute");
  });

  it("preserves the draft behind a conflict with reload/review choices", () => {
    const onReload = vi.fn();
    const onReview = vi.fn();
    renderInspector({
      saveConflict: { expectedHash: "a".repeat(64), currentHash: "b".repeat(64) },
      onReloadRecipe: onReload,
      onReviewCurrent: onReview,
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("preserved");
    fireEvent.click(screen.getByRole("button", { name: "Reload recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current source" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
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
        onCommit={okCommit()}
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
    renderInspector({ backends: ["shell"], harnessCatalog: [CLAUDE_HARNESS] });
    fireEvent.keyDown(screen.getByLabelText("Harness / backend"), { key: "Enter" });
    await flushDeferredFocus();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("CLI")).toBeTruthy();
    expect(screen.getAllByText("shell").length).toBeGreaterThan(0);
  });

  it("honestly reflects a missing harness instead of hiding or inventing availability", () => {
    renderInspector({
      editStep: { ...step, backend: "claude" },
      backends: ["shell", "claude"],
      harnessCatalog: [{ ...CLAUDE_HARNESS, availability: "missing", executable: null }],
    });
    expect(screen.getByText("Not installed on this host")).toBeTruthy();
  });

  it("surfaces a failed catalog load as an explicit status, never a silent empty list", () => {
    renderInspector({
      backends: ["shell"],
      harnessCatalog: [],
      harnessCatalogError: "daemon unreachable",
    });
    expect(screen.getByText(/Harness catalog unavailable: daemon unreachable/)).toBeTruthy();
  });

  it("wires the refresh affordance to the caller's real refresh call", () => {
    const onRefresh = vi.fn();
    renderInspector({
      backends: ["shell"],
      harnessCatalog: [CLAUDE_HARNESS],
      onRefreshHarnessCatalog: onRefresh,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh harness catalog" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

const NOW = Date.now();

function modelCatalogFixture(
  overrides: Partial<HarnessModelsCatalog> = {},
): HarnessModelsCatalog {
  return {
    harness: "claude",
    availability: "available",
    executable: "/usr/local/bin/claude",
    provenance: {
      executable: "/usr/local/bin/claude",
      argv: ["--list-models"],
      version: "2.1.0",
      probedAtEpochMs: NOW - 4_000,
      configScope: "private-isolated-root (credential-free)",
    },
    entries: [],
    status: "enumerated",
    note: null,
    retainedRoots: [],
    ...overrides,
  };
}

function hostEntry(id: string) {
  return {
    provider: null,
    id,
    context: null,
    maxOutput: null,
    thinking: null,
    images: null,
  };
}

describe("SelectedNodeInspector live model catalog + picker", () => {
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

  function renderAgentInspector(overrides: Partial<InspectorProps> = {}) {
    return renderInspector({
      node: agentNode,
      editStep: agentStep,
      backends: ["shell", "claude"],
      ...overrides,
    });
  }

  it("offers the host-enumerated models with their real count and provenance", () => {
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({
        entries: [hostEntry("claude-sonnet-5"), hostEntry("claude-opus-5")],
      }),
    });
    const status = screen.getByTestId("model-catalog-status");
    expect(status.textContent).toContain("2 models enumerated by claude 2.1.0");
    expect(status.textContent).toContain("probed just now");
    expect(screen.getByTestId("model-catalog-provenance").textContent).toContain(
      "via --list-models",
    );
  });

  it("opens the picker, lists the harness models and filters as the user types", async () => {
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({
        entries: [
          hostEntry("claude-sonnet-5"),
          hostEntry("claude-opus-5"),
          hostEntry("claude-haiku-4-5"),
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    await flushDeferredFocus();
    expect(screen.getByRole("listbox", { name: "Models" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /claude-sonnet-5/ })).toBeTruthy();
    const search = screen.getByRole("combobox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "opus" } });
    expect(screen.queryByRole("option", { name: /claude-sonnet-5/ })).toBeNull();
    expect(screen.getByRole("option", { name: /claude-opus-5/ })).toBeTruthy();
  });

  it("selects a model with Enter and persists it through onCommit on blur", async () => {
    const onCommit = okCommit();
    renderAgentInspector({
      onCommit,
      modelCatalog: modelCatalogFixture({
        entries: [hostEntry("claude-sonnet-5"), hostEntry("claude-opus-5")],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    await flushDeferredFocus();
    const search = screen.getByRole("combobox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "opus" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await act(async () => {});
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.value).toBe("claude-opus-5");
    fireEvent.blur(model);
    await act(async () => {});
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toMatchObject({ model: "claude-opus-5" });
  });

  it("still lets an exact id the host did not enumerate be typed and stay unverified", async () => {
    const onCommit = okCommit();
    renderAgentInspector({
      onCommit,
      modelCatalog: modelCatalogFixture({ entries: [hostEntry("claude-sonnet-5")] }),
    });
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    fireEvent.change(model, { target: { value: "claude-sonnet-4-5" } });
    expect(screen.getByTestId("model-catalog-status").textContent).toContain(
      "'claude-sonnet-4-5'",
    );
    expect(screen.getByTestId("model-catalog-status").textContent).toContain("unverified");
    fireEvent.blur(model);
    await act(async () => {});
    expect(onCommit.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-4-5" });
  });

  it("explains an enumerated-but-empty host catalog and still offers the known catalog + typing", async () => {
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({ entries: [] }),
      recipeDefinition: { name: "demo", steps: [] },
    });
    const status = screen.getByTestId("model-catalog-status");
    expect(status.textContent).toContain("No models discovered for claude");
    expect(status.textContent).toContain("unverified");
    expect(status.textContent).toContain("curated known catalog");
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    await flushDeferredFocus();
    // The curated known list is still offered, labelled unverified.
    expect(
      screen.getAllByRole("option", { name: /known catalog · unverified/ }).length,
    ).toBeGreaterThan(0);
  });

  it("shows the explanatory empty state for a harness with no known models", async () => {
    renderInspector({
      node: agentNode,
      editStep: { ...agentStep, backend: "antigravity" },
      backends: ["shell", "antigravity"],
      modelCatalog: modelCatalogFixture({
        harness: "antigravity",
        status: "unsupported_surface",
        entries: [],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    await flushDeferredFocus();
    expect(screen.getByTestId("model-picker-empty").textContent).toContain(
      "no model enumeration surface",
    );
  });

  it("says a harness exposes no enumeration surface but still lists the known catalog", async () => {
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({
        status: "unsupported_surface",
        entries: [],
        note: "no enumeration command captured",
      }),
    });
    const status = screen.getByTestId("model-catalog-status");
    expect(status.textContent).toContain("no model enumeration surface");
    expect(status.textContent).toContain("curated known catalog");
    fireEvent.click(screen.getByRole("button", { name: "Browse models" }));
    await flushDeferredFocus();
    expect(screen.getByRole("option", { name: /claude-sonnet-5/ })).toBeTruthy();
  });

  it("labels a stale catalog as stale in the status and provenance rows", () => {
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({
        entries: [hostEntry("claude-sonnet-5")],
        provenance: {
          executable: "/usr/local/bin/claude",
          argv: ["--list-models"],
          version: "2.1.0",
          probedAtEpochMs: NOW - 30 * 60_000,
          configScope: "private-isolated-root (credential-free)",
        },
      }),
    });
    expect(screen.getByTestId("model-catalog-status").textContent).toContain("STALE");
    expect(screen.getByTestId("model-catalog-provenance").textContent).toContain("STALE");
  });

  it("surfaces a failed model-catalog load as an explicit status", () => {
    renderAgentInspector({ modelCatalog: null, modelCatalogError: "daemon unreachable" });
    expect(screen.getByTestId("model-catalog-status").textContent).toBe(
      "Model catalog unavailable: daemon unreachable",
    );
  });

  it("wires the model-catalog refresh affordance to the caller's real refresh call", () => {
    const onRefreshModelCatalog = vi.fn();
    renderAgentInspector({
      modelCatalog: modelCatalogFixture({ entries: [] }),
      onRefreshModelCatalog,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh model catalog" }));
    expect(onRefreshModelCatalog).toHaveBeenCalledTimes(1);
  });

  it("keeps the shell Model read-only with no catalog affordance", () => {
    renderInspector({
      backends: ["shell"],
      modelCatalog: modelCatalogFixture(),
    });
    expect(screen.getByLabelText("Model")).toBeTruthy();
    expect(screen.queryByTestId("model-catalog-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh model catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse models" })).toBeNull();
  });
});

describe("SelectedNodeInspector autosave chip", () => {
  it("reads JSON synced when the draft matches the saved step", () => {
    renderInspector();
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("JSON synced");
  });

  it("reads Unsaved edits the moment the in-progress draft diverges", () => {
    renderInspector();
    fireEvent.change(screen.getByLabelText("Timeout (seconds)"), { target: { value: "90" } });
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("Unsaved edits");
  });

  it("reads Saving… while a save is in flight", () => {
    renderInspector({ saving: true });
    expect(screen.getByTestId("mentu-json-sync-chip").textContent).toContain("Saving…");
  });

  it("flushes the previous node's edit when the selection moves", async () => {
    const onCommit = okCommit();
    const otherNode: RecipeGraphNode = {
      id: "step:other",
      label: "other",
      kind: "step",
      dependencies: [],
      depth: 0,
    };
    const { rerender } = renderInspector({ onCommit });
    const timeout = screen.getByLabelText("Timeout (seconds)");
    fireEvent.change(timeout, { target: { value: "77" } });
    // Move the selection without blurring (as a keyboard/graph change can).
    rerender(
      <SelectedNodeInspector
        node={otherNode}
        editStep={{ label: "other", backend: "pi", prompt: "x" }}
        backends={["shell", "pi"]}
        inheritBackendLabel="shell"
        editable
        disabled={false}
        saving={false}
        onCommit={onCommit}
      />,
    );
    await act(async () => {});
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toMatchObject({ timeout: "77" });
    expect(onCommit.mock.calls[0][1]).toBe("build");
    // The new node's own values are shown, not the old draft.
    expect((screen.getByLabelText("Timeout (seconds)") as HTMLInputElement).value).toBe("");
  });
});
