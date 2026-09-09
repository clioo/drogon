// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Behavioral tests for the manual-order primitives ported from Orca's
   worktree-manual-order.ts / worktree-manual-order-ranks.ts /
   worktree-manual-order-catalog.ts at pinned source c9790628
   (clioo/drogon-orca). The source covers these through its pointer-drag
   suites (not part of this slice); these cases pin the same semantics:
   multi-drag removal/insertion math, cross-lane drops, retained order,
   sparse neighbor ranks and the fallback re-index. */
import { describe, expect, it } from "vitest";
import {
  buildManualOrderUpdatesForGroupDrop,
  moveWorktreeIdsWithinGroup,
  shouldWriteManualOrderForGroupDrop,
  type WorktreeDragGroup,
} from "./manual-order";
import { buildSparseManualOrderUpdates } from "./manual-order-ranks";
import { buildWorktreeManualOrderCatalog } from "./manual-order-catalog";
import { worktree } from "./test-fixtures";

describe("moveWorktreeIdsWithinGroup", () => {
  it("moves a single id to the drop index", () => {
    expect(moveWorktreeIdsWithinGroup(["a", "b", "c", "d"], ["b"], 0)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(moveWorktreeIdsWithinGroup(["a", "b", "c", "d"], ["b"], 3)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("keeps multi-drag order and removes dragged ids before computing the slot", () => {
    expect(
      moveWorktreeIdsWithinGroup(["a", "b", "c", "d", "e"], ["b", "d"], 4),
    ).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("dedupes dragged ids and ignores ids outside the group", () => {
    // dropIndex 2 minus the dragged id before it = insert at 1 => unchanged.
    expect(
      moveWorktreeIdsWithinGroup(["a", "b", "c"], ["b", "b", "x"], 2),
    ).toEqual(["a", "b", "c"]);
    expect(
      moveWorktreeIdsWithinGroup(["a", "b", "c"], ["b", "b", "x"], 3),
    ).toEqual(["a", "c", "b"]);
  });

  it("clamps an out-of-range drop index", () => {
    expect(moveWorktreeIdsWithinGroup(["a", "b"], ["a"], 99)).toEqual([
      "b",
      "a",
    ]);
    expect(moveWorktreeIdsWithinGroup(["a", "b"], ["b"], -5)).toEqual([
      "b",
      "a",
    ]);
  });

  it("returns the group unchanged for empty inputs", () => {
    expect(moveWorktreeIdsWithinGroup([], ["a"], 0)).toEqual([]);
    expect(moveWorktreeIdsWithinGroup(["a"], [], 0)).toEqual(["a"]);
  });
});

describe("buildManualOrderUpdatesForGroupDrop", () => {
  const groups: WorktreeDragGroup[] = [
    { key: "todo", worktreeIds: ["a", "b", "c"] },
    { key: "doing", worktreeIds: ["d", "e"] },
  ];

  it("moves ids across lanes and removes them from their source lane", () => {
    const result = buildManualOrderUpdatesForGroupDrop({
      groups,
      targetGroupKey: "doing",
      draggedIds: ["a"],
      dropIndex: 1,
      now: 1000,
      allWorktreeIds: ["a", "b", "c", "d", "e"],
    });

    expect(result.changed).toBe(true);
    // Insert slot 1 in the target lane, dragged ids removed from their lane.
    expect(result.orderedIds).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("is unchanged when a drop does not move anything", () => {
    const result = buildManualOrderUpdatesForGroupDrop({
      groups,
      targetGroupKey: "todo",
      draggedIds: ["b"],
      dropIndex: 1,
      now: 1000,
      allWorktreeIds: ["a", "b", "c", "d", "e"],
    });

    expect(result.changed).toBe(false);
    expect(result.updates.size).toBe(0);
  });

  it("retains the relative order of untouched rows in the updates", () => {
    const result = buildManualOrderUpdatesForGroupDrop({
      groups,
      targetGroupKey: "doing",
      draggedIds: ["c"],
      dropIndex: 2,
      now: 5000,
      allWorktreeIds: ["a", "b", "c", "d", "e"],
    });

    expect(result.orderedIds).toEqual(["a", "b", "d", "e", "c"]);
    // Sparse-rank path: untouched rows with known ranks keep theirs.
    const moved = result.updates.get("c");
    expect(typeof moved?.manualOrder).toBe("number");
  });

  it("writes fallback ranks for every row when ranks are missing", () => {
    const result = buildManualOrderUpdatesForGroupDrop({
      groups,
      targetGroupKey: "doing",
      draggedIds: ["a"],
      dropIndex: 2,
      now: 100000,
      allWorktreeIds: ["a", "b", "c", "d", "e"],
    });

    // No rankByWorktreeId supplied -> full materialization of the visible order.
    expect(result.updates.size).toBe(result.orderedIds.length);
    const ranks = result.orderedIds.map(
      (id) => result.updates.get(id)!.manualOrder,
    );
    for (let index = 1; index < ranks.length; index++) {
      expect(ranks[index - 1]!).toBeGreaterThan(ranks[index]!);
    }
  });
});

describe("buildSparseManualOrderUpdates", () => {
  const rankByWorktreeId = new Map([
    ["a", 10000],
    ["b", 9000],
    ["c", 8000],
    ["d", 7000],
  ]);

  it("interpolates a moved id between its neighbors' ranks", () => {
    // Move b between c and d: ranks 8000..7000 -> b lands strictly between.
    const result = buildSparseManualOrderUpdates({
      orderedIds: ["a", "c", "b", "d"],
      movedIds: ["b"],
      rankByWorktreeId,
      allWorktreeIds: ["a", "b", "c", "d"],
      now: 12345,
    });

    const rank = result.get("b")!.manualOrder;
    expect(rank).toBeLessThan(8000);
    expect(rank).toBeGreaterThan(7000);
    expect(result.size).toBe(1);
  });

  it("materializes the whole known order when any row lacks a rank", () => {
    const partialRanks = new Map([
      ["a", 10000],
      ["b", 9000],
    ]);
    const result = buildSparseManualOrderUpdates({
      orderedIds: ["a", "b", "c", "d"],
      movedIds: ["c"],
      rankByWorktreeId: partialRanks,
      allWorktreeIds: ["a", "b", "c", "d"],
      now: 100000,
    });

    expect(result.size).toBe(4);
    const ranks = ["a", "b", "c", "d"].map((id) => result.get(id)!.manualOrder);
    for (let index = 1; index < ranks.length; index++) {
      expect(ranks[index - 1]!).toBeGreaterThan(ranks[index]!);
    }
  });

  it("re-indexes when a dense insert exhausts the numeric gap", () => {
    const denseRanks = new Map([
      ["a", 30],
      ["b", 29],
      ["c", 28],
    ]);
    const result = buildSparseManualOrderUpdates({
      orderedIds: ["a", "x", "b", "c"],
      movedIds: ["x"],
      rankByWorktreeId: new Map([...denseRanks, ["x", 10]]),
      allWorktreeIds: ["a", "b", "c", "x"],
      now: 100000,
    });

    expect(result.size).toBe(4);
  });

  it("returns no updates when nothing moved", () => {
    const result = buildSparseManualOrderUpdates({
      orderedIds: ["a", "b"],
      movedIds: [],
      rankByWorktreeId,
      allWorktreeIds: ["a", "b"],
      now: 1000,
    });

    expect(result.size).toBe(0);
  });
});

describe("shouldWriteManualOrderForGroupDrop", () => {
  it("always writes under Manual sort", () => {
    expect(
      shouldWriteManualOrderForGroupDrop({
        sortBy: "manual",
        sourceGroupKeys: ["todo"],
        targetGroupKey: "doing",
      }),
    ).toBe(true);
  });

  it("under other sorts writes only for same-lane reorders", () => {
    expect(
      shouldWriteManualOrderForGroupDrop({
        sortBy: "recent",
        sourceGroupKeys: ["todo"],
        targetGroupKey: "todo",
      }),
    ).toBe(true);
    expect(
      shouldWriteManualOrderForGroupDrop({
        sortBy: "recent",
        sourceGroupKeys: ["todo"],
        targetGroupKey: "doing",
      }),
    ).toBe(false);
    expect(
      shouldWriteManualOrderForGroupDrop({
        sortBy: "recent",
        sourceGroupKeys: [],
        targetGroupKey: "todo",
      }),
    ).toBe(false);
  });
});

describe("buildWorktreeManualOrderCatalog", () => {
  it("orders by manualOrder desc then display name and dedupes ranks by id", () => {
    const rows = [
      worktree("a", { displayName: "Alpha", manualOrder: 100 }),
      worktree("b", { displayName: "Bravo", manualOrder: 300 }),
      worktree("c", { displayName: "Charlie", manualOrder: 100 }),
      worktree("d", { displayName: "Delta" }),
    ];
    const catalog = buildWorktreeManualOrderCatalog({ worktrees: rows });

    expect(catalog.orderedIds).toEqual(["b", "a", "c", "d"]);
    expect(catalog.rankByWorktreeId.get("a")).toBe(100);
    expect(catalog.rankByWorktreeId.get("c")).toBe(100);
    expect(catalog.rankByWorktreeId.has("d")).toBe(false);
  });

  it("keeps one rank per id when two hosts share an id with equal ranks", () => {
    const rows = [
      worktree("shared", { hostId: "local", manualOrder: 200 }),
      worktree("shared", { hostId: "ssh:box", manualOrder: 200 }),
    ];
    const catalog = buildWorktreeManualOrderCatalog({ worktrees: rows });

    expect(catalog.orderedIds).toEqual(["shared"]);
    expect(catalog.rankByWorktreeId.get("shared")).toBe(200);
  });
});
