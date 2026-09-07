import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  EditorPane,
  applyEditorAction,
  initialEditorState,
  isDirty,
  nextSaveGeneration,
  runSave,
  type EditorAction,
  type EditorPaneProps,
  type EditorState,
} from "./EditorPane";
import type { Result } from "../../../../shared/session-contract";

const FILE_A = "src/a.ts";
const FILE_B = "src/b.ts";

const okSave = (): EditorPaneProps["onSave"] => () =>
  Promise.resolve({ ok: true, result: null });

function opened(content = "saved body", path = FILE_A): EditorState {
  return applyEditorAction(initialEditorState(), {
    type: "file-opened",
    path,
    content,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
      path: FILE_A,
      draft: "attempt one",
      generation: 1,
    });
    state = applyEditorAction(state, { type: "edited", value: "attempt two" });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      path: FILE_A,
      generation: 1,
    });
    expect(state.lastSaved).toBe("attempt one");
    expect(state.draft).toBe("attempt two");
    expect(isDirty(state)).toBe(true);
  });
});

describe("save identity fencing", () => {
  test("a stale success for file A cannot mark file B saved", () => {
    // Save A (generation 1) goes pending, then the user opens B and saves B.
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "A draft",
      generation: nextSaveGeneration(state),
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, { type: "edited", value: "B draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_B,
      draft: "B draft",
      generation: nextSaveGeneration(state),
    });
    // A's slow completion finally arrives…
    const fenced = applyEditorAction(state, {
      type: "save-succeeded",
      path: FILE_A,
      generation: 1,
    });
    // …and must be discarded wholesale: state is unchanged by identity —
    // B is still dirty, still saving, and nothing about it moved.
    expect(fenced).toBe(state);
    expect(fenced.draft).toBe("B draft");
    expect(isDirty(fenced)).toBe(true);
    expect(fenced.saveInFlight).toBe(true);
    expect(fenced.savingPath).toBe(FILE_B);
    expect(fenced.savingDraft).toBe("B draft");
  });

  test("a stale failure for file A cannot set saveError on file B", () => {
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "A draft",
      generation: 1,
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_B,
      draft: "B draft",
      generation: 2,
    });
    const fenced = applyEditorAction(state, {
      type: "save-failed",
      path: FILE_A,
      generation: 1,
      message: "disk full on A",
    });
    expect(fenced).toBe(state);
    expect(fenced.saveError).toBeNull();
  });

  test("a completion for the still-in-flight save applies to its own path after a switch", () => {
    // A's save is pending when the user switches to B (no B save yet):
    // A's completion is NOT stale and must land on A's retained entry only.
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "A draft",
      generation: 1,
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    expect(state.savingPath).toBe(FILE_A);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      path: FILE_A,
      generation: 1,
    });
    expect(state.saveInFlight).toBe(false);
    // B is untouched and clean.
    expect(isDirty(state)).toBe(false);
    // A's retained entry is now saved (no longer dirty when reopened).
    expect(state.files[FILE_A]).toEqual({ draft: "A draft", lastSaved: "A draft" });
  });

  test("a failure recorded while another file is open is keyed to its own path", () => {
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "A draft",
      generation: 1,
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, {
      type: "save-failed",
      path: FILE_A,
      generation: 1,
      message: "read-only volume",
    });
    expect(state.saveError).toEqual({ path: FILE_A, message: "read-only volume" });
    expect(state.saveError?.path).not.toBe(FILE_B);
    expect(state.saveInFlight).toBe(false);
  });
});

describe("dirty-switch draft retention", () => {
  test("switching files retains the dirty draft and restores it on return", () => {
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A unsaved work" });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    // B opens fresh and clean; A's draft is retained, not discarded.
    expect(state.openPath).toBe(FILE_B);
    expect(state.draft).toBe("B saved");
    expect(isDirty(state)).toBe(false);
    expect(state.files[FILE_A]).toEqual({
      draft: "A unsaved work",
      lastSaved: "A saved",
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_A,
      content: "A saved",
    });
    expect(state.draft).toBe("A unsaved work");
    expect(isDirty(state)).toBe(true);
  });

  test("drafts for two dirty files are retained independently", () => {
    let state = opened("A saved", FILE_A);
    state = applyEditorAction(state, { type: "edited", value: "A edit" });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, { type: "edited", value: "B edit" });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_A,
      content: "A saved",
    });
    expect(state.draft).toBe("A edit");
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "B saved",
    });
    expect(state.draft).toBe("B edit");
    expect(isDirty(state)).toBe(true);
  });

  test("reopening the same path with fresh saved content adopts it only while clean", () => {
    let state = opened("stale saved", FILE_A);
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_A,
      content: "externally replaced",
    });
    expect(state.draft).toBe("externally replaced");
    expect(isDirty(state)).toBe(false);
    // Dirty same-path refresh keeps the draft (covered below via retention
    // wiring): retained dirty wins over external content.
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    const kept = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_A,
      content: "replaced again",
    });
    expect(kept.draft).toBe("my edits");
    expect(isDirty(kept)).toBe(true);
  });
});

