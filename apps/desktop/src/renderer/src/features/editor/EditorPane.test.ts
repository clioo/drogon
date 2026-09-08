import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  EditorPane,
  applyEditorAction,
  externalContentFor,
  hasChangedOnDisk,
  initialEditorState,
  initializeEditorPaneState,
  isDirty,
  isReadConfirmed,
  nextSaveGeneration,
  runSave,
  saveAdmission,
  scopedFileKey,
  shouldSeedRestore,
  type EditorAction,
  type EditorPaneProps,
  type EditorScope,
  type EditorState,
} from "./EditorPane";
import type { Result } from "../../../../shared/session-contract";

const SCOPE_A: EditorScope = { hostId: "h1", workspaceId: "w1" };
const SCOPE_B: EditorScope = { hostId: "h2", workspaceId: "w2" };
const FILE_A = "src/a.ts";
const FILE_B = "src/b.ts";
const KEY_A = scopedFileKey(SCOPE_A, FILE_A);
const KEY_B = scopedFileKey(SCOPE_A, FILE_B);

const okSave = (): EditorPaneProps["onSave"] => () =>
  Promise.resolve({ ok: true, result: null });

function opened(
  content = "saved body",
  path = FILE_A,
  scope: EditorScope = SCOPE_A,
): EditorState {
  return applyEditorAction(initialEditorState(), {
    type: "file-opened",
    scope,
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

describe("scoped keys", () => {
  test("drafts are namespaced by hostId/workspaceId/path", () => {
    expect(scopedFileKey(SCOPE_A, FILE_A)).toBe("h1/w1/src/a.ts");
    expect(scopedFileKey(SCOPE_B, FILE_A)).toBe("h2/w2/src/a.ts");
    expect(scopedFileKey(SCOPE_A, FILE_A)).not.toBe(
      scopedFileKey(SCOPE_B, FILE_A),
    );
  });
});

describe("unread-gated save", () => {
  test("a pending read leaves the file unread and a save request is refused", () => {
    let state = opened(null as unknown as string);
    // content=null means unread: lastSaved null, placeholder draft "".
    expect(isReadConfirmed(state)).toBe(false);
    const before = state;
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "",
      generation: 1,
      allowEmpty: false,
    });
    expect(state).toBe(before);
    expect(state.saveInFlight).toBe(false);
  });

  test("runSave on an unread file dispatches save-started but the reducer refuses it", async () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: null,
    });
    const dispatched: EditorAction[] = [];
    await runSave({
      draft: "",
      scope: SCOPE_A,
      path: FILE_A,
      generation: 1,
      allowEmpty: false,
      onSave: okSave(),
      dispatch: (action) => {
        dispatched.push(action);
        state = applyEditorAction(state, action);
      },
    });
    expect(dispatched[0].type).toBe("save-started");
    // The gate held: no save is in flight, lastSaved is still null.
    expect(state.saveInFlight).toBe(false);
    expect(state.lastSaved).toBeNull();
  });

  test("after the read completes, saving is accepted and a blank draft is not dirty", async () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: null,
    });
    // The delayed read arrives:
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "real body",
    });
    expect(isReadConfirmed(state)).toBe(true);
    expect(state.draft).toBe("real body");
    expect(isDirty(state)).toBe(false);
    const dispatched: EditorAction[] = [];
    state = applyEditorAction(state, { type: "edited", value: "edited body" });
    await runSave({
      draft: state.draft,
      scope: SCOPE_A,
      path: FILE_A,
      generation: nextSaveGeneration(state),
      allowEmpty: false,
      onSave: okSave(),
      dispatch: (action) => {
        dispatched.push(action);
        state = applyEditorAction(state, action);
      },
    });
    expect(dispatched).toEqual([
      { type: "save-started", key: KEY_A, path: FILE_A, draft: "edited body", generation: 1, allowEmpty: false },
      { type: "save-succeeded", key: KEY_A, generation: 1 },
    ]);
    expect(state.lastSaved).toBe("edited body");
  });

  test("allowEmptySave is the explicit new-file intent: unread saves are allowed", () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: "new-file.ts",
      content: null,
    });
    state = applyEditorAction(state, {
      type: "save-started",
      key: scopedFileKey(SCOPE_A, "new-file.ts"),
      path: "new-file.ts",
      draft: "",
      generation: 1,
      allowEmpty: true,
    });
    expect(state.saveInFlight).toBe(true);
  });

  test("typed work under new-file intent is never clobbered by the late read", () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: "new-file.ts",
      content: null,
    });
    state = applyEditorAction(state, { type: "edited", value: "my new note" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: "new-file.ts",
      content: "file appeared on disk",
    });
    expect(state.draft).toBe("my new note");
    expect(state.lastSaved).toBeNull();
  });

  test("an empty-but-read file (content \"\") is read-confirmed and saveable", () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "",
    });
    expect(isReadConfirmed(state)).toBe(true);
    expect(isDirty(state)).toBe(false);
    const before = state;
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "",
      generation: 1,
      allowEmpty: false,
    });
    expect(state.saveInFlight).toBe(true);
    expect(before.lastSaved).toBe("");
  });
});

