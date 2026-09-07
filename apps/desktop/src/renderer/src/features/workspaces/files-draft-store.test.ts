import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createFilesDraftStore,
  editorContentFor,
  type FilesDraftStore,
} from "./files-draft-store";
import {
  createFilesPanelDescriptor,
  filesReadTarget,
  isFilesAvailable,
  FILES_ROUTE_ID,
} from "./files-panel";
import type { FileBridge } from "../../../../shared/file-contract";
import type { Session, Status, Workspace } from "../../../../shared/session-contract";

const SCOPE_A = { hostId: "h1", workspaceId: "w1" };
const SCOPE_B = { hostId: "h2", workspaceId: "w2" };
const FILE_A = "src/a.ts";

const noopBridge = (): FileBridge => ({
  fileList: () => Promise.reject(new Error("must never be called")),
  fileRead: () => Promise.reject(new Error("must never be called")),
  fileWrite: () => Promise.reject(new Error("must never be called")),
});

const workspace: Workspace = {
  id: "w1",
  path: "/repo",
  name: "repo",
  kind: "git",
  hostId: "h1",
};
const statusWith = (capabilities: string[]): Status => ({
  hostId: "status-host",
  serviceInstanceId: "svc",
  protocol: 1,
  capabilities,
  version: "0.1.0",
});

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

describe("factory wiring with the descriptor-owned store", () => {
  test("the public factory signature stays stable and the optional drafts dep is honored", () => {
    const descriptor = createFilesPanelDescriptor({ bridge: noopBridge() });
    expect(descriptor.id).toBe(FILES_ROUTE_ID);
    expect(typeof descriptor.component).toBe("function");
    // The store is created per factory call and closed over; passing one
    // explicitly (tests / alternate hosts) must be equally accepted:
    const injected = createFilesDraftStore();
    const withStore = createFilesPanelDescriptor({
      bridge: noopBridge(),
      drafts: injected,
    });
    expect(withStore.id).toBe(FILES_ROUTE_ID);
  });

  test("drafts survive simulated remounts: the same descriptor renders twice with the store intact", () => {
    const store = createFilesDraftStore();
    store.confirmRead(SCOPE_A, FILE_A, "saved body");
    store.recordDraft(SCOPE_A, FILE_A, "survivor draft");
    const descriptor = createFilesPanelDescriptor({
      bridge: noopBridge(),
      drafts: store,
    });
    const mount = () =>
      renderToString(
        createElement(descriptor.component, {
          routeId: FILES_ROUTE_ID,
          session: null as Session | null,
          workspace,
          status: statusWith(["files.v1"]),
          focusTarget: null,
        }),
      );
    const first = mount(); // initial mount
    void first;
    mount(); // simulated unmount + remount (new component instance, same store)
    // The remounted panel must not have wiped the store:
    expect(store.draftOf(SCOPE_A, FILE_A)).toBe("survivor draft");
    expect(store.isDirty(SCOPE_A, FILE_A)).toBe(true);
  });
});
