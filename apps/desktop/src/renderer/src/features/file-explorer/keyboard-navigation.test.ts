// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/right-sidebar/file-explorer-keyboard-navigation.test.ts
// (row fixtures, sample tree and navigation expectations), adapted to the
// local flat-row NavigationProjection interface.
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyNavigation,
  isNavigationKey,
  resolveNavigationTarget,
  type NavigationProjection,
} from "./keyboard-navigation";

type Row = { path: string; isDirectory: boolean; depth: number };

function projection(rows: Row[]): NavigationProjection {
  return {
    getVisibleCount: () => rows.length,
    getRowAtIndex: (index) => rows[index] ?? null,
    getParentIndex: (index) => {
      const current = rows[index];
      if (!current || current.depth <= 0) return null;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (rows[cursor].depth < current.depth) return cursor;
      }
      return null;
    },
    getFirstChildIndex: (index) => {
      const current = rows[index];
      const next = rows[index + 1];
      if (!current?.isDirectory) return null;
      return next && next.depth === current.depth + 1 ? index + 1 : null;
    },
  };
}

const ROWS: Row[] = [
  { path: "src", isDirectory: true, depth: 0 },
  { path: "src/main.ts", isDirectory: false, depth: 1 },
  { path: "README.md", isDirectory: false, depth: 0 },
];

const expanded = (paths: string[]) => (path: string) => paths.includes(path);

describe("isNavigationKey", () => {
  test("admits the tree keys and nothing else", () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
      expect(isNavigationKey(key)).toBe(true);
    }
    expect(isNavigationKey("Enter")).toBe(false);
    expect(isNavigationKey("a")).toBe(false);
  });
});

