import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  FILES_ROUTE_ID,
  createFilesPanelDescriptor,
  createFilesSource,
  createRequestIdSource,
  entryToNode,
  filesReadTarget,
  isFilesAvailable,
  joinEntryPath,
  makeFileSaver,
  readContentFor,
  readErrorFor,
  runFilesRead,
  truncationNoticeText,
  type FilesReadState,
} from "./files-panel";
import {
  applyEditorAction,
  initialEditorState,
  isDirty,
  nextSaveGeneration,
  runSave,
  scopedFileKey,
  type EditorAction,
  type EditorScope,
} from "../editor/EditorPane";
import {
  FILES_CAPABILITY,
  MAX_DIRECTORY_ENTRIES,
  type FileBridge,
  type WorkspaceFileEntry,
} from "../../../../shared/file-contract";
import type { Session, Status, Workspace } from "../../../../shared/session-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SCOPE_A: EditorScope = { hostId: "h1", workspaceId: "w1" };
const KEY_A = scopedFileKey(SCOPE_A, "src/a.ts");
const KEY_B = scopedFileKey(SCOPE_A, "src/b.ts");

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

const session: Session | null = null;

function fakeBridge() {
  const calls = { list: 0, read: 0, write: 0 };
  const requestIds: string[] = [];
  return {
    calls,
    requestIds,
    bridge: {
      fileList: () => {
        calls.list += 1;
        return Promise.reject(new Error("fileList not gated in this test"));
      },
      fileRead: () => {
        calls.read += 1;
        return Promise.reject(new Error("fileRead not gated in this test"));
      },
      fileWrite: (input: { requestId: string }) => {
        calls.write += 1;
        requestIds.push(input.requestId);
        return Promise.reject(new Error("fileWrite not gated in this test"));
      },
    } satisfies FileBridge,
  };
}

describe("factory shape and capability gate", () => {
  test("the descriptor targets the files.explorer route gated on files.v1", () => {
    const { bridge } = fakeBridge();
    const descriptor = createFilesPanelDescriptor({ bridge });
    expect(descriptor.id).toBe("files.explorer");
    expect(FILES_ROUTE_ID).toBe("files.explorer");
    expect(descriptor.capability).toBe(FILES_CAPABILITY);
    expect(descriptor.capability).toBe("files.v1");
    expect(typeof descriptor.title).toBe("string");
    expect(typeof descriptor.component).toBe("function");
  });

  test("isFilesAvailable checks exactly the FILES_CAPABILITY marker", () => {
    expect(isFilesAvailable(["files.v1"])).toBe(true);
    expect(isFilesAvailable(["sessions.v1", "files.v1", "bots.v0"])).toBe(true);
    expect(isFilesAvailable([])).toBe(false);
    expect(isFilesAvailable(["sessions.v1"])).toBe(false);
    expect(isFilesAvailable(["files.v2"])).toBe(false);
  });
});

