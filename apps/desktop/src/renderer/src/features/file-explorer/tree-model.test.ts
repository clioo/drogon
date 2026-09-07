import { describe, expect, test } from "vitest";
import {
  ancestorPaths,
  buildVisibleRows,
  collectLoadedNodes,
  depthOf,
  firstChildIndexOf,
  formatPathsForClipboard,
  getNameFilterTokens,
  indexOfPath,
  isNameFilterQueryTooLarge,
  parentIndexOf,
  pathMatchesNameFilter,
  projectNameFilter,
  splitPathSegments,
  toExplorerNode,
  type ExplorerNode,
} from "./tree-model";
import type { WorkspaceFileNode } from "../workspaces/WorkspaceExplorer";

const dir = (path: string): ExplorerNode => ({
  name: path.split("/").at(-1) ?? path,
  path,
  isDirectory: true,
  depth: depthOf(path),
});
const file = (path: string): ExplorerNode => ({
  name: path.split("/").at(-1) ?? path,
  path,
  isDirectory: false,
  depth: depthOf(path),
});

describe("splitPathSegments and depthOf", () => {
  test("splits on either separator and drops empties", () => {
    expect(splitPathSegments("a/b\\c")).toEqual(["a", "b", "c"]);
    expect(splitPathSegments("/a//b/")).toEqual(["a", "b"]);
  });

  test("top-level entries sit at depth 0", () => {
    expect(depthOf("README.md")).toBe(0);
    expect(depthOf("src/main.ts")).toBe(1);
  });
});

describe("toExplorerNode", () => {
  test("maps listing entries onto rows with depth", () => {
    const entry: WorkspaceFileNode = { name: "main.ts", path: "src/main.ts", kind: "file" };
    expect(toExplorerNode(entry, "src/main.ts")).toEqual({
      name: "main.ts",
      path: "src/main.ts",
      isDirectory: false,
      depth: 1,
    });
  });
});

describe("ancestorPaths", () => {
  test("yields parents nearest-first", () => {
    expect(ancestorPaths("a/b/c")).toEqual(["a/b", "a"]);
    expect(ancestorPaths("top")).toEqual([]);
  });
});

describe("buildVisibleRows", () => {
  const children = {
    "": [dir("src"), file("README.md")],
    src: [file("src/main.ts"), dir("src/nested")],
    "src/nested": [file("src/nested/deep.ts")],
  };
  test("collapses everything by default", () => {
    expect(buildVisibleRows(children, new Set()).map((row) => row.path)).toEqual([
      "src",
      "README.md",
    ]);
  });

  test("expands directories depth-first in listing order", () => {
    expect(
      buildVisibleRows(children, new Set(["src", "src/nested"])).map((row) => row.path),
    ).toEqual(["src", "src/main.ts", "src/nested", "src/nested/deep.ts", "README.md"]);
  });

  test("an expanded directory without loaded children shows no rows", () => {
    expect(buildVisibleRows({ "": [dir("src")] }, new Set(["src"]))).toEqual([dir("src")]);
  });
});

describe("visible-order index helpers", () => {
  const rows = [dir("src"), file("src/main.ts"), file("README.md")];
  test("indexOfPath finds rows and misses cleanly", () => {
    expect(indexOfPath(rows, "src/main.ts")).toBe(1);
    expect(indexOfPath(rows, "missing")).toBeNull();
  });

  test("parentIndexOf climbs to the nearest shallower row", () => {
    expect(parentIndexOf(rows, 1)).toBe(0);
    expect(parentIndexOf(rows, 0)).toBeNull();
    expect(parentIndexOf(rows, 2)).toBeNull();
  });

  test("firstChildIndexOf only fires on expanded-directory children", () => {
    expect(firstChildIndexOf(rows, 0)).toBe(1);
    expect(firstChildIndexOf(rows, 1)).toBeNull();
    expect(firstChildIndexOf(rows, 2)).toBeNull();
  });
});

describe("name filter tokens", () => {
  test("tokenizes case-insensitively on whitespace", () => {
    expect(getNameFilterTokens("  Main  TS ")).toEqual(["main", "ts"]);
    expect(getNameFilterTokens("")).toEqual([]);
  });

  test("oversized queries fail closed with no tokens", () => {
    const big = "x".repeat(2049);
    expect(isNameFilterQueryTooLarge(big)).toBe(true);
    expect(getNameFilterTokens(big)).toEqual([]);
  });

  test("matching requires every token somewhere in the path", () => {
    expect(pathMatchesNameFilter("src/main.ts", ["main", "src"])).toBe(true);
    expect(pathMatchesNameFilter("src/main.ts", ["main", "other"])).toBe(false);
    expect(pathMatchesNameFilter("src/main.ts", [])).toBe(true);
  });
});

describe("projectNameFilter", () => {
  const all = [dir("src"), file("src/main.ts"), file("src/other.ts"), file("README.md")];
  test("returns matches with synthesized ancestors in path order", () => {
    expect(projectNameFilter(all, "main").map((row) => row.path)).toEqual([
      "src",
      "src/main.ts",
    ]);
  });

  test("empty queries project nothing (the tree owns that view)", () => {
    expect(projectNameFilter(all, "   ")).toEqual([]);
  });

  test("dotfiles hide only when asked", () => {
    const withHidden = [...all, file(".env")];
    expect(projectNameFilter(withHidden, "env").map((row) => row.path)).toEqual([".env"]);
    expect(projectNameFilter(withHidden, "env", { showDotfiles: false })).toEqual([]);
  });

  test("collectLoadedNodes flattens the lazy cache", () => {
    expect(
      collectLoadedNodes({ "": [dir("src")], src: [file("src/main.ts")] }),
    ).toEqual([dir("src"), file("src/main.ts")]);
  });
});

describe("formatPathsForClipboard", () => {
  test("joins relative paths and prefixes absolute ones with the root", () => {
    const nodes = [file("a.txt"), file("sub/b.txt")];
    expect(formatPathsForClipboard(nodes, "relative")).toBe("a.txt\nsub/b.txt");
    expect(formatPathsForClipboard(nodes, "absolute", "/root")).toBe(
      "/root/a.txt\n/root/sub/b.txt",
    );
  });
});
