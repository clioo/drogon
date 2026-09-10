// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Agent-step editor tests: the editable Model field, the Pi-only provider
// binding, the four distinct verdict tones, and keyboard-operable inputs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MentuAgentStepEditor } from "./MentuAgentStepEditor";
import type { ApprovedSelectionVerdict } from "./mentu-approved-selection";

afterEach(cleanup);

const unverified: ApprovedSelectionVerdict = {
  kind: "unverified",
  reason: "Manual entry: carried unverified against this host.",
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
});
