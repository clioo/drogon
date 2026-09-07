import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  WorkspaceExplorer,
  applyExplorerAction,
  initialExplorerState,
  runLoad,
  toggleExpanded,
  visibleRows,
  type ExplorerAction,
  type ExplorerState,
  type WorkspaceExplorerDataSource,
  type WorkspaceFileNode,
} from "./WorkspaceExplorer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const node = (
  path: string,
  kind: WorkspaceFileNode["kind"],
  gitStatus?: WorkspaceFileNode["gitStatus"],
): WorkspaceFileNode => ({
  name: path.split("/").at(-1) ?? path,
  path,
  kind,
  gitStatus,
});

const dir = (path: string): WorkspaceFileNode => node(path, "directory");
const file = (
  path: string,
  gitStatus?: WorkspaceFileNode["gitStatus"],
): WorkspaceFileNode => node(path, "file", gitStatus);

/** Fixture: root contains "src/" (with "main.ts") and "README.md". */
function readyState(): ExplorerState {
  let state = applyExplorerAction(initialExplorerState(), {
    type: "load-started",
  });
  state = applyExplorerAction(state, {
    type: "load-succeeded",
    path: "",
    nodes: [dir("src"), file("README.md")],
  });
  return applyExplorerAction(state, {
    type: "load-succeeded",
    path: "src",
    nodes: [file("src/main.ts", "modified")],
  });
}

describe("toggleExpanded", () => {
  test("expanding adds the directory path; collapsing removes it", () => {
    const expanded = toggleExpanded(new Set(), "src");
    expect(expanded.has("src")).toBe(true);
    const collapsed = toggleExpanded(expanded, "src");
    expect(collapsed.has("src")).toBe(false);
  });

  test("toggling an unexpanded path adds it without disturbing others", () => {
    const next = toggleExpanded(new Set(["a"]), "b");
    expect(next.has("b")).toBe(true);
    expect(next.has("a")).toBe(true);
  });
});

describe("applyExplorerAction", () => {
  test("a root load reaches ready and stores the listing", () => {
    const state = readyState();
    expect(state.status).toBe("ready");
    expect(state.children[""].map((item) => item.path)).toEqual([
      "src",
      "README.md",
    ]);
  });

  test("a subdirectory reply is keyed by its path and never clobbers the root or another directory", () => {
    let state = readyState();
    state = applyExplorerAction(state, {
      type: "load-succeeded",
      path: "docs",
      nodes: [file("docs/a.md")],
    });
    expect(state.children["docs"].map((item) => item.path)).toEqual([
      "docs/a.md",
    ]);
    expect(state.children[""]).toHaveLength(2);
    expect(state.status).toBe("ready");
  });

  test("a failed load enters the error state with the service message", () => {
    const state = applyExplorerAction(initialExplorerState(), {
      type: "load-started",
    });
    const failed = applyExplorerAction(state, {
      type: "load-failed",
      message: "Listing denied",
    });
    expect(failed.status).toBe("error");
    expect(failed.errorMessage).toBe("Listing denied");
  });

  test("lazy directory loads surface a pending marker until their reply lands", () => {
    let state = readyState();
    state = applyExplorerAction(state, { type: "dir-load-started", path: "lib" });
    expect(state.pendingDirs.has("lib")).toBe(true);
    state = applyExplorerAction(state, {
      type: "load-succeeded",
      path: "lib",
      nodes: [],
    });
    expect(state.pendingDirs.has("lib")).toBe(false);
  });

  test("toggling a file row never expands anything", () => {
    const state = readyState();
    const toggled = applyExplorerAction(state, {
      type: "toggled",
      path: "README.md",
      isDirectory: false,
    });
    expect(toggled.expanded).toBe(state.expanded);
  });

  test("selection records the exact row path", () => {
    const state = applyExplorerAction(readyState(), {
      type: "selected",
      path: "src/main.ts",
    });
    expect(state.selectedPath).toBe("src/main.ts");
  });
});

describe("visibleRows", () => {
  test("children of collapsed directories are hidden", () => {
    const rows = visibleRows(readyState());
    expect(rows.map((item) => item.path)).toEqual(["src", "README.md"]);
  });

  test("expanding a directory reveals its children depth-first, with the exact injected node objects", () => {
    let state = readyState();
    state = applyExplorerAction(state, {
      type: "toggled",
      path: "src",
      isDirectory: true,
    });
    const rows = visibleRows(state);
    expect(rows.map((item) => item.path)).toEqual([
      "src",
      "src/main.ts",
      "README.md",
    ]);
    // Selection callbacks receive exactly the node the data source injected.
    const injected = state.children["src"][0];
    expect(rows[1]).toBe(injected);
    expect(rows[1].gitStatus).toBe("modified");
  });

  test("an empty ready workspace projects no rows", () => {
    let state = applyExplorerAction(initialExplorerState(), {
      type: "load-started",
    });
    state = applyExplorerAction(state, { type: "load-succeeded", path: "", nodes: [] });
    expect(state.status).toBe("ready");
    expect(visibleRows(state)).toEqual([]);
  });
});