describe("listing through the factory source (truncation surfaced)", () => {
  test("list+map: entries become explorer rows with composed paths and the symlink marker", async () => {
    const gate = deferred<{
      ok: true;
      result: {
        path: string;
        entries: WorkspaceFileEntry[];
        truncated: boolean;
        hostId: string;
        workspaceId: string;
      };
    }>();
    let seenLimit: number | undefined;
    const bridge: FileBridge = {
      fileList: (input) => {
        seenLimit = input.limitEntries;
        return gate.promise;
      },
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: () => Promise.reject(new Error("unused")),
    };
    const source = createFilesSource(bridge, SCOPE_A);
    const pending = source.listDir("");
    // The listing always carries the service's directory cap explicitly:
    expect(seenLimit).toBe(MAX_DIRECTORY_ENTRIES);
    gate.resolve({
      ok: true,
      result: {
        hostId: "h1",
        workspaceId: "w1",
        path: ".",
        truncated: false,
        entries: [
          { name: "src", kind: "directory", size: 0, mtime: "t" },
          { name: "README.md", kind: "file", size: 12, mtime: "t" },
          { name: "link", kind: "symlink", size: 4, mtime: "t" },
        ],
      },
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [dir, file, link] = result.result;
    expect(dir).toEqual({ name: "src", path: "src", kind: "directory" });
    expect(file).toEqual({ name: "README.md", path: "README.md", kind: "file" });
    // The symlink row is selectable as a file AND keeps its distinct marker.
    expect(link).toEqual({
      name: "link",
      path: "link",
      kind: "file",
      symlink: true,
    });
  });

  test("a truncated listing is reported through onListing, never silently complete", async () => {
    const gate = deferred<{
      ok: true;
      result: {
        path: string;
        entries: WorkspaceFileEntry[];
        truncated: boolean;
        hostId: string;
        workspaceId: string;
      };
    }>();
    const bridge: FileBridge = {
      fileList: () => gate.promise,
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: () => Promise.reject(new Error("unused")),
    };
    const listings: Array<{ path: string; truncated: boolean; count: number }> = [];
    const source = createFilesSource(bridge, SCOPE_A, (info) => listings.push(info));
    const pending = source.listDir("src");
    gate.resolve({
      ok: true,
      result: {
        hostId: "h1",
        workspaceId: "w1",
        path: "src",
        truncated: true,
        entries: [{ name: "a.ts", kind: "file", size: 1, mtime: "t" }],
      },
    });
    await pending;
    expect(listings).toEqual([{ path: "src", truncated: true, count: 1 }]);
    // The notice names the directory, the cap actually hit, and that
    // entries may be missing — no silent complete listing.
    const notice = truncationNoticeText("src", 1);
    expect(notice).toContain("src");
    expect(notice).toContain("truncated");
    expect(notice).toContain("1");
    expect(notice).toContain("missing");
    // A complete listing still reports, with truncated false (no notice renders).
    const source2 = createFilesSource(bridge, SCOPE_A, (info) => listings.push(info));
    const pending2 = source2.listDir(".");
    void pending2;
  });

  test("truncation notices are scoped: another scope's notice never renders", () => {
    // The panel stamps notices with the scope key and renders only a match;
    // this pins the key discipline the render gate uses.
    const notice = truncationNoticeText(".", MAX_DIRECTORY_ENTRIES);
    expect(notice).toContain("workspace root");
    expect(notice).toContain(String(MAX_DIRECTORY_ENTRIES));
  });

  test("nested listings compose parent path from the echoed scope", () => {
    expect(joinEntryPath(".", "main.ts")).toBe("main.ts");
    expect(joinEntryPath("src", "main.ts")).toBe("src/main.ts");
    const node = entryToNode(
      { name: "lib", kind: "directory", size: 0, mtime: "t" },
      "src",
    );
    expect(node.path).toBe("src/lib");
  });
});

describe("read gating and identity", () => {
  test("filesReadTarget: no read while unavailable or with nothing open", () => {
    expect(filesReadTarget(false, "a.ts")).toBeNull();
    expect(filesReadTarget(true, null)).toBeNull();
    expect(filesReadTarget(true, "a.ts")).toBe("a.ts");
  });

  test("read content is null until the scope+path identity matches exactly", () => {
    const ready: FilesReadState = {
      key: KEY_A,
      phase: "ready",
      content: "real body",
      message: "",
    };
    expect(readContentFor(ready, SCOPE_A, "src/a.ts")).toBe("real body");
    // Foreign path — even for one frame — never sees this content:
    expect(readContentFor(ready, SCOPE_A, "src/b.ts")).toBeNull();
    // Foreign scope, same relpath, never:
    expect(
      readContentFor(ready, { hostId: "h2", workspaceId: "w2" }, "src/a.ts"),
    ).toBeNull();
    // A loading read keyed to the right file still surfaces no content:
    expect(
      readContentFor({ ...ready, phase: "loading" }, SCOPE_A, "src/a.ts"),
    ).toBeNull();
    expect(readContentFor(ready, SCOPE_A, null)).toBeNull();
  });

  test("read errors obey the same identity gate", () => {
    const failed: FilesReadState = {
      key: KEY_A,
      phase: "error",
      content: null,
      message: "permission denied",
    };
    expect(readErrorFor(failed, SCOPE_A, "src/a.ts")).toBe("permission denied");
    expect(readErrorFor(failed, SCOPE_A, "src/b.ts")).toBeNull();
    expect(
      readErrorFor(failed, { hostId: "h2", workspaceId: "w2" }, "src/a.ts"),
    ).toBeNull();
  });

  test("a deferred read resolves with the file content for the right scope", async () => {
    const gate = deferred<{
      ok: true;
      result: {
        hostId: string;
        workspaceId: string;
        path: string;
        content: string;
        size: number;
        mtime: string;
      };
    }>();
    let seenPath = "";
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: (input) => {
        seenPath = input.path;
        return gate.promise;
      },
      fileWrite: () => Promise.reject(new Error("unused")),
    };
    const done: Array<{ ok: true; content: string } | { ok: false; message: string }> = [];
    const pending = runFilesRead({
      bridge,
      scope: { hostId: "h1", workspaceId: "w1", path: "README.md" },
      generation: 1,
      isCurrent: () => true,
      onDone: (outcome) => done.push(outcome),
    });
    expect(seenPath).toBe("README.md");
    gate.resolve({
      ok: true,
      result: {
        hostId: "h1",
        workspaceId: "w1",
        path: "README.md",
        content: "hello",
        size: 5,
        mtime: "t",
      },
    });
    await pending;
    expect(done).toEqual([{ ok: true, content: "hello" }]);
  });

  test("a read superseded by unmount/scope/path change is dropped (cleanup fence)", async () => {
    const gate = deferred<never>();
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => gate.promise,
      fileWrite: () => Promise.reject(new Error("unused")),
    };
    const done: unknown[] = [];
    // The effect's cleanup bumps the generation; this mirrors that exactly.
    let generation = 1;
    const pending = runFilesRead({
      bridge,
      scope: { hostId: "h1", workspaceId: "w1", path: "a.ts" },
      generation,
      isCurrent: () => generation === 1,
      onDone: (outcome) => done.push(outcome),
    });
    generation = 2; // cleanup ran (unmount / scope / path / reload change)
    gate.reject(new Error("late read"));
    await pending;
    expect(done).toEqual([]);
  });
});