describe("scope-keyed drafts", () => {
  test("the same relative path under another scope never restores a foreign draft", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A scope work" });
    // Open the same relpath under a different host+workspace:
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_B,
      path: FILE_A,
      content: "other scope body",
    });
    // Fresh content adopted — not the foreign draft:
    expect(state.draft).toBe("other scope body");
    expect(isDirty(state)).toBe(false);
    // Neither scope's data was silently reset:
    expect(state.files[KEY_A]).toEqual({ draft: "A scope work", lastSaved: "A saved" });
    expect(state.files[scopedFileKey(SCOPE_B, FILE_A)]).toEqual({
      draft: "other scope body",
      lastSaved: "other scope body",
    });
  });

  test("returning to the original scope restores its retained draft", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A scope work" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_B,
      path: FILE_A,
      content: "other scope body",
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "A saved",
    });
    expect(state.draft).toBe("A scope work");
    expect(isDirty(state)).toBe(true);
    expect(state.openScope).toEqual(SCOPE_A);
  });

  test("same-scope file switches keep per-path retention (unchanged guarantee)", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A unsaved" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "B saved",
    });
    expect(state.draft).toBe("B saved");
    expect(state.files[KEY_A]).toEqual({ draft: "A unsaved", lastSaved: "A saved" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "A saved",
    });
    expect(state.draft).toBe("A unsaved");
    expect(isDirty(state)).toBe(true);
  });

  test("a failed read retains the draft in its scope and restores it after a switch", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "kept work" });
    // Read fails (content null + readError is a parent-render concern; the
    // state keeps the retained entry regardless).
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: null,
    });
    expect(state.draft).toBe("kept work");
    expect(isDirty(state)).toBe(true);
  });
});

