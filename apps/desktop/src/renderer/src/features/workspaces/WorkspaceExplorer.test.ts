import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  WorkspaceExplorer,
  applyExplorerAction,
  initialExplorerState,
  toggleExpanded,
  visibleRows,
  type ExplorerState,
  type WorkspaceExplorerDataSource,
  type WorkspaceFileNode,
} from "./WorkspaceExplorer";

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