describe("save failure and retry", () => {
  test("a failed save keeps the draft, shows the error and stays dirty", () => {
    let state = opened("saved");
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "draft",
      generation: 1,
    });
    state = applyEditorAction(state, { type: "edited", value: "draft!" });
    state = applyEditorAction(state, {
      type: "save-failed",
      path: FILE_A,
      generation: 1,
      message: "disk full",
    });
    expect(state.saveError).toEqual({ path: FILE_A, message: "disk full" });
    expect(state.draft).toBe("draft!");
    expect(state.saveInFlight).toBe(false);
    expect(isDirty(state)).toBe(true);
  });

  test("retrying clears the error while keeping the draft, then success clears dirty", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "draft",
      generation: 1,
    });
    state = applyEditorAction(state, {
      type: "save-failed",
      path: FILE_A,
      generation: 1,
      message: "disk full",
    });
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "draft",
      generation: nextSaveGeneration(state),
    });
    expect(state.saveError).toBeNull();
    expect(state.draft).toBe("draft");
    expect(state.saveInFlight).toBe(true);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      path: FILE_A,
      generation: 2,
    });
    expect(isDirty(state)).toBe(false);
  });
});

describe("runSave with injected deferred fakes", () => {
  test("an accepted Result clears the save with the request's identity", async () => {
    const dispatched: EditorAction[] = [];
    const gate = deferred<Result<null>>();
    const pending = runSave({
      draft: "my draft",
      path: FILE_A,
      generation: 7,
      onSave: () => gate.promise,
      dispatch: (action) => dispatched.push(action),
    });
    expect(dispatched).toEqual([
      { type: "save-started", path: FILE_A, draft: "my draft", generation: 7 },
    ]);
    gate.resolve({ ok: true, result: null });
    await pending;
    expect(dispatched).toEqual([
      { type: "save-started", path: FILE_A, draft: "my draft", generation: 7 },
      { type: "save-succeeded", path: FILE_A, generation: 7 },
    ]);
  });

  test("a rejected Result surfaces the service error with the request's identity", async () => {
    const dispatched: EditorAction[] = [];
    const gate = deferred<Result<null>>();
    const pending = runSave({
      draft: "my draft",
      path: FILE_A,
      generation: 3,
      onSave: () => gate.promise,
      dispatch: (action) => dispatched.push(action),
    });
    gate.resolve({
      ok: false,
      error: { code: "io", message: "read-only volume", retryable: true },
    });
    await pending;
    expect(dispatched[1]).toEqual({
      type: "save-failed",
      path: FILE_A,
      generation: 3,
      message: "read-only volume",
    });
  });

  test("a thrown save (transport failure) becomes a retryable save error, not a crash", async () => {
    const dispatched: EditorAction[] = [];
    await runSave({
      draft: "my draft",
      path: FILE_A,
      generation: 1,
      onSave: () => Promise.reject(new Error("boom")),
      dispatch: (action) => dispatched.push(action),
    });
    expect(dispatched[1]).toEqual({
      type: "save-failed",
      path: FILE_A,
      generation: 1,
      message: "The file could not be saved.",
    });
  });

  test("interleaved saves: a slow A completion dispatches A's identity, never B's", async () => {
    const dispatched: EditorAction[] = [];
    const gateA = deferred<Result<null>>();
    const saveA = runSave({
      draft: "A draft",
      path: FILE_A,
      generation: 1,
      onSave: () => gateA.promise,
      dispatch: (action) => dispatched.push(action),
    });
    const saveB = runSave({
      draft: "B draft",
      path: FILE_B,
      generation: 2,
      onSave: okSave(),
      dispatch: (action) => dispatched.push(action),
    });
    await saveB;
    gateA.resolve({ ok: true, result: null });
    await saveA;
    expect(dispatched).toEqual([
      { type: "save-started", path: FILE_A, draft: "A draft", generation: 1 },
      { type: "save-started", path: FILE_B, draft: "B draft", generation: 2 },
      { type: "save-succeeded", path: FILE_B, generation: 2 },
      { type: "save-succeeded", path: FILE_A, generation: 1 },
    ]);
  });
});

describe("file switching basics", () => {
  test("opening another file starts from its own saved content with no error banner", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "unsaved" });
    state = applyEditorAction(state, {
      type: "save-failed",
      path: FILE_A,
      generation: 0,
      message: "disk full",
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      path: FILE_B,
      content: "fresh",
    });
    expect(state.openPath).toBe(FILE_B);
    expect(state.draft).toBe("fresh");
    expect(state.saveError).toBeNull();
    expect(isDirty(state)).toBe(false);
  });

  test("closing the file retains its draft in the map", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "kept work" });
    state = applyEditorAction(state, { type: "file-opened", path: null, content: null });
    expect(state.openPath).toBeNull();
    expect(state.files[FILE_A]).toEqual({ draft: "kept work", lastSaved: "saved" });
  });
});

describe("EditorPane rendering", () => {
  test("a read error shows the read-error state with the retry-read affordance", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        path: FILE_A,
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
      createElement(EditorPane, { path: null, content: null, onSave: okSave() }),
    );
    expect(markup).toContain("No file open");
  });

  test("an opened clean file renders its path and no dirty indicator", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        path: FILE_A,
        content: "body",
        onSave: okSave(),
      }),
    );
    expect(markup).toContain(FILE_A);
    expect(markup).toContain("Save");
    expect(markup).not.toContain("Unsaved changes");
  });

  test("each new save gets a fresh generation; completions do not advance it", async () => {
    let state = opened("saved");
    expect(nextSaveGeneration(state)).toBe(1);
    state = applyEditorAction(state, {
      type: "save-started",
      path: FILE_A,
      draft: "d",
      generation: nextSaveGeneration(state),
    });
    expect(nextSaveGeneration(state)).toBe(2);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      path: FILE_A,
      generation: 1,
    });
    // The counter only moves when the NEXT save starts, so two concurrent
    // saves can never share a generation.
    expect(state.saveGeneration).toBe(1);
    expect(nextSaveGeneration(state)).toBe(2);
  });
});
