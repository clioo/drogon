// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Agent-step editor tests: the editable Model field, the Pi-only provider
// binding, the four distinct verdict tones, and keyboard-operable inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { MentuAgentStepEditor } from "./MentuAgentStepEditor";
import type { ApprovedSelectionVerdict } from "./mentu-approved-selection";
import type { ModelCatalogReadout, ModelOption } from "./mentu-model-registry";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const unverified: ApprovedSelectionVerdict = {
  kind: "unverified",
  reason: "Manual entry: carried unverified against this host.",
};

const enumeratedOption: ModelOption = {
  id: "kimi-for-coding",
  group: "catalog",
  verified: true,
  recommended: true,
  notes: ["kimi-coding", "ctx 262.1K", "thinking"],
};

const observedOption: ModelOption = {
  id: "glm-5.3-flash",
  group: "observed",
  verified: false,
  recommended: false,
  notes: ["from this recipe"],
};

const enumeratedReadout: ModelCatalogReadout = {
  statusLine:
    "2 models enumerated by pi 0.85.1 · private-isolated-root (credential-free) · probed just now",
  provenanceLine:
    "source: pi 0.85.1 · via --list-models · scope: private-isolated-root (credential-free) · probed just now",
  noteLine: "auth-gated enumeration under a private isolated config.",
  empty: false,
  stale: false,
  enumeratedIds: new Set(["kimi-for-coding"]),
};

function renderEditor(overrides: Partial<Parameters<typeof MentuAgentStepEditor>[0]> = {}) {
  const onChangeModel = vi.fn();
  const onChangeProvider = vi.fn();
  render(
    <MentuAgentStepEditor
      backend="codex"
      provider=""
      model=""
      showProvider={false}
      verdict={unverified}
      disabled={false}
      onChangeProvider={onChangeProvider}
      onChangeModel={onChangeModel}
      {...overrides}
    />,
  );
  return { onChangeModel, onChangeProvider };
}

describe("MentuAgentStepEditor", () => {
  it("edits the exact model id with typing", () => {
    const { onChangeModel } = renderEditor({ model: "" });
    const input = screen.getByLabelText("Model");
    fireEvent.change(input, { target: { value: "gpt-5.6-luna" } });
    expect(onChangeModel).toHaveBeenCalledWith("gpt-5.6-luna");
    expect(screen.getByText(/never substituted/)).toBeTruthy();
  });

  it("shows the provider binding only for pi-family backends", () => {
    renderEditor();
    expect(screen.queryByLabelText("Provider binding")).toBeNull();
    cleanup();
    renderEditor({ showProvider: true, backend: "kimi-coding" });
    expect(screen.getByLabelText("Provider binding")).toBeTruthy();
    expect(screen.getByText(/Never inferred/)).toBeTruthy();
  });

  it("forwards provider edits without touching the model", () => {
    const { onChangeModel, onChangeProvider } = renderEditor({ showProvider: true });
    fireEvent.change(screen.getByLabelText("Provider binding"), {
      target: { value: "kimi-coding" },
    });
    expect(onChangeProvider).toHaveBeenCalledWith("kimi-coding");
    expect(onChangeModel).not.toHaveBeenCalled();
  });

  it("renders each verdict kind with its reason and tone", () => {
    const cases: ApprovedSelectionVerdict[] = [
      { kind: "unavailable", reason: "Mentu Recipes is unavailable on the execution host." },
      { kind: "stale", reason: "The recipe changed on disk since it was loaded." },
      { kind: "unsupported", reason: "no opencode adapter is registered" },
      unverified,
    ];
    for (const verdict of cases) {
      cleanup();
      renderEditor({ verdict });
      const note = screen.getByRole("status");
      expect(note.textContent).toContain(verdict.reason);
      const tone =
        verdict.kind === "unverified" ? "text-muted-foreground" : "text-destructive";
      expect(note.className).toContain(tone);
    }
  });

  it("disables both inputs while busy", () => {
    renderEditor({ disabled: true, showProvider: true });
    expect((screen.getByLabelText("Model") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Provider binding") as HTMLInputElement).disabled).toBe(true);
  });

  it("renders no quick-pick affordance when neither source has anything to offer", () => {
    renderEditor({ modelOptions: [] });
    expect(screen.queryByLabelText("Model quick pick")).toBeNull();
  });

  it("picking a host-enumerated model writes the exact id, never a substitution", async () => {
    const { onChangeModel } = renderEditor({
      modelOptions: [enumeratedOption],
    });
    fireEvent.keyDown(screen.getByLabelText("Model quick pick"), { key: "Enter" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getAllByText("kimi-for-coding")[0]);
    expect(onChangeModel).toHaveBeenCalledWith("kimi-for-coding");
  });

  it("marks the host-enumerated Drogon-recommended id and the observed id distinctly", async () => {
    renderEditor({
      modelOptions: [enumeratedOption, observedOption],
      catalogReadout: enumeratedReadout,
    });
    fireEvent.keyDown(screen.getByLabelText("Model quick pick"), { key: "Enter" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("recommended")).toBeTruthy();
    // The recipe-observed id carries its origin note, never a verified claim.
    const observed = screen.getAllByText(/from this recipe · unverified/);
    expect(observed.length).toBeGreaterThan(0);
  });

  it("picking the default entry clears the model instead of writing a sentinel", async () => {
    const { onChangeModel } = renderEditor({
      modelOptions: [enumeratedOption],
    });
    fireEvent.keyDown(screen.getByLabelText("Model quick pick"), { key: "Enter" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getByText("harness default"));
    expect(onChangeModel).toHaveBeenCalledWith("");
  });

  it("renders the caller's honest catalog status line, verbatim", () => {
    renderEditor({ catalogReadout: enumeratedReadout });
    expect(screen.getByTestId("model-catalog-status").textContent).toBe(
      enumeratedReadout.statusLine,
    );
  });

  it("renders the provenance row and the daemon's honesty note", () => {
    renderEditor({ catalogReadout: enumeratedReadout });
    expect(screen.getByTestId("model-catalog-provenance").textContent).toContain(
      "via --list-models",
    );
    expect(screen.getByTestId("model-catalog-note").textContent).toContain(
      "auth-gated",
    );
  });

  it("renders a stale catalog status in the warning tone", () => {
    renderEditor({
      catalogReadout: {
        ...enumeratedReadout,
        statusLine: "STALE — 1 model enumerated by pi 0.85.1 · probed 3 h ago",
        stale: true,
      },
    });
    const status = screen.getByTestId("model-catalog-status");
    expect(status.textContent).toContain("STALE");
    expect(status.className).toContain("text-amber-600");
  });

  it("wires the refresh affordance to the caller's real refresh call", () => {
    const onRefreshCatalog = vi.fn();
    renderEditor({ onRefreshCatalog });
    fireEvent.click(screen.getByRole("button", { name: "Refresh model catalog" }));
    expect(onRefreshCatalog).toHaveBeenCalledTimes(1);
  });
});