describe("pending-save retirement on completion", () => {
  test("a success after switching files retires the lock and updates only the original entry", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "A draft",
      generation: 1,
      allowEmpty: false,
    });
    // Rapid switch to B before A completes:
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    // The lock is retired — B is savable again…
    expect(state.saveInFlight).toBe(false);
    expect(state.savingKey).toBeNull();
    // …B's active pane is untouched…
    expect(state.openPath).toBe(FILE_B);
    expect(state.lastSaved).toBe("B saved");
    expect(isDirty(state)).toBe(false);
    // …and ONLY A's retained entry carries the confirmed save.
    expect(state.files[KEY_A]).toEqual({ draft: "A draft", lastSaved: "A draft" });
  });

  test("A pending -> switch B -> settle A -> B is savable and A shows correct state on return", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "A draft",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "B saved",
    });
    // While A's save is pending, B cannot be saved (single in-flight slot):
    expect(
      saveAdmission(state, SCOPE_A, FILE_B, false),
    ).toBe(false);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    // After A settles, B's save is enabled again:
    state = applyEditorAction(state, { type: "edited", value: "B draft" });
    expect(saveAdmission(state, SCOPE_A, FILE_B, false)).toBe(true);
    // Returning to A shows its confirmed save (draft === lastSaved, clean):
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "A saved",
    });
    expect(state.draft).toBe("A draft");
    expect(state.lastSaved).toBe("A draft");
    expect(isDirty(state)).toBe(false);
  });

  test("a success whose scope changed with the same path retires without touching the active pane", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "A draft",
      generation: 1,
      allowEmpty: false,
    });
    // The scope flips to another host/workspace with the same relpath:
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_B,
      path: FILE_A,
      content: "other scope body",
    });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    // Lock retired; the other scope's active pane is untouched.
    expect(state.saveInFlight).toBe(false);
    expect(state.draft).toBe("other scope body");
    expect(state.lastSaved).toBe("other scope body");
    expect(state.files[KEY_A]).toEqual({ draft: "A draft", lastSaved: "A draft" });
    expect(state.files[scopedFileKey(SCOPE_B, FILE_A)]).toEqual({
      draft: "other scope body",
      lastSaved: "other scope body",
    });
  });

  test("a failure after switching retires the lock and keys the error to the original file", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "A draft",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "B saved",
    });
    state = applyEditorAction(state, {
      type: "save-failed",
      key: KEY_A,
      generation: 1,
      message: "disk full",
    });
    expect(state.saveInFlight).toBe(false);
    expect(state.saveError).toEqual({
      key: KEY_A,
      path: FILE_A,
      message: "disk full",
    });
    // B is untouched and immediately savable after an edit:
    expect(state.lastSaved).toBe("B saved");
    state = applyEditorAction(state, { type: "edited", value: "B draft" });
    expect(saveAdmission(state, SCOPE_A, FILE_B, false)).toBe(true);
  });

  test("a save started for a file that is not the open one is refused at start", () => {
    const state = opened("A saved", FILE_A, SCOPE_A);
    const fenced = applyEditorAction(state, {
      type: "save-started",
      key: KEY_B,
      path: FILE_B,
      draft: "x",
      generation: 1,
      allowEmpty: false,
    });
    expect(fenced).toBe(state);
  });

  test("the open file's own save still completes normally through the fence", () => {
    let state = opened("A saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "A draft",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(state.lastSaved).toBe("A draft");
    expect(isDirty(state)).toBe(false);
  });
});

describe("saveAdmission (prop/state fence)", () => {
  test("state describing another path or scope is never admitted", () => {
    const state = opened("body", FILE_A, SCOPE_A);
    expect(saveAdmission(state, SCOPE_A, FILE_B, false)).toBe(false);
    expect(saveAdmission(state, SCOPE_B, FILE_A, false)).toBe(false);
    expect(saveAdmission(state, SCOPE_A, null, false)).toBe(false);
    expect(saveAdmission(state, SCOPE_A, FILE_A, false)).toBe(false); // clean
  });

  test("an in-flight save blocks admission until it retires", () => {
    let state = opened("saved", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "draft",
      generation: 1,
      allowEmpty: false,
    });
    expect(saveAdmission(state, SCOPE_A, FILE_A, false)).toBe(false);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(saveAdmission(state, SCOPE_A, FILE_A, false)).toBe(false); // clean again
  });

  test("unread files are refused without new-file intent and admitted with it", () => {
    const unread = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: "new-file.ts",
      content: null,
    });
    const key = scopedFileKey(SCOPE_A, "new-file.ts");
    expect(saveAdmission(unread, SCOPE_A, "new-file.ts", false)).toBe(false);
    // With intent, the untouched placeholder draft is dirty ("" vs null) and admitted:
    expect(saveAdmission(unread, SCOPE_A, "new-file.ts", true)).toBe(true);
    void key;
  });
});

