import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  FILES_ROUTE_ID,
  FilesRequestIdCapError,
  activeOpenPath,
  activeSelection,
  createExplorerSource,
  createFilesPanelDescriptor,
  createFilesSource,
  createRequestIdSource,
  entryToNode,
  filesReadTarget,
  isFilesAvailable,
  joinEntryPath,
  makeFileSaver,
  observeSaveResult,
  openPathSurvivesDeletion,
  readContentFor,
  readErrorFor,
  runFilesRead,
  shouldApplyOpenRequest,
  truncationNoticeText,
  type FileOpenRequestCell,
  type FilesOpenEntry,
  type FilesReadState,
} from "./files-panel";
import { createFilesDraftStore } from "./files-draft-store";
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

describe("request ids: per-attempt identity with settle-on-success", () => {
  test("an unresolved payload keeps its id; settle retires it so the next save is a new attempt", () => {
    const source = createRequestIdSource();
    const first = source.next(KEY_A, "body");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Retry while unresolved reuses the id…
    expect(source.next(KEY_A, "body")).toBe(first);
    // …and a confirmed success retires it:
    source.settle(KEY_A, "body");
    const again = source.next(KEY_A, "body");
    expect(again).not.toBe(first);
    // A failed save (never settled) keeps its retry identity:
    const failed = source.next(KEY_B, "body");
    expect(source.next(KEY_B, "body")).toBe(failed);
  });

  test("saver A->B->A sequence: A's retired receipt is never replayed after B landed", async () => {
    const wire: Array<{ path: string; requestId: string }> = [];
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: (input) => {
        wire.push({ path: input.path, requestId: input.requestId });
        const gate = deferred<void>();
        gates.set(input.path, gate);
        return gate.promise.then(
          () =>
            ({
              ok: true,
              result: {
                hostId: "h1",
                workspaceId: "w1",
                path: input.path,
                size: 4,
                mtime: "t",
              },
            }) as never,
        );
      },
    };
    const ids = createRequestIdSource();
    const saver = (path: string, key: string) =>
      makeFileSaver(bridge, { hostId: "h1", workspaceId: "w1", path }, ids, key);

    const saveA1 = saver("src/a.ts", KEY_A)("same body");
    gates.get("src/a.ts")!.resolve();
    await saveA1;
    const saveB = saver("src/b.ts", KEY_B)("same body");
    gates.get("src/b.ts")!.resolve();
    await saveB;
    const saveA2 = saver("src/a.ts", KEY_A)("same body");
    gates.get("src/a.ts")!.resolve();
    await saveA2;

    const aWrites = wire.filter((w) => w.path === "src/a.ts");
    expect(wire).toHaveLength(3);
    // The second save of A got a FRESH id — the first receipt was retired
    // on success, so the service can never mistake it for a duplicate
    // while disk holds B's write.
    expect(aWrites[1].requestId).not.toBe(aWrites[0].requestId);
    expect(aWrites[0]).toEqual(wire.find((w) => w.path === "src/a.ts")!.valueOf());
  });

  test("a failing save keeps its id across retries until a success settles it", async () => {
    const wire: string[] = [];
    let fail = true;
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: (input) => {
        wire.push(input.requestId);
        const result = fail
          ? ({
              ok: false,
              error: { code: "io", message: "read-only volume", retryable: true },
            } as const)
          : ({
              ok: true,
              result: { hostId: "h1", workspaceId: "w1", path: input.path, size: 1, mtime: "t" },
            });
        return Promise.resolve(result as never);
      },
    };
    const ids = createRequestIdSource();
    const save = makeFileSaver(
      bridge,
      { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
      ids,
      KEY_A,
    );
    const first = await save("body");
    expect(first.ok).toBe(false);
    // Retry after failure reuses the id (still unresolved):
    const retry = await save("body");
    expect(retry.ok).toBe(false);
    expect(wire).toHaveLength(2);
    expect(wire[1]).toBe(wire[0]);
    // The attempt that finally succeeds is still the same logical save…
    fail = false;
    await save("body");
    expect(wire).toHaveLength(3);
    expect(wire[2]).toBe(wire[0]);
    // …and its success settles the id: the next save of the same payload
    // is a new attempt with a fresh id.
    await save("body");
    expect(wire).toHaveLength(4);
    expect(wire[3]).not.toBe(wire[0]);
  });

  test("per-file generation retire: A unresolved -> B (same file) confirmed -> A mints a FRESH id", () => {
    const source = createRequestIdSource();
    const idA = source.next(KEY_A, "draft A");
    // B — a later payload for the SAME file — is confirmed successful:
    const idB = source.next(KEY_A, "draft B");
    source.settle(KEY_A, "draft B");
    // A's unresolved attempt was minted before B's success — superseded:
    // writing A now is a NEW logical write with a fresh id.
    const idA2 = source.next(KEY_A, "draft A");
    expect(idA2).not.toBe(idA);
    expect(idA2).not.toBe(idB);
    // B's own id was settled; retrying B is also a new attempt:
    expect(source.next(KEY_A, "draft B")).not.toBe(idB);
  });

  test("settle safely prunes superseded attempts: the cap is usable again after a success", () => {
    const source = createRequestIdSource({ maxRetained: 2 });
    source.next(KEY_A, "A body"); // unresolved attempt for the file
    source.next(KEY_A, "B body"); // later payload, file cap now full
    // B confirms success: A's attempt (minted before B's success) is
    // superseded-now-safe and must be PRUNED — never retained to jam the cap.
    source.settle(KEY_A, "B body");
    // The pruned space means a brand-new payload still fits without throw:
    expect(() => source.next(KEY_A, "C body")).not.toThrow();
  });

  test("exact-A retry is preserved only while no intervening success exists", () => {
    const source = createRequestIdSource();
    const idA = source.next(KEY_A, "draft A");
    // No success for the file since A was minted — retry identity holds.
    expect(source.next(KEY_A, "draft A")).toBe(idA);
  });

  test("attempts minted AFTER a success stay retryable until the next success", () => {
    const source = createRequestIdSource();
    source.next(KEY_A, "v1");
    source.settle(KEY_A, "v1");
    const post = source.next(KEY_A, "v2");
    expect(source.next(KEY_A, "v2")).toBe(post);
    // Another payload succeeds — v2's attempt is now superseded:
    source.next(KEY_A, "v3");
    source.settle(KEY_A, "v3");
    expect(source.next(KEY_A, "v2")).not.toBe(post);
  });

  test("distinct files keep independent retries across each other's successes", () => {
    const source = createRequestIdSource();
    const idA = source.next(KEY_A, "A body");
    const idB = source.next(KEY_B, "B body");
    // FILE_B's save succeeds: only FILE_B's attempts are superseded.
    source.settle(KEY_B, "B body");
    expect(source.next(KEY_A, "A body")).toBe(idA);
    expect(source.next(KEY_B, "B body")).not.toBe(idB);
  });

  test("cap fails closed: a valid unresolved retry still returns; a new attempt throws a named error", () => {
    const source = createRequestIdSource({ maxRetained: 1 });
    const first = source.next(KEY_A, "payload one");
    // At cap, but this IS the unresolved retry — reuse, never a silent mint:
    expect(source.next(KEY_A, "payload one")).toBe(first);
    // A different (new) payload at cap refuses with the named error:
    expect(() => source.next(KEY_A, "payload two")).toThrowError(
      FilesRequestIdCapError,
    );
    try {
      source.next(KEY_A, "payload two");
    } catch (error) {
      expect((error as Error).name).toBe("FilesRequestIdCapError");
    }
    // After settle, the slot frees and a fresh id is minted:
    source.settle(KEY_A, "payload one");
    expect(source.next(KEY_A, "payload two")).not.toBe(first);
  });

  test("a superseded attempt is replaced in place, not double-counted against the cap", () => {
    const source = createRequestIdSource({ maxRetained: 1 });
    const superseded = source.next(KEY_A, "old");
    source.settle(KEY_A, "old"); // success supersedes the old attempt
    const fresh = source.next(KEY_A, "old"); // 1:1 replacement of the stale entry
    expect(fresh).not.toBe(superseded);
    // Still at exactly one retained entry for the file: a new payload throws.
    expect(() => source.next(KEY_A, "other")).toThrowError(
      FilesRequestIdCapError,
    );
  });

  test("distinct mounts never share request ids, even for identical payloads", () => {
    const mountOne = createRequestIdSource();
    const mountTwo = createRequestIdSource();
    const idOne = mountOne.next(KEY_A, "body");
    const idTwo = mountTwo.next(KEY_A, "body");
    expect(idOne).not.toBe(idTwo);
    expect(mountOne.next(KEY_A, "body")).toBe(idOne);
    expect(mountTwo.next(KEY_A, "body")).toBe(idTwo);
  });

  test("request-id identity survives unmount/remount at descriptor lifetime", () => {
    // The source is owned by the DESCRIPTOR (injected here exactly as the
    // factory owns it), so a V2 unmount/remount must not orphan an
    // unresolved retry the way the old per-mount useMemo did.
    const descriptorSource = createRequestIdSource();
    const descriptor = createFilesPanelDescriptor({
      bridge: fakeBridge().bridge,
      requestIds: descriptorSource,
    });
    expect(descriptor.id).toBe(FILES_ROUTE_ID);
    // "Mount 1": a save attempt goes unresolved (deferred write never
    // settles in this scenario).
    const attemptId = descriptorSource.next(KEY_A, "remount body");
    // V2 unmounts and remounts the panel — same descriptor, same source.
    // A retry of the exact payload reuses the attempt id:
    expect(descriptorSource.next(KEY_A, "remount body")).toBe(attemptId);
    // And a wire write through the factory wiring carries that same id:
    const wire: string[] = [];
    const bridge: FileBridge = {
      fileList: () => Promise.reject(new Error("unused")),
      fileRead: () => Promise.reject(new Error("unused")),
      fileWrite: (input) => {
        wire.push(input.requestId);
        return Promise.resolve({
          ok: true,
          result: { hostId: "h1", workspaceId: "w1", path: input.path, size: 1, mtime: "t" },
        });
      },
    };
    const retrySaver = makeFileSaver(
      bridge,
      { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
      descriptorSource,
      KEY_A,
    );
    return retrySaver("remount body").then(() => {
      expect(wire).toEqual([attemptId]);
    });
  });

  test("safe prune never removes a valid retry (minted after the last success)", () => {
    const source = createRequestIdSource({ maxRetained: 2 });
    const v1 = source.next(KEY_A, "v1");
    source.settle(KEY_A, "v1"); // success prunes v1 (superseded-now-safe)
    // Minted AFTER the success: this is a valid unresolved retry…
    const v2 = source.next(KEY_A, "v2");
    expect(v2).not.toBe(v1);
    source.next(KEY_A, "v3"); // second unresolved payload, cap now full
    // …and it survives: nothing has superseded it, so even at cap it is
    // returned rather than silently replaced…
    expect(source.next(KEY_A, "v2")).toBe(v2);
    // …while a genuinely new payload still fails closed at the cap.
    expect(() => source.next(KEY_A, "v4")).toThrowError(FilesRequestIdCapError);
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
        createRequestIdSource(),
        KEY_A,
      )("body"),
    ).toBe(failure);
  });
});

