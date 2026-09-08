import { describe, expect, test } from "vitest";
import {
  createFilesDraftStore,
  editorContentFor,
  type FilesDraftStore,
} from "./files-draft-store";
import { isFilesAvailable } from "./files-panel";
import { filesReadTarget } from "../editor/file-read-write";

const SCOPE_A = { hostId: "h1", workspaceId: "w1" };
const SCOPE_B = { hostId: "h2", workspaceId: "w2" };
const FILE_A = "src/a.ts";

describe("draft store lifecycle (unmount/remount survival)", () => {
  test("edit A -> simulated unmount -> navigation -> reopen A retains the draft", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "saved body");
    store.recordDraft(SCOPE_A, FILE_A, "my unsaved work");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
    // V2 unmounts the panel here; the descriptor-owned store does not care.
    // Navigation opens another file in the store:
    store.confirmRead(SCOPE_B, "other.md", "other body");
    // Remount + reopen A: the draft is retained, keyed by scope+path.
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("my unsaved work");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
    expect(store.savedContentOf(SCOPE_A, FILE_A)).toBe("saved body");
  });

  test("a confirmed save retires the dirty flag; further edits re-dirty", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "saved");
    store.recordDraft(SCOPE_A, FILE_A, "edited");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
    // The service accepted the write:
    store.markSaved(SCOPE_A, FILE_A, "edited");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(false);
    expect(store.savedContentOf(SCOPE_A, FILE_A)).toBe("edited");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("edited");
    // A later edit dirties again against the new confirmed content:
    store.recordDraft(SCOPE_A, FILE_A, "edited plus");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
  });

  test("refresh adopts service content only when the entry is clean", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "disk v1");
    store.recordDraft(SCOPE_A, FILE_A, "my draft");
    // A refresh/re-read arrives while dirty: the draft wins.
    store.confirmRead(SCOPE_A, FILE_A, "disk v2");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("my draft");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
    // Clean entry: the service content is adopted (service is saved-truth).
    store.markSaved(SCOPE_A, FILE_A, "my draft");
    store.confirmRead(SCOPE_A, FILE_A, "disk v3");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("disk v3");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(false);
  });

  test("same relpath under another scope never inherits the draft", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "A saved");
    store.recordDraft(SCOPE_A, FILE_A, "A draft");
    store.confirmRead(SCOPE_B, FILE_A, "B body");
    expect(store.draftOf(SCOPE_B, FILE_A)).toBe("B body");
    expect(store.isDirty(SCOPE_B, FILE_A)).toBe(false);
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("A draft");
  });

  test("editorContentFor prefers the dirty draft and otherwise the service content", () => {
    const store = createFilesDraftStore();
    expect(
      editorContentFor(store, SCOPE_A, FILE_A, "service body"),
    ).toBe("service body");
    store.confirmRead(SCOPE_A, FILE_A, "service body");
    store.recordDraft(SCOPE_A, FILE_A, "retained draft");
    expect(
      editorContentFor(store, SCOPE_A, FILE_A, "service body"),
    ).toBe("retained draft");
    store.markSaved(SCOPE_A, FILE_A, "retained draft");
    expect(
      editorContentFor(store, SCOPE_A, FILE_A, "service body"),
    ).toBe("service body");
    expect(editorContentFor(store, SCOPE_A, null, "x")).toBeNull();
  });
});

describe("per-edit recording", () => {
  test("successive recordDraft calls (one per keystroke) keep the latest draft dirty", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "saved body");
    // The panel's onDraftChange fires recordDraft per edit:
    store.recordDraft(SCOPE_A, FILE_A, "d");
    store.recordDraft(SCOPE_A, FILE_A, "dr");
    store.recordDraft(SCOPE_A, FILE_A, "draft without save");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("draft without save");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
    expect(store.savedContentOf(SCOPE_A, FILE_A)).toBe("saved body");
    // Type-without-save then "unmount": the store (descriptor lifetime)
    // still holds the latest draft, and a remount consult returns it.
    expect(
      editorContentFor(store, SCOPE_A, FILE_A, "service body"),
    ).toBe("draft without save");
  });

  test("per-edit recording under a different scope never touches the other scope's draft", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "A saved");
    store.recordDraft(SCOPE_A, FILE_A, "A draft");
    store.recordDraft(SCOPE_B, FILE_A, "B typing");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("A draft");
    expect(store.draftOf(SCOPE_B, FILE_A)).toBe("B typing");
  });
});

describe("availability: memory-only, never touches the bridge", () => {
  test("the store takes no bridge and performs no file calls by construction", () => {
    // createFilesDraftStore() accepts no bridge; these operations are pure
    // state transitions and can never reach file methods.
    const store: FilesDraftStore = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "body");
    store.recordDraft(SCOPE_A, FILE_A, "draft");
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("draft");
  });

  test("while files.v1 is absent the read target is null (no reads, no writes)", () => {
    const unavailable = isFilesAvailable(["sessions.v1"]);
    expect(filesReadTarget(unavailable, FILE_A)).toBeNull();
    expect(filesReadTarget(unavailable, null)).toBeNull();
    // Available again, the same file is readable:
    expect(filesReadTarget(isFilesAvailable(["files.v1"]), FILE_A)).toBe(FILE_A);
  });

  test("availability loss -> reconnect: the draft stays intact and a clean entry adopts service content", () => {
    const store = createFilesDraftStore();
    // Online phase: read + edit.
    store.confirmRead(SCOPE_A, FILE_A, "saved body");
    store.recordDraft(SCOPE_A, FILE_A, "survivor draft");
    // Availability lost: reads are gated off (filesReadTarget null above);
    // the memory-only store keeps everything without touching the bridge.
    // Reconnect: a fresh read confirms service content.
    store.confirmRead(SCOPE_A, FILE_A, "post-reconnect disk");
    // The dirty draft survived and still wins over the fresh read:
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("survivor draft");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
  });
});

// The old "factory wiring with the descriptor-owned store" suite is gone
// (R16-A): that concern — a draft store surviving a V2 route unmount/
// remount — belonged to the embedded sidebar editor. The main tab group's
// EditorHost (features/editor/EditorHost.tsx) now owns its own store for
// its own (much longer) mount lifetime — it stays mounted for as long as
// any editor tab exists, independent of right-sidebar route switches —
// so there is no factory-injection seam left to test here.