describe("dirty tracking and retry (regressions)", () => {
  test("a freshly opened, read file is clean; editing marks it dirty", () => {
    let state = opened("saved body");
    expect(isDirty(state)).toBe(false);
    state = applyEditorAction(state, { type: "edited", value: "new body" });
    expect(isDirty(state)).toBe(true);
    state = applyEditorAction(state, { type: "edited", value: "saved body" });
    expect(isDirty(state)).toBe(false);
  });

  test("edits typed while a save is in flight keep the pane dirty after success", () => {
    let state = opened("saved");
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "attempt one",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, { type: "edited", value: "attempt two" });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(state.lastSaved).toBe("attempt one");
    expect(state.draft).toBe("attempt two");
    expect(isDirty(state)).toBe(true);
  });

  test("a failed save keeps the draft and error; retry clears error then succeeds", () => {
    let state = opened("saved");
    state = applyEditorAction(state, { type: "edited", value: "draft" });
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "draft",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "save-failed",
      key: KEY_A,
      generation: 1,
      message: "disk full",
    });
    expect(state.saveError).toEqual({ key: KEY_A, path: FILE_A, message: "disk full" });
    expect(state.draft).toBe("draft");
    expect(state.saveInFlight).toBe(false);
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "draft",
      generation: nextSaveGeneration(state),
      allowEmpty: false,
    });
    expect(state.saveError).toBeNull();
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 2,
    });
    expect(isDirty(state)).toBe(false);
  });

  test("each new save gets a fresh generation; completions do not advance it", () => {
    let state = opened("saved");
    expect(nextSaveGeneration(state)).toBe(1);
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "d",
      generation: 1,
      allowEmpty: false,
    });
    expect(nextSaveGeneration(state)).toBe(2);
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(state.saveGeneration).toBe(1);
    expect(nextSaveGeneration(state)).toBe(2);
  });
});

describe("runSave with deferred fakes (scoped identity)", () => {
  test("dispatches save-started with the scoped key, then the fenced outcome", async () => {
    const dispatched: EditorAction[] = [];
    const gate = deferred<Result<null>>();
    const pending = runSave({
      draft: "my draft",
      scope: SCOPE_A,
      path: FILE_A,
      generation: 7,
      allowEmpty: false,
      onSave: () => gate.promise,
      dispatch: (action) => dispatched.push(action),
    });
    expect(dispatched).toEqual([
      {
        type: "save-started",
        key: "h1/w1/src/a.ts",
        path: FILE_A,
        draft: "my draft",
        generation: 7,
        allowEmpty: false,
      },
    ]);
    gate.resolve({ ok: true, result: null });
    await pending;
    expect(dispatched[1]).toEqual({
      type: "save-succeeded",
      key: "h1/w1/src/a.ts",
      generation: 7,
    });
  });

  test("a thrown save becomes a retryable failure carrying the scoped identity", async () => {
    const dispatched: EditorAction[] = [];
    await runSave({
      draft: "my draft",
      scope: SCOPE_B,
      path: FILE_A,
      generation: 1,
      allowEmpty: true,
      onSave: () => Promise.reject(new Error("boom")),
      dispatch: (action) => dispatched.push(action),
    });
    expect(dispatched[1]).toEqual({
      type: "save-failed",
      key: "h2/w2/src/a.ts",
      generation: 1,
      message: "The file could not be saved.",
    });
  });

  test("interleaved saves dispatch their own scoped identities", async () => {
    const dispatched: EditorAction[] = [];
    const gateA = deferred<Result<null>>();
    const saveA = runSave({
      draft: "A draft",
      scope: SCOPE_A,
      path: FILE_A,
      generation: 1,
      allowEmpty: false,
      onSave: () => gateA.promise,
      dispatch: (action) => dispatched.push(action),
    });
    const saveB = runSave({
      draft: "B draft",
      scope: SCOPE_A,
      path: FILE_B,
      generation: 2,
      allowEmpty: false,
      onSave: okSave(),
      dispatch: (action) => dispatched.push(action),
    });
    await saveB;
    gateA.resolve({ ok: true, result: null });
    await saveA;
    expect(dispatched.map((action) => action.type)).toEqual([
      "save-started",
      "save-started",
      "save-succeeded",
      "save-succeeded",
    ]);
    expect(dispatched[2]).toEqual({ type: "save-succeeded", key: KEY_B, generation: 2 });
    expect(dispatched[3]).toEqual({ type: "save-succeeded", key: KEY_A, generation: 1 });
  });
});