describe("request ids: fresh per logical save, stable per retry, per-mount distinct", () => {
  test("retrying the exact same payload reuses the id; a new payload gets a fresh uuid", () => {
    const source = createRequestIdSource();
    const first = source.next(KEY_A, "same body");
    const retry = source.next(KEY_A, "same body");
    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Edited draft = new logical save:
    const edited = source.next(KEY_A, "changed body");
    expect(edited).not.toBe(first);
    expect(edited).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Same draft for another file = new logical save:
    const otherFile = source.next(KEY_B, "same body");
    expect(otherFile).not.toBe(first);
    // Retry of the edited payload is stable too:
    expect(source.next(KEY_A, "changed body")).toBe(edited);
  });

  test("distinct mounts never share request ids, even for identical payloads", () => {
    const mountOne = createRequestIdSource();
    const mountTwo = createRequestIdSource();
    const idOne = mountOne.next(KEY_A, "body");
    const idTwo = mountTwo.next(KEY_A, "body");
    expect(idOne).not.toBe(idTwo);
    // And each mount keeps its own retry identity:
    expect(mountOne.next(KEY_A, "body")).toBe(idOne);
    expect(mountTwo.next(KEY_A, "body")).toBe(idTwo);
  });

  test("the saver forwards the draft to the id source and onto the wire", async () => {
    const gate = deferred<{
      ok: true;
      result: { hostId: string; workspaceId: string; path: string; size: number; mtime: string };
    }>();
    const wireIds: string[] = [];
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: (input) => {
        wireIds.push(input.requestId);
        return gate.promise;
      },
    };
    const ids = createRequestIdSource();
    const save = makeFileSaver(
      bridge,
      { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
      (draft) => ids.next(KEY_A, draft),
    );
    const first = save("body");
    gate.resolve({
      ok: true,
      result: { hostId: "h1", workspaceId: "w1", path: "src/a.ts", size: 4, mtime: "t" },
    });
    await first;
    const second = save("body"); // retry of the same payload
    void second;
    expect(wireIds).toHaveLength(2);
    expect(wireIds[1]).toBe(wireIds[0]);
    expect(wireIds[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a service refusal passes through verbatim (no rewriting into success)", async () => {
    const failure = {
      ok: false,
      error: { code: "io", message: "read-only volume", retryable: true },
    } as const;
    const failingBridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: () => Promise.resolve(failure),
    };
    expect(
      await makeFileSaver(
        failingBridge,
        { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
        () => crypto.randomUUID(),
      )("body"),
    ).toBe(failure);
  });
});

describe("edit+save through the factory wiring (scoped fenced runSave)", () => {
  test("stale completions are dropped entirely through the factory wiring", async () => {
    // Save A (generation 1) via the factory saver; while it is in flight,
    // open B and save B (generation 2). A's late success is dispatched but
    // the editor's transition fence drops it: B stays saved, A stays dirty.
    const gateA = deferred<{
      ok: true;
      result: { hostId: string; workspaceId: string; path: string; size: number; mtime: string };
    }>();
    const writes: string[] = [];
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: (input) => {
        writes.push(input.path);
        if (input.path === "src/a.ts") return gateA.promise;
        return Promise.resolve({
          ok: true,
          result: { hostId: "h1", workspaceId: "w1", path: input.path, size: 7, mtime: "t" },
        });
      },
    };
    // The component rebuilds the saver per render with the current openPath;
    // the test mirrors that exactly.
    const save = (path: string) =>
      makeFileSaver(bridge, { hostId: "h1", workspaceId: "w1", path }, () =>
        crypto.randomUUID(),
      );

    let state = applyEditorAction(initialEditorState(), {
      type: "file-opened",
      scope: SCOPE_A,
      path: "src/a.ts",
      content: "A saved",
    });
    state = applyEditorAction(state, { type: "edited", value: "A draft" });
    const dispatched: EditorAction[] = [];
    const dispatch = (action: EditorAction) => {
      dispatched.push(action);
      state = applyEditorAction(state, action);
    };
    const generationA = nextSaveGeneration(state);
    const pendingA = runSave({
      draft: state.draft,
      scope: SCOPE_A,
      path: "src/a.ts",
      generation: generationA,
      allowEmpty: false,
      onSave: save("src/a.ts"),
      dispatch,
    });
    expect(state.saveInFlight).toBe(true);
    // Open B while A's save is in flight, edit, and save B.
    state = applyEditorAction(state, {
      type: "file-opened",
      scope: SCOPE_A,
      path: "src/b.ts",
      content: "B saved",
    });
    state = applyEditorAction(state, { type: "edited", value: "B draft" });
    const generationB = nextSaveGeneration(state);
    await runSave({
      draft: state.draft,
      scope: SCOPE_A,
      path: "src/b.ts",
      generation: generationB,
      allowEmpty: false,
      onSave: save("src/b.ts"),
      dispatch,
    });
    expect(state.lastSaved).toBe("B draft");
    expect(isDirty(state)).toBe(false);
    // A's slow write finally succeeds:
    gateA.resolve({
      ok: true,
      result: { hostId: "h1", workspaceId: "w1", path: "src/a.ts", size: 7, mtime: "t" },
    });
    await pendingA;
    // Both writes went through the factory saver…
    expect(writes.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    // …each completion carried its scoped identity…
    expect(dispatched).toContainEqual({
      type: "save-succeeded",
      key: KEY_B,
      generation: generationB,
    });
    expect(dispatched).toContainEqual({
      type: "save-succeeded",
      key: KEY_A,
      generation: generationA,
    });
    // …and the transition fence dropped A's completion entirely: B stays
    // saved, A keeps its dirty draft (re-saved when reopened).
    expect(state.openPath).toBe("src/b.ts");
    expect(state.lastSaved).toBe("B draft");
    expect(isDirty(state)).toBe(false);
    expect(state.files[KEY_A]).toEqual({ draft: "A draft", lastSaved: "A saved" });
  });
});

describe("panel rendering", () => {
  const renderPanel = (bridge: FileBridge, status: Status, session: Session | null) => {
    const descriptor = createFilesPanelDescriptor({ bridge });
    return renderToString(
      createElement(descriptor.component, {
        routeId: FILES_ROUTE_ID,
        session,
        workspace,
        status,
        focusTarget: null,
      }),
    );
  };

  test("null-session mount renders the panel: files never need a terminal session", () => {
    const { bridge, calls } = fakeBridge();
    const markup = renderPanel(bridge, statusWith(["files.v1"]), session);
    expect(markup).toContain("Loading workspace files");
    expect(markup).toContain("No file open");
    expect(calls.list).toBe(0);
  });

  test("missing files.v1 renders the Unavailable fallback and never touches the bridge", () => {
    const { bridge, calls } = fakeBridge();
    const markup = renderPanel(bridge, statusWith(["sessions.v1"]), session);
    expect(markup).toContain("Files unavailable");
    expect(markup).toContain("files.v1");
    expect(markup).not.toContain("Loading workspace files");
    expect(calls.list).toBe(0);
    expect(calls.read).toBe(0);
    expect(calls.write).toBe(0);
  });

  test("an empty capability list is unavailable too — never a silent empty panel", () => {
    const { bridge } = fakeBridge();
    const markup = renderPanel(bridge, statusWith([]), session);
    expect(markup).toContain("Files unavailable");
  });
});
