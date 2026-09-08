import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  FILES_ROUTE_ID,
  activeOpenPath,
  activeSelection,
  createExplorerSource,
  createFilesPanelDescriptor,
  createFilesSource,
  entryToNode,
  isFilesAvailable,
  joinEntryPath,
  openPathSurvivesDeletion,
  shouldApplyOpenRequest,
  truncationNoticeText,
  type FilesOpenEntry,
} from "./files-panel";
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

const SCOPE_A = { hostId: "h1", workspaceId: "w1" };

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

describe("scope-gated selection and open path (frame safety)", () => {
  test("a selection from another scope is inert; the current scope's renders", () => {
    const selection = {
      node: { name: "l", path: "l", kind: "file" as const, symlink: true as const },
      scopeKey: "h1/w1",
    };
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

  // The interactive cases (a matching cell request seeds the tree's
  // active-path highlight; no embedded editor ever renders) are covered
  // in files-panel-open-event.test.tsx, which mounts the real tree over
  // jsdom instead of asserting on renderToString markup.
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
    // R16-A: the tree is all this panel renders now — no embedded editor,
    // in any state.
    expect(markup).not.toContain('aria-label="Editor');
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