describe("restoredDraft truthfulness", () => {
  test("draft-restored presents the open file truthfully dirty (lastSaved stays service-confirmed)", () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "service body",
    });
    state = applyEditorAction(state, {
      type: "draft-restored",
      scope: SCOPE_A,
      path: FILE_A,
      draft: "my retained draft",
      lastSaved: "saved body",
    });
    expect(state.draft).toBe("my retained draft");
    expect(state.lastSaved).toBe("saved body");
    expect(isDirty(state)).toBe(true);
    expect(state.files[KEY_A]).toEqual({
      draft: "my retained draft",
      lastSaved: "saved body",
    });
  });

  test("draft-restored seeds a non-open file's entry without switching or clobbering", () => {
    let state = opened("open body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, {
      type: "draft-restored",
      scope: SCOPE_A,
      path: FILE_B,
      draft: "B retained",
      lastSaved: "B saved",
    });
    // Still on FILE_A with its own content:
    expect(state.openPath).toBe(FILE_A);
    expect(state.draft).toBe("open body");
    // B's entry was seeded:
    expect(state.files[KEY_B]).toEqual({ draft: "B retained", lastSaved: "B saved" });
    // Re-restoring never clobbers an existing entry:
    const before = state;
    state = applyEditorAction(state, {
      type: "draft-restored",
      scope: SCOPE_A,
      path: FILE_B,
      draft: "older draft",
      lastSaved: null,
    });
    expect(state).toBe(before);
  });

  test("a mounted pane with a restored draft renders dirty from the first paint", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        scope: SCOPE_A,
        path: FILE_A,
        content: "saved body",
        restoredDraft: { draft: "my retained draft", lastSaved: "saved body" },
        onSave: okSave(),
      }),
    );
    // Truthfully dirty at first paint:
    expect(markup).toContain("Unsaved changes");
    expect(markup).not.toContain("Waiting for file content");
    // The content surface (Monaco in a real renderer) is fed `state.draft`,
    // not rendered as raw text by `renderToString` itself, so the actual
    // draft VALUE is verified directly against the same first-paint seeding
    // rule the component's useReducer initializer calls.
    const seeded = initializeEditorPaneState({
      scope: SCOPE_A,
      path: FILE_A,
      content: "saved body",
      restoredDraft: { draft: "my retained draft", lastSaved: "saved body" },
    });
    expect(seeded.draft).toBe("my retained draft");
    expect(seeded.lastSaved).toBe("saved body");
    expect(isDirty(seeded)).toBe(true);
  });

  test("without a restored draft the pane stays clean for the same content", () => {
    const markup = renderToString(
      createElement(EditorPane, {
        scope: SCOPE_A,
        path: FILE_A,
        content: "saved body",
        onSave: okSave(),
      }),
    );
    expect(markup).not.toContain("Unsaved changes");
  });

  test("the read flow cannot clobber a restored dirty draft", () => {
    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "saved body",
      });
    // The panel restores the store's dirty draft (consumed on mount):
    state = applyEditorAction(state, {
      type: "draft-restored",
      scope: SCOPE_A,
      path: FILE_A,
      draft: "my retained draft",
      lastSaved: "saved body",
    });
    // The delayed service read arrives with the on-disk content:
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "saved body",
    });
    expect(state.draft).toBe("my retained draft");
    expect(state.lastSaved).toBe("saved body");
    expect(isDirty(state)).toBe(true);
  });
});

