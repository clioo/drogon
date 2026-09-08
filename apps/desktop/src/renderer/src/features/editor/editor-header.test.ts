import { describe, expect, it } from "vitest";
import { getEditorHeaderState } from "./editor-header";

function baseInput(overrides: Partial<Parameters<typeof getEditorHeaderState>[0]> = {}) {
  return {
    path: "src/index.ts",
    dirty: false,
    changedOnDisk: false,
    saveInFlight: false,
    hasSaveError: false,
    canSave: false,
    ...overrides,
  };
}

describe("getEditorHeaderState", () => {
  it("shows the relative path label and title, and the path as copy text", () => {
    const state = getEditorHeaderState(baseInput());
    expect(state.pathLabel).toBe("src/index.ts");
    expect(state.pathTitle).toBe("src/index.ts");
    expect(state.copyText).toBe("src/index.ts");
    expect(state.copyToastLabel).toBe("File path copied");
  });

  it("disables Save on a clean file even when save admission would allow it", () => {
    const state = getEditorHeaderState(baseInput({ dirty: false, canSave: true }));
    expect(state.saveDisabled).toBe(true);
    expect(state.saveLabel).toBe("Save");
  });

  it("disables Save when dirty but the pane does not admit a save", () => {
    const state = getEditorHeaderState(baseInput({ dirty: true, canSave: false }));
    expect(state.saveDisabled).toBe(true);
  });

  it("enables Save when dirty and admissible", () => {
    const state = getEditorHeaderState(baseInput({ dirty: true, canSave: true }));
    expect(state.saveDisabled).toBe(false);
  });

  it("shows the in-flight label while saving, regardless of a stale error", () => {
    const state = getEditorHeaderState(
      baseInput({ dirty: true, canSave: true, saveInFlight: true, hasSaveError: true }),
    );
    expect(state.saveLabel).toBe("Saving…");
  });

  it("shows retry once a save error is present and no save is in flight", () => {
    const state = getEditorHeaderState(
      baseInput({ dirty: true, canSave: true, hasSaveError: true }),
    );
    expect(state.saveLabel).toBe("Retry save");
  });

  it("surfaces the dirty and changed-on-disk flags independently", () => {
    expect(getEditorHeaderState(baseInput({ dirty: true, changedOnDisk: false })).dirty).toBe(
      true,
    );
    expect(
      getEditorHeaderState(baseInput({ dirty: true, changedOnDisk: true })).changedOnDisk,
    ).toBe(true);
  });
});