describe("workspace switch resets cached scope state", () => {
  test("children, expansion, selection and pending markers do not survive a workspace switch", () => {
    let state = readyState();
    state = applyExplorerAction(state, {
      type: "toggled",
      path: "src",
      isDirectory: true,
    });
    state = applyExplorerAction(state, { type: "selected", path: "src/main.ts" });
    state = applyExplorerAction(state, {
      type: "dir-load-started",
      path: "lib",
    });
    expect(state.children["src"]).toBeDefined();
    const switched = applyExplorerAction(state, { type: "workspace-changed" });
    expect(switched.children).toEqual({});
    expect(switched.expanded.size).toBe(0);
    expect(switched.selectedPath).toBe("");
    expect(switched.pendingDirs.size).toBe(0);
    expect(switched.status).toBe("loading");
    // An identical subdir path in the new workspace must not expose the
    // previous workspace's cached children…
    expect(visibleRows(switched, "src")).toEqual([]);
    // …and with no cached entry a re-expand reloads instead of reusing.
    expect(switched.children["src"]).toBeUndefined();
  });
});

describe("runLoad with deferred fakes", () => {
  test("a current reply is dispatched; a reply after a workspace switch is dropped", async () => {
    const dispatched: ExplorerAction[] = [];
    const gate = deferred<{ ok: true; result: WorkspaceFileNode[] }>();
    const source: WorkspaceExplorerDataSource = {
      listDir: () => gate.promise,
    };
    let current = true;
    const pending = runLoad(
      "",
      source,
      () => current,
      (action) => dispatched.push(action),
    );
    expect(dispatched).toEqual([]);
    // The workspace switches mid-flight: the generation guard flips.
    current = false;
    gate.resolve({ ok: true, result: [file("old-root-file.md")] });
    await pending;
    // The stale reply was dropped BEFORE the reducer: nothing dispatched,
    // so the previous workspace's listing can never enter the new cache.
    expect(dispatched).toEqual([]);
  });

  test("a rejected listing promise becomes load-failed, never an unhandled rejection", async () => {
    const dispatched: ExplorerAction[] = [];
    const gate = deferred<never>();
    const source: WorkspaceExplorerDataSource = {
      listDir: () => gate.promise,
    };
    const pending = runLoad(
      "src",
      source,
      () => true,
      (action) => dispatched.push(action),
    );
    gate.reject(new Error("ssh channel closed"));
    await pending;
    expect(dispatched).toEqual([
      { type: "load-failed", message: "ssh channel closed" },
    ]);
  });

  test("a non-Error rejection still surfaces a load-failed message", async () => {
    const dispatched: ExplorerAction[] = [];
    const source: WorkspaceExplorerDataSource = {
      listDir: () => Promise.reject("strings are not errors"),
    };
    await runLoad("", source, () => true, (action) => dispatched.push(action));
    expect(dispatched).toEqual([
      {
        type: "load-failed",
        message: "The directory listing could not be read.",
      },
    ]);
  });

  test("a rejection after a workspace switch is dropped silently", async () => {
    const dispatched: ExplorerAction[] = [];
    const gate = deferred<never>();
    const source: WorkspaceExplorerDataSource = {
      listDir: () => gate.promise,
    };
    let current = true;
    const pending = runLoad(
      "",
      source,
      () => current,
      (action) => dispatched.push(action),
    );
    current = false;
    gate.reject(new Error("late transport death"));
    await pending;
    expect(dispatched).toEqual([]);
  });

  test("mid-flight switch end-to-end: stale reply dropped, new scope's reply applies with no leak", async () => {
    // Scope 1: W1 root load is in flight; the reducer already switched to W2
    // (workspace-changed reset the cache) before W1's reply lands.
    let state: ExplorerState = applyExplorerAction(
      initialExplorerState(),
      { type: "workspace-changed" },
    );
    state = applyExplorerAction(state, {
      type: "load-succeeded",
      path: "",
      nodes: [dir("w2-src")],
    });
    // W1's stale root reply, fenced out by the flipped generation guard:
    const dispatched: ExplorerAction[] = [];
    const gate = deferred<{ ok: true; result: WorkspaceFileNode[] }>();
    const staleSource: WorkspaceExplorerDataSource = {
      listDir: () => gate.promise,
    };
    let current = false; // generation moved on when the scope switched
    const stale = runLoad(
      "",
      staleSource,
      () => current,
      (action) => dispatched.push(action),
    );
    gate.resolve({ ok: true, result: [file("W1-LEAK.md")] });
    await stale;
    expect(dispatched).toEqual([]);
    expect(JSON.stringify(state.children)).not.toContain("W1-LEAK");
    // The new scope's own reply (current guard) applies normally.
    const w2Source: WorkspaceExplorerDataSource = {
      listDir: () =>
        Promise.resolve({ ok: true, result: [file("w2-readme.md")] }),
    };
    await runLoad("w2-src", w2Source, () => true, (action) => {
      dispatched.push(action);
      state = applyExplorerAction(state, action);
    });
    expect(state.children["w2-src"].map((node) => node.path)).toEqual([
      "w2-readme.md",
    ]);
    expect(Object.keys(state.children)).not.toContain("src");
  });
});

describe("WorkspaceExplorer rendering", () => {
  test("with no workspace id it shows the empty state, never a tree", () => {
    const markup = renderToString(
      createElement(WorkspaceExplorer, { workspaceId: "", source: null }),
    );
    expect(markup).toContain("No workspace open");
    expect(markup).not.toContain('role="treeitem"');
  });

  test("with a workspace it starts in the loading state", () => {
    const source: WorkspaceExplorerDataSource = {
      listDir: () =>
        Promise.resolve({
          ok: true,
          result: [] as WorkspaceFileNode[],
        }),
    };
    const markup = renderToString(
      createElement(WorkspaceExplorer, { workspaceId: "w1", source }),
    );
    expect(markup).toContain("Loading workspace files");
    expect(markup).toContain('aria-busy="true"');
  });
});