describe("changed-on-disk mark", () => {
  test("a refresh that disagrees with the dirty draft's baseline sets the mark", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    expect(hasChangedOnDisk(state)).toBe(false);
    // Reload while dirty: the reducer keeps the draft, but the disk content
    // it just saw no longer matches the draft's baseline.
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(state.draft).toBe("my edits");
    expect(state.lastSaved).toBe("saved body");
    expect(hasChangedOnDisk(state)).toBe(true);
  });

  test("a refresh that still matches the baseline does not set the mark", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "saved body",
    });
    expect(hasChangedOnDisk(state)).toBe(false);
  });

  test("clears once the file becomes clean again", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(hasChangedOnDisk(state)).toBe(true);
    // Undo back to the (stale) baseline: still same-spot, but no longer dirty.
    state = applyEditorAction(state, { type: "edited", value: "saved body" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(hasChangedOnDisk(state)).toBe(false);
  });

  test("clears on switching to another file and does not leak back", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(hasChangedOnDisk(state)).toBe(true);
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "b body",
    });
    expect(hasChangedOnDisk(state)).toBe(false);
    // Switching back to FILE_A restores its retained (still dirty) entry —
    // the mark itself is a live-view signal, not part of retained state.
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: null,
    });
    expect(state.draft).toBe("my edits");
    expect(hasChangedOnDisk(state)).toBe(false);
  });

  test("clears on a successful save of the open file", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(hasChangedOnDisk(state)).toBe(true);
    state = applyEditorAction(state, {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "my edits",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(hasChangedOnDisk(state)).toBe(false);
  });

  test("retains the disagreeing read while the mark is set, draft untouched", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(externalContentFor(state)).toBe("someone else's edit");
    expect(state.draft).toBe("my edits");
    expect(state.lastSaved).toBe("saved body");
  });

  test("survives continued typing; clears when the read agrees again", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "my edits" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(externalContentFor(state)).toBe("someone else's edit");
    state = applyEditorAction(state, { type: "edited", value: "my edits plus more" });
    expect(externalContentFor(state)).toBe("someone else's edit");
    // Disk restored to the baseline: the mark and the retained read clear.
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "saved body",
    });
    expect(hasChangedOnDisk(state)).toBe(false);
    expect(externalContentFor(state)).toBeNull();
  });

  test("clears with the mark on save, switch and clean adoption", () => {
    const conflicted = (): EditorState => {
      let state = opened("saved body", FILE_A, SCOPE_A);
      state = applyEditorAction(state, { type: "edited", value: "my edits" });
      return applyEditorAction(state, {
        type: "file-opened",
        scope: SCOPE_A,
        path: FILE_A,
        content: "someone else's edit",
      });
    };
    expect(externalContentFor(conflicted())).toBe("someone else's edit");
    // Save resolves the conflict in favor of the draft.
    let state = applyEditorAction(conflicted(), {
      type: "save-started",
      key: KEY_A,
      path: FILE_A,
      draft: "my edits",
      generation: 1,
      allowEmpty: false,
    });
    state = applyEditorAction(state, {
      type: "save-succeeded",
      key: KEY_A,
      generation: 1,
    });
    expect(externalContentFor(state)).toBeNull();
    // Switching files drops the open-file-scoped slot with the mark.
    state = applyEditorAction(conflicted(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_B,
      content: "b body",
    });
    expect(externalContentFor(state)).toBeNull();
    // Clean adoption (undo to baseline, then the same read) has no conflict.
    state = applyEditorAction(conflicted(), { type: "edited", value: "saved body" });
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "someone else's edit",
    });
    expect(externalContentFor(state)).toBeNull();
    expect(state.draft).toBe("someone else's edit");
  });
});