describe("resolveNavigationTarget", () => {
  const rows = projection(ROWS);
  test("an empty tree is a no-op", () => {
    expect(
      resolveNavigationTarget({
        key: "ArrowDown",
        currentIndex: null,
        rowProjection: projection([]),
        total: 0,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "no-op" });
  });

  test("a null index anchors to the first or last row", () => {
    expect(
      resolveNavigationTarget({
        key: "ArrowDown",
        currentIndex: null,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "move", targetIndex: 0 });
    expect(
      resolveNavigationTarget({
        key: "ArrowUp",
        currentIndex: null,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "move", targetIndex: 2 });
    expect(
      resolveNavigationTarget({
        key: "ArrowLeft",
        currentIndex: null,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "unhandled" });
  });

  test("vertical moves clamp at the edges", () => {
    const at = (currentIndex: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End") =>
      resolveNavigationTarget({ key, currentIndex, rowProjection: rows, total: 3, isExpanded: expanded([]) });
    expect(at(0, "ArrowUp")).toEqual({ type: "move", targetIndex: 0 });
    expect(at(2, "ArrowDown")).toEqual({ type: "move", targetIndex: 2 });
    expect(at(1, "ArrowDown")).toEqual({ type: "move", targetIndex: 2 });
    expect(at(2, "Home")).toEqual({ type: "move", targetIndex: 0 });
    expect(at(0, "End")).toEqual({ type: "move", targetIndex: 2 });
  });

  test("pages jump a tenth of the list", () => {
    const many = projection(ROWS.concat(ROWS).concat(ROWS).concat(ROWS));
    expect(
      resolveNavigationTarget({
        key: "PageDown",
        currentIndex: 0,
        rowProjection: many,
        total: 12,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "move", targetIndex: 1 });
  });

  test("ArrowRight expands a collapsed folder, then steps into it", () => {
    const collapsed = resolveNavigationTarget({
      key: "ArrowRight",
      currentIndex: 0,
      rowProjection: rows,
      total: 3,
      isExpanded: expanded([]),
    });
    expect(collapsed).toEqual({ type: "toggle-expand", currentIndex: 0, dirPath: "src" });
    expect(
      resolveNavigationTarget({
        key: "ArrowRight",
        currentIndex: 0,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded(["src"]),
      }),
    ).toEqual({ type: "move", targetIndex: 1 });
  });

  test("ArrowRight on a file stays put", () => {
    expect(
      resolveNavigationTarget({
        key: "ArrowRight",
        currentIndex: 1,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded(["src"]),
      }),
    ).toEqual({ type: "move", targetIndex: 1 });
  });

  test("ArrowLeft collapses an expanded folder, then steps to the parent", () => {
    expect(
      resolveNavigationTarget({
        key: "ArrowLeft",
        currentIndex: 0,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded(["src"]),
      }),
    ).toEqual({ type: "toggle-collapse", currentIndex: 0, dirPath: "src" });
    expect(
      resolveNavigationTarget({
        key: "ArrowLeft",
        currentIndex: 1,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "move", targetIndex: 0 });
    expect(
      resolveNavigationTarget({
        key: "ArrowLeft",
        currentIndex: 2,
        rowProjection: rows,
        total: 3,
        isExpanded: expanded([]),
      }),
    ).toEqual({ type: "no-op" });
  });
});

describe("applyNavigation", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 0;
    });
  });

  const keyEvent = (key: string, extra?: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      key,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...extra,
    }) as KeyboardEvent;

  test("modifier-held and unhandled keys pass through", () => {
    const rows = projection(ROWS);
    const ctx = {
      rowProjection: rows,
      selectedPath: "src",
      isExpanded: expanded([]),
      findFocusedIndex: () => 0,
      indexOfSelected: () => 0,
      handlers: {
        moveSelection: () => {
          throw new Error("must not move");
        },
        toggleDir: () => {
          throw new Error("must not toggle");
        },
        scrollToIndex: () => {},
        focusRowAtIndex: () => {},
      },
    };
    expect(applyNavigation(ctx, keyEvent("ArrowDown", { metaKey: true }))).toBe(false);
    expect(applyNavigation(ctx, keyEvent("Enter"))).toBe(false);
  });

  test("a bare arrow moves the selection and focuses the row", () => {
    const rows = projection(ROWS);
    const moved: string[] = [];
    const focused: number[] = [];
    const handled = applyNavigation(
      {
        rowProjection: rows,
        selectedPath: "src",
        isExpanded: expanded([]),
        findFocusedIndex: () => 0,
        indexOfSelected: () => 0,
        handlers: {
          moveSelection: (path, mode) => moved.push(`${mode}:${path}`),
          toggleDir: () => {},
          scrollToIndex: () => {},
          focusRowAtIndex: (index) => focused.push(index),
        },
      },
      keyEvent("ArrowDown"),
    );
    expect(handled).toBe(true);
    expect(moved).toEqual(["replace:src/main.ts"]);
    expect(focused).toEqual([1]);
  });

  test("Shift+arrow extends as a range; Left on an expanded dir toggles", () => {
    const rows = projection(ROWS);
    const moved: string[] = [];
    const toggled: string[] = [];
    expect(
      applyNavigation(
        {
          rowProjection: rows,
          selectedPath: "src",
          isExpanded: expanded(["src"]),
          findFocusedIndex: () => 0,
          indexOfSelected: () => 0,
          handlers: {
            moveSelection: (path, mode) => moved.push(`${mode}:${path}`),
            toggleDir: (dir) => toggled.push(dir),
            scrollToIndex: () => {},
            focusRowAtIndex: () => {},
          },
        },
        keyEvent("ArrowDown", { shiftKey: true }),
      ),
    ).toBe(true);
    expect(moved).toEqual(["range:src/main.ts"]);
    expect(
      applyNavigation(
        {
          rowProjection: rows,
          selectedPath: "src",
          isExpanded: expanded(["src"]),
          findFocusedIndex: () => 0,
          indexOfSelected: () => 0,
          handlers: {
            moveSelection: (path, mode) => moved.push(`${mode}:${path}`),
            toggleDir: (dir) => toggled.push(dir),
            scrollToIndex: () => {},
            focusRowAtIndex: () => {},
          },
        },
        keyEvent("ArrowLeft"),
      ),
    ).toBe(true);
    expect(toggled).toEqual(["src"]);
  });
});
