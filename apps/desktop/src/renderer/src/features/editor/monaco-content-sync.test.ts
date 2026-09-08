// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/monaco-content-sync.test.ts (harness
// shape and the identical-content case). Only syncContentUpdate is covered:
// the mount path and live-tail modes the source tests do not exist here.
import { describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { syncContentUpdate } from "./monaco-content-sync";

function createHarness(initialContent: string) {
  const getValue = vi.fn(() => initialContent);
  const getFullModelRange = vi.fn(() => ({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 2,
    endColumn: 1,
  }));
  const pushEditOperations = vi.fn();
  const pushUndoStop = vi.fn();
  const model = {
    getValue,
    getEOL: () => "\n",
    getFullModelRange,
    pushEditOperations,
  } as unknown as editor.ITextModel;
  const editorInstance = {
    getModel: () => model,
    pushUndoStop,
  } as unknown as editor.IStandaloneCodeEditor;
  return { editorInstance, pushEditOperations, pushUndoStop };
}

describe("syncContentUpdate", () => {
  it("does nothing for identical content", () => {
    const { editorInstance, pushEditOperations, pushUndoStop } =
      createHarness("same\n");
    syncContentUpdate(editorInstance, "same\n");
    expect(pushEditOperations).not.toHaveBeenCalled();
    expect(pushUndoStop).not.toHaveBeenCalled();
  });

  it("replaces drifted model content with undo stops around the edit", () => {
    const { editorInstance, pushEditOperations, pushUndoStop } =
      createHarness("stale model\n");
    syncContentUpdate(editorInstance, "fresh external\n");
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
    const [selections, edits] = pushEditOperations.mock.calls[0];
    expect(selections).toEqual([]);
    expect(edits).toEqual([
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 1,
        },
        text: "fresh external\n",
      },
    ]);
    // Undo stops bracket the adoption so Cmd+Z reverts the external update.
    expect(pushUndoStop).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a model", () => {
    const editorInstance = {
      getModel: () => null,
      pushUndoStop: vi.fn(),
    } as unknown as editor.IStandaloneCodeEditor;
    expect(() => syncContentUpdate(editorInstance, "x\n")).not.toThrow();
  });
});