describe("restore seeding (per-file, initial-null path)", () => {
  test("shouldSeedRestore: null path never seeds; unknown key seeds; existing entry never re-seeds", () => {
    const state = opened("body", FILE_A, SCOPE_A);
    expect(shouldSeedRestore(state, SCOPE_A, null)).toBe(false);
    expect(shouldSeedRestore(state, SCOPE_A, FILE_B)).toBe(true);
    expect(shouldSeedRestore(state, SCOPE_A, FILE_A)).toBe(false);
    expect(shouldSeedRestore(state, SCOPE_B, FILE_A)).toBe(true);
  });

  test("initial-null mount then selecting a previously-dirty file seeds its restored draft", () => {
    // Effect logic mirror: the panel mounts with no selection (path null),
    // so nothing seeds and the gate is NOT globally disabled…
    let state = initialEditorState();
    expect(shouldSeedRestore(state, SCOPE_A, FILE_A)).toBe(true); // gate open
    // …the user then selects the previously-dirty file (restoredDraft
    // arrives from the descriptor-owned store):
    const key = KEY_A;
    if (shouldSeedRestore(state, SCOPE_A, FILE_A)) {
      state = applyEditorAction(state, {
        type: "draft-restored",
        scope: SCOPE_A,
        path: FILE_A,
        draft: "retained work",
        lastSaved: "saved body",
      });
    }
    // The same effect then dispatches the selection (file-opened):
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: FILE_A,
      content: "service read",
    });
    expect(state.draft).toBe("retained work");
    expect(state.lastSaved).toBe("saved body");
    expect(isDirty(state)).toBe(true);
    // A later effect run must not re-seed (entry now exists locally):
    expect(shouldSeedRestore(state, SCOPE_A, FILE_A)).toBe(false);
    void key;
  });

  test("seeding never overwrites already-edited local state for the same file", () => {
    let state = opened("saved body", FILE_A, SCOPE_A);
    state = applyEditorAction(state, { type: "edited", value: "local edits" });
    expect(shouldSeedRestore(state, SCOPE_A, FILE_A)).toBe(false);
  });
});

describe("EditorPane rendering", () => {
  const render = (props: Partial<EditorPaneProps>) =>
    renderToString(
      createElement(EditorPane, {
        scope: SCOPE_A,
        path: FILE_A,
        content: "body",
        onSave: okSave(),
        ...props,
      }),
    );

  test("a pending read renders the explicit unread state with no Save and no textarea", () => {
    const markup = render({ content: null });
    expect(markup).toContain("Waiting for file content");
    expect(markup).not.toContain(">Save<");
    expect(markup).not.toContain("Unsaved changes");
    expect(markup).not.toContain("Contents of");
  });

  test("after content arrives the editor renders with Save enabled", () => {
    const markup = render({ content: "body" });
    expect(markup).toContain(">Save<");
    expect(markup).toContain("Contents of");
    expect(markup).not.toContain("Waiting for file content");
  });

  test("a read error shows the read-error state with the retry-read affordance", () => {
    const markup = render({
      content: null,
      readError: "File unavailable",
      onReload: () => {},
    });
    expect(markup).toContain("File unavailable");
    expect(markup).toContain("Retry read");
  });

  test("with no open file it shows the empty state", () => {
    const markup = render({ path: null, content: null });
    expect(markup).toContain("No file open");
  });

  test("new-file intent renders an editable empty pane with Save", () => {
    const markup = render({ content: null, allowEmptySave: true });
    expect(markup).toContain(">Save<");
    expect(markup).not.toContain("Waiting for file content");
  });

  test("an opened clean file shows no dirty indicator; label carries the path", () => {
    const markup = render({ content: "body" });
    expect(markup).toContain(FILE_A);
    expect(markup).not.toContain("Unsaved changes");
  });
});