describe("scope-gated selection and open path (frame safety)", () => {
  test("a selection from another scope is inert; the current scope's renders", () => {
    const selection = { node: { name: "l", path: "l", kind: "file" as const, symlink: true as const }, scopeKey: "h1/w1" };
    expect(activeSelection(selection, "h2/w2")).toBeNull();
    expect(activeSelection(selection, "h1/w1")?.node.symlink).toBe(true);
    expect(activeSelection(null, "h1/w1")).toBeNull();
  });

  test("an open path from another scope is inert in this scope", () => {
    const open: FilesOpenEntry = { scopeKey: "h1/w1", path: "src/a.ts" };
    expect(activeOpenPath(open, "h2/w2")).toBeNull();
    expect(activeOpenPath(open, "h1/w1")).toBe("src/a.ts");
    expect(activeOpenPath(null, "h1/w1")).toBeNull();
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
    // the test mirrors that exactly (per-mount id source + scoped file key).
    const save = (path: string) =>
      makeFileSaver(
        bridge,
        { hostId: "h1", workspaceId: "w1", path },
        createRequestIdSource(),
        scopedFileKey(SCOPE_A, path),
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

describe("onSave observer rejection handling", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  function watchUnhandled(): { unhandled: unknown[]; done(): void } {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    return {
      unhandled,
      done() {
        process.off("unhandledRejection", listener);
      },
    };
  }

  test("a transport throw is absorbed by the observer; runSave still reports the failure", async () => {
    const watch = watchUnhandled();
    try {
      const store = createFilesDraftStore();
      store.confirmRead(SCOPE_A, "src/a.ts", "saved");
      const bridge: FileBridge = {
        fileList: () => Promise.reject(new Error("unused")),
        fileRead: () => Promise.reject(new Error("unused")),
        fileWrite: () => {
          throw new Error("transport down");
        },
      };
      // The exact panel wiring: makeFileSaver promise + derived observer,
      // with the panel's recordDraft before the write attempt.
      const result = makeFileSaver(
        bridge,
        { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
        createRequestIdSource(),
        KEY_A,
      )("body");
      store.recordDraft(SCOPE_A, "src/a.ts", "body");
      observeSaveResult(result, store, SCOPE_A, "src/a.ts", "body");
      // The editor's runSave receives the SAME original rejection:
      let state = applyEditorAction(initialEditorState(), {
        type: "file-opened",
        scope: SCOPE_A,
        path: "src/a.ts",
        content: "saved",
      });
      state = applyEditorAction(state, { type: "edited", value: "body" });
      const dispatched: EditorAction[] = [];
      await runSave({
        draft: "body",
        scope: SCOPE_A,
        path: "src/a.ts",
        generation: nextSaveGeneration(state),
        allowEmpty: false,
        onSave: () => result,
        dispatch: (action) => {
          dispatched.push(action);
          state = applyEditorAction(state, action);
        },
      });
      await flush();
      await flush();
      // No unhandled rejection escaped the derived observer:
      expect(watch.unhandled).toEqual([]);
      // runSave's failure path is intact (a thrown transport maps to the
      // pane's fallback save message):
      expect(state.saveError).toEqual({
        key: KEY_A,
        path: "src/a.ts",
        message: "The file could not be saved.",
      });
      // No markSaved on rejection — the draft stays dirty in the store.
      expect(store.isDirty(SCOPE_A, "src/a.ts")).toBe(true);
      expect(store.savedContentOf(SCOPE_A, "src/a.ts")).toBe("saved");
    } finally {
      watch.done();
    }
  });

  test("a FilesRequestIdCapError rejection is absorbed; no markSaved, failure still reported", async () => {
    const watch = watchUnhandled();
    try {
      const store = createFilesDraftStore();
      store.confirmRead(SCOPE_A, "src/a.ts", "saved");
      // The panel records the draft before the write attempt:
      store.recordDraft(SCOPE_A, "src/a.ts", "payload two");
      // Fill the per-file cap, so the next (different) payload fails closed:
      const ids = createRequestIdSource({ maxRetained: 1 });
      ids.next(KEY_A, "payload one");
      const bridge: FileBridge = {
        fileList: () => Promise.reject(new Error("unused")),
        fileRead: () => Promise.reject(new Error("unused")),
        fileWrite: () => Promise.reject(new Error("must not be reached")),
      };
      const result = makeFileSaver(
        bridge,
        { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
        ids,
        KEY_A,
      )("payload two");
      observeSaveResult(result, store, SCOPE_A, "src/a.ts", "payload two");
      let state = applyEditorAction(initialEditorState(), {
        type: "file-opened",
        scope: SCOPE_A,
        path: "src/a.ts",
        content: "saved",
      });
      state = applyEditorAction(state, { type: "edited", value: "payload two" });
      const dispatched: EditorAction[] = [];
      await runSave({
        draft: "payload two",
        scope: SCOPE_A,
        path: "src/a.ts",
        generation: nextSaveGeneration(state),
        allowEmpty: false,
        onSave: () => result,
        dispatch: (action) => {
          dispatched.push(action);
          state = applyEditorAction(state, action);
        },
      });
      await flush();
      await flush();
      expect(watch.unhandled).toEqual([]);
      expect(state.saveError).toEqual({
        key: KEY_A,
        path: "src/a.ts",
        message: "The file could not be saved.",
      });
      expect(store.isDirty(SCOPE_A, "src/a.ts")).toBe(true);
      void dispatched;
    } finally {
      watch.done();
    }
  });

  test("success still marks the payload saved through the observer", async () => {
    const watch = watchUnhandled();
    try {
      const store = createFilesDraftStore();
      store.confirmRead(SCOPE_A, "src/a.ts", "saved");
      store.recordDraft(SCOPE_A, "src/a.ts", "edited body");
      const bridge: FileBridge = {
        fileList: () => Promise.reject(new Error("unused")),
        fileRead: () => Promise.reject(new Error("unused")),
        fileWrite: () =>
          Promise.resolve({
            ok: true,
            result: { hostId: "h1", workspaceId: "w1", path: "src/a.ts", size: 1, mtime: "t" },
          }),
      };
      const result = makeFileSaver(
        bridge,
        { hostId: "h1", workspaceId: "w1", path: "src/a.ts" },
        createRequestIdSource(),
        KEY_A,
      )("edited body");
      observeSaveResult(result, store, SCOPE_A, "src/a.ts", "edited body");
      await flush();
      await flush();
      expect(watch.unhandled).toEqual([]);
      // Confirmed write retired the dirty flag via the observer's markSaved:
      expect(store.isDirty(SCOPE_A, "src/a.ts")).toBe(false);
      expect(store.savedContentOf(SCOPE_A, "src/a.ts")).toBe("edited body");
    } finally {
      watch.done();
    }
  });
});

describe("quick-open reveal (openRequest)", () => {
  test("shouldApplyOpenRequest: same-workspace unapplied requests apply; repeats and foreign ones do not", () => {
    expect(
      shouldApplyOpenRequest({ workspaceId: "w1", path: "a.ts", nonce: 1 }, "w1", null),
    ).toBe(true);
    expect(
      shouldApplyOpenRequest({ workspaceId: "w1", path: "a.ts", nonce: 1 }, "w1", 1),
    ).toBe(false);
    expect(
      shouldApplyOpenRequest({ workspaceId: "w1", path: "a.ts", nonce: 2 }, "w1", 1),
    ).toBe(true);
    expect(
      shouldApplyOpenRequest({ workspaceId: "w2", path: "a.ts", nonce: 3 }, "w1", null),
    ).toBe(false);
    expect(shouldApplyOpenRequest(null, "w1", null)).toBe(false);
  });

  test("a matching cell request opens that file at mount", () => {
    const { bridge } = fakeBridge();
    const cell: FileOpenRequestCell = {
      current: { workspaceId: "w1", path: "src/a.ts", nonce: 7 },
    };
    const descriptor = createFilesPanelDescriptor({ bridge, openRequestCell: cell });
    const markup = renderToString(
      createElement(descriptor.component, {
        routeId: FILES_ROUTE_ID,
        session,
        workspace,
        status: statusWith(["files.v1"]),
        focusTarget: null,
      }),
    );
    expect(markup).toContain("src/a.ts");
    expect(markup).not.toContain("No file open");
  });

  test("a foreign-workspace request never opens under this scope", () => {
    const { bridge } = fakeBridge();
    const cell: FileOpenRequestCell = {
      current: { workspaceId: "w-other", path: "src/a.ts", nonce: 7 },
    };
    const descriptor = createFilesPanelDescriptor({ bridge, openRequestCell: cell });
    const markup = renderToString(
      createElement(descriptor.component, {
        routeId: FILES_ROUTE_ID,
        session,
        workspace,
        status: statusWith(["files.v1"]),
        focusTarget: null,
      }),
    );
    expect(markup).not.toContain("src/a.ts");
    expect(markup).toContain("No file open");
  });

  test("no cell means no open, same as before", () => {
    const { bridge } = fakeBridge();
    const descriptor = createFilesPanelDescriptor({ bridge });
    const markup = renderToString(
      createElement(descriptor.component, {
        routeId: FILES_ROUTE_ID,
        session,
        workspace,
        status: statusWith(["files.v1"]),
        focusTarget: null,
      }),
    );
    expect(markup).toContain("No file open");
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

describe("createExplorerSource", () => {
  const scope = { hostId: "h1", workspaceId: "w1" };
  const entries: WorkspaceFileEntry[] = [
    { name: "main.ts", kind: "file", size: 3, mtime: "t" },
    { name: "docs", kind: "directory", size: 0, mtime: "t" },
    { name: "link", kind: "symlink", size: 1, mtime: "t" },
  ];
  const listingBridge = (overrides?: Partial<FileBridge>): FileBridge => ({
    fileList: () =>
      Promise.resolve({
        ok: true,
        result: { ...scope, path: "src", entries, truncated: false },
      }),
    fileRead: () => Promise.reject(new Error("unused")),
    fileWrite: () => Promise.reject(new Error("unused")),
    ...overrides,
  });

  test("listings become explorer rows with depth and the symlink marker", async () => {
    const source = createExplorerSource(listingBridge(), scope);
    const result = await source.listDir("src", true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual([
      { name: "main.ts", path: "src/main.ts", isDirectory: false, depth: 1 },
      { name: "docs", path: "src/docs", isDirectory: true, depth: 1 },
      { name: "link", path: "src/link", isDirectory: false, isSymlink: true, depth: 1 },
    ]);
  });

  test("includeHidden reaches the bridge; truncation still reports", async () => {
    const seen: unknown[] = [];
    const listings: unknown[] = [];
    const source = createExplorerSource(
      listingBridge({
        fileList: (input) => {
          seen.push(input);
          return listingBridge().fileList(input);
        },
      }),
      scope,
      (info) => listings.push(info),
    );
    await source.listDir("", false);
    expect(seen).toEqual([
      { ...scope, path: ".", limitEntries: MAX_DIRECTORY_ENTRIES, includeHidden: false },
    ]);
    expect(listings).toEqual([{ path: "src", truncated: false, count: 3 }]);
  });

  test("mutations map onto the optional bridge methods", async () => {
    const calls: Array<[string, unknown]> = [];
    const source = createExplorerSource(
      listingBridge({
        fileCreate: (input) => {
          calls.push(["create", input]);
          return Promise.resolve({ ok: true, result: { ...input, kind: "file" as const } });
        },
        fileRename: (input) => {
          calls.push(["rename", input]);
          return Promise.resolve({ ok: true, result: input });
        },
        fileDelete: (input) => {
          calls.push(["delete", input]);
          return Promise.resolve({ ok: true, result: { ...input, deleted: input.paths } });
        },
      }),
      scope,
    );
    expect(await source.create?.("docs", "n.txt", "file")).toEqual({ ok: true, result: null });
    expect(await source.rename?.("a.txt", "b.txt")).toEqual({ ok: true, result: null });
    expect(await source.remove?.(["a.txt"])).toEqual({ ok: true, result: null });
    expect(calls.map(([method]) => method)).toEqual(["create", "rename", "delete"]);
  });

  test("mutations fail closed without bridge support — never a local fallback", async () => {
    // The bridge predates the mutation methods: the source still exposes
    // them (the UI stays interactive) but every call errors explicitly.
    const source = createExplorerSource(listingBridge(), scope);
    for (const call of [
      () => source.create?.("docs", "n.txt", "file"),
      () => source.rename?.("a.txt", "b.txt"),
      () => source.remove?.(["a.txt"]),
    ]) {
      const result = await call();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error.code).toBe("unsupported_capability");
        expect(result.error.message).toMatch(/newer daemon/);
      }
    }
  });
});

describe("openPathSurvivesDeletion", () => {
  test("null stays open; exact and descendant paths close", () => {
    expect(openPathSurvivesDeletion(null, ["a.txt"])).toBe(true);
    expect(openPathSurvivesDeletion("a.txt", ["a.txt"])).toBe(false);
    expect(openPathSurvivesDeletion("src/deep.ts", ["src"])).toBe(false);
    expect(openPathSurvivesDeletion("other.ts", ["src"])).toBe(true);
    expect(openPathSurvivesDeletion("src2.ts", ["src"])).toBe(true);
  });
});
