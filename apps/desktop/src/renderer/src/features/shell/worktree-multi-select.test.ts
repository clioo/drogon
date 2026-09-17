/* MIT Copyright (c) 2026 Lovecast Inc.
   The sidebar multi-selection gesture rules: Cmd/Ctrl toggles, Shift
   ranges from the held anchor, a plain click collapses the selection, and
   a right-click outside the selection can never leave cards selected that
   the user is not pointing at. */
import { describe, expect, test } from "vitest";
import {
  applyWorktreeSelectionClick,
  bulkTargetIds,
  EMPTY_WORKTREE_SELECTION,
  formatWorktreeSelectionSummary,
  isWorktreeSelectionGesture,
  pruneWorktreeSelection,
  selectionForContextMenu,
  worktreeSelectionModifiers,
} from "./worktree-multi-select";

const order = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

describe("worktreeSelectionModifiers", () => {
  test("reads Cmd (macOS) and Ctrl as the toggle modifier", () => {
    expect(worktreeSelectionModifiers({ metaKey: true })).toEqual({
      toggle: true,
      range: false,
    });
    expect(worktreeSelectionModifiers({ ctrlKey: true })).toEqual({
      toggle: true,
      range: false,
    });
    expect(worktreeSelectionModifiers({ shiftKey: true })).toEqual({
      toggle: false,
      range: true,
    });
    expect(worktreeSelectionModifiers({})).toEqual({
      toggle: false,
      range: false,
    });
  });

  test("only a modified click carries a selection intent", () => {
    expect(isWorktreeSelectionGesture(plain)).toBe(false);
    expect(isWorktreeSelectionGesture(toggle)).toBe(true);
    expect(isWorktreeSelectionGesture(range)).toBe(true);
  });
});

describe("applyWorktreeSelectionClick", () => {
  test("Cmd+click adds cards and keeps them in rendered order", () => {
    let selection = applyWorktreeSelectionClick({
      selection: EMPTY_WORKTREE_SELECTION,
      worktreeId: "d",
      modifiers: toggle,
      order,
    });
    selection = applyWorktreeSelectionClick({
      selection,
      worktreeId: "b",
      modifiers: toggle,
      order,
    });
    expect(selection.ids).toEqual(["b", "d"]);
    expect(selection.anchorId).toBe("b");
  });

  test("Cmd+click on a selected card removes it", () => {
    const selection = applyWorktreeSelectionClick({
      selection: { ids: ["a", "b", "c"], anchorId: "c" },
      worktreeId: "b",
      modifiers: toggle,
      order,
    });
    expect(selection.ids).toEqual(["a", "c"]);
  });

  test("removing the last selected card clears the anchor too", () => {
    const selection = applyWorktreeSelectionClick({
      selection: { ids: ["a"], anchorId: "a" },
      worktreeId: "a",
      modifiers: toggle,
      order,
    });
    expect(selection).toEqual(EMPTY_WORKTREE_SELECTION);
  });

  test("Shift+click selects the inclusive span from the anchor", () => {
    const selection = applyWorktreeSelectionClick({
      selection: { ids: ["b"], anchorId: "b" },
      worktreeId: "d",
      modifiers: range,
      order,
    });
    expect(selection.ids).toEqual(["b", "c", "d"]);
    expect(selection.anchorId).toBe("b");
  });

  test("Shift+click upwards spans the same range", () => {
    const selection = applyWorktreeSelectionClick({
      selection: { ids: ["d"], anchorId: "d" },
      worktreeId: "b",
      modifiers: range,
      order,
    });
    expect(selection.ids).toEqual(["b", "c", "d"]);
  });

  test("a second Shift+click re-measures from the held anchor, never walking it", () => {
    const first = applyWorktreeSelectionClick({
      selection: { ids: ["b"], anchorId: "b" },
      worktreeId: "e",
      modifiers: range,
      order,
    });
    const second = applyWorktreeSelectionClick({
      selection: first,
      worktreeId: "c",
      modifiers: range,
      order,
    });
    expect(second.ids).toEqual(["b", "c"]);
  });

  test("Shift+click without a usable anchor starts a single-card selection", () => {
    expect(
      applyWorktreeSelectionClick({
        selection: EMPTY_WORKTREE_SELECTION,
        worktreeId: "c",
        modifiers: range,
        order,
      }),
    ).toEqual({ ids: ["c"], anchorId: "c" });
    expect(
      applyWorktreeSelectionClick({
        selection: { ids: ["gone"], anchorId: "gone" },
        worktreeId: "c",
        modifiers: range,
        order,
      }),
    ).toEqual({ ids: ["c"], anchorId: "c" });
  });

  test("a plain click clears the selection", () => {
    expect(
      applyWorktreeSelectionClick({
        selection: { ids: ["a", "b"], anchorId: "b" },
        worktreeId: "c",
        modifiers: plain,
        order,
      }),
    ).toEqual(EMPTY_WORKTREE_SELECTION);
  });
});

describe("context menu targeting", () => {
  test("a right-click inside the selection keeps it", () => {
    const selection = { ids: ["a", "b"], anchorId: "b" };
    expect(selectionForContextMenu({ selection, worktreeId: "a" })).toBe(
      selection,
    );
  });

  test("a right-click outside the selection collapses it", () => {
    expect(
      selectionForContextMenu({
        selection: { ids: ["a", "b"], anchorId: "b" },
        worktreeId: "c",
      }),
    ).toEqual(EMPTY_WORKTREE_SELECTION);
  });

  test("bulk targets need two or more selected cards, including this one", () => {
    expect(
      bulkTargetIds({ selection: { ids: ["a"], anchorId: "a" }, worktreeId: "a" }),
    ).toBeNull();
    expect(
      bulkTargetIds({
        selection: { ids: ["a", "b"], anchorId: "b" },
        worktreeId: "c",
      }),
    ).toBeNull();
    expect(
      bulkTargetIds({
        selection: { ids: ["a", "b"], anchorId: "b" },
        worktreeId: "b",
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("pruneWorktreeSelection", () => {
  test("drops ids that no longer exist and rescues the anchor", () => {
    const pruned = pruneWorktreeSelection(
      { ids: ["a", "b", "c"], anchorId: "c" },
      ["a", "b"],
    );
    expect(pruned.ids).toEqual(["a", "b"]);
    expect(pruned.anchorId).toBe("b");
  });

  test("returns the same object when nothing changed (no render churn)", () => {
    const selection = { ids: ["a"], anchorId: "a" };
    expect(pruneWorktreeSelection(selection, ["a", "b"])).toBe(selection);
  });
});

describe("formatWorktreeSelectionSummary", () => {
  test("counts workspaces and stays silent at zero", () => {
    expect(formatWorktreeSelectionSummary(0)).toBe("");
    expect(formatWorktreeSelectionSummary(1)).toBe("1 workspace selected");
    expect(formatWorktreeSelectionSummary(4)).toBe("4 workspaces selected");
  });
});
