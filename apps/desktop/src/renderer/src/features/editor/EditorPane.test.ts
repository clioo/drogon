import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  EditorPane,
  applyEditorAction,
  initialEditorState,
  isDirty,
  runSave,
  type EditorAction,
  type EditorPaneProps,
} from "./EditorPane";
import type { Result } from "../../../../shared/session-contract";

const okSave = (): EditorPaneProps["onSave"] => () =>
  Promise.resolve({ ok: true, result: null });

function opened(content = "saved body"): ReturnType<typeof initialEditorState> {
  return applyEditorAction(initialEditorState(), {
    type: "file-opened",
    path: "src/main.ts",
    content,
  });
}

describe("dirty tracking", () => {
  test("a freshly opened file is clean", () => {
    expect(isDirty(opened())).toBe(false);
  });

  test("editing marks the pane dirty; reverting the text cleans it again", () => {
    let state = opened("saved body");
    state = applyEditorAction(state, { type: "edited", value: "new body" });
    expect(isDirty(state)).toBe(true);
    state = applyEditorAction(state, { type: "edited", value: "saved body" });
    expect(isDirty(state)).toBe(false);
  });

  test("edits typed while a save is in flight keep the pane dirty after success", () => {
    let state = opened("saved");
    state = applyEditorAction(state, {
      type: "save-started",
      draft: "attempt one",
    });
    state = applyEditorAction(state, { type: "edited", value: "attempt two" });
    state = applyEditorAction(state, { type: "save-succeeded" });
    expect(state.lastSaved).toBe("attempt one");
    expect(state.draft).toBe("attempt two");
    expect(isDirty(state)).toBe(true);
  });
});

describe("save failure and retry", () => {
  test("a failed save keeps the draft, shows the error and stays dirty", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "save-started", draft: "draft" });
    state = applyEditorAction(state, { type: "edited", value: "draft!" });
    state = applyEditorAction(state, {
      type: "save-failed",
      message: "disk full",
    });
    expect(state.saveError).toBe("disk full");
    expect(state.draft).toBe("draft!");
    expect(state.saveInFlight).toBe(false);
    expect(isDirty(state)).toBe(true);
  });

  test("retrying clears the error while keeping the draft, then success clears dirty", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "draft" });
    state = applyEditorAction(state, { type: "save-started", draft: "draft" });
    state = applyEditorAction(state, {
      type: "save-failed",
      message: "disk full",
    });
    state = applyEditorAction(state, { type: "save-started", draft: "draft" });
    expect(state.saveError).toBe("");
    expect(state.draft).toBe("draft");
    expect(state.saveInFlight).toBe(true);
    state = applyEditorAction(state, { type: "save-succeeded" });
    expect(isDirty(state)).toBe(false);
  });
});

describe("runSave with an injected fake backend", () => {
  test("a rejected Result surfaces the service error and keeps the draft", async () => {
    const dispatched: EditorAction[] = [];
    const onSave: EditorPaneProps["onSave"] = () =>
      Promise.resolve({
        ok: false,
        error: { code: "io", message: "read-only volume", retryable: true },
      } satisfies Result<null>);
    await runSave("my draft", onSave, (action) => dispatched.push(action));
    expect(dispatched).toEqual([
      { type: "save-started", draft: "my draft" },
      { type: "save-failed", message: "read-only volume" },
    ]);
  });

  test("an accepted Result clears the save", async () => {
    const dispatched: EditorAction[] = [];
    await runSave("my draft", okSave(), (action) => dispatched.push(action));
    expect(dispatched).toEqual([
      { type: "save-started", draft: "my draft" },
      { type: "save-succeeded" },
    ]);
  });

  test("a thrown save (transport failure) becomes a retryable save error, not a crash", async () => {
    const dispatched: EditorAction[] = [];
    const onSave: EditorPaneProps["onSave"] = () => Promise.reject(new Error());
    await runSave("my draft", onSave, (action) => dispatched.push(action));
    expect(dispatched[1]).toEqual({
      type: "save-failed",
      message: "The file could not be saved.",
    });
  });
});

describe("file switching", () => {
  test("opening another file resets the draft, dirty flag and save error", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "unsaved" });
    state = applyEditorAction(state, {
      type: "save-failed",
      message: "disk full",
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: "other.ts",
      content: "fresh",
    });
    expect(state.openPath).toBe("other.ts");
    expect(state.draft).toBe("fresh");
    expect(state.saveError).toBe("");
    expect(isDirty(state)).toBe(false);
  });

  test("a content refresh for the same path never clobbers unsaved edits", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: "src/main.ts",
      content: "externally replaced",
    });
    expect(state.draft).toBe("my edits");
    expect(isDirty(state)).toBe(true);
  });

  test("a content refresh for the same path is adopted while the pane is clean", () => {
    let state = opened("saved");
    state = applyEditorAction(state, {
      type: "file-opened",
      path: "src/main.ts",
      content: "externally replaced",
    });
    expect(state.draft).toBe("externally replaced");
    expect(isDirty(state)).toBe(false);
  });
});

describe("EditorPane rendering", () => {
  test("a read error shows the read-error state with the retry-read affordance", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        path: "src/main.ts",
        content: null,
        readError: "File unavailable",
        onReload: () => {},
        onSave: okSave(),
      }),
    );
    expect(markup).toContain("File unavailable");
    expect(markup).toContain("Retry read");
  });

  test("with no open file it shows the empty state", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        path: null,
        content: null,
        onSave: okSave(),
      }),
    );
    expect(markup).toContain("No file open");
  });

  test("an opened clean file renders its path and no dirty indicator", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        path: "src/main.ts",
        content: "body",
        onSave: okSave(),
      }),
    );
    expect(markup).toContain("src/main.ts");
    expect(markup).toContain("Save");
    expect(markup).not.toContain("Unsaved changes");
  });
});
