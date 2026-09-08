// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  commitWorktreeCardDragDrop,
  moveWorktreeIdsWithinGroup,
} from "./worktree-card-drag-commit";
import { isWorktreeCardDragBlocked } from "./worktree-card-drag-contract";
import {
  computeWorktreeCardDropSlot,
  getWorktreeCardDragGrab,
  getWorktreeCardDragReferenceY,
  getWorktreeCardDropAnchorId,
  indicatorYForHeldDropIndex,
  resolveWorktreeCardDropAnchorIndex,
  shouldReevaluateWorktreeCardDropAnchor,
} from "./worktree-card-drag-drop";

describe("moveWorktreeIdsWithinGroup", () => {
  it("moves a card forward past later cards", () => {
    expect(moveWorktreeIdsWithinGroup(["w1", "w2", "w3"], ["w1"], 3)).toEqual([
      "w2",
      "w3",
      "w1",
    ]);
  });

  it("moves a card backward before earlier cards", () => {
    expect(moveWorktreeIdsWithinGroup(["w1", "w2", "w3"], ["w3"], 0)).toEqual([
      "w3",
      "w1",
      "w2",
    ]);
  });

  it("clamps out-of-range drop indices and ignores unknown ids", () => {
    expect(moveWorktreeIdsWithinGroup(["w1", "w2"], ["w2"], 99)).toEqual([
      "w1",
      "w2",
    ]);
    expect(moveWorktreeIdsWithinGroup(["w1", "w2"], ["gone"], 0)).toEqual([
      "w1",
      "w2",
    ]);
    expect(moveWorktreeIdsWithinGroup([], ["w1"], 0)).toEqual([]);
  });
});

describe("commitWorktreeCardDragDrop", () => {
  function session(worktreeId: string, sidebarCardIds: string[]) {
    return {
      worktreeId,
      projectId: "p",
      sidebarCardIds,
      pointerId: 1,
      cardRects: [],
      sourceRow: null as unknown as HTMLElement,
      startX: 0,
      startY: 0,
      latestPointerX: 0,
      latestPointerY: 0,
      promoted: true,
      preview: null,
      previewOffsetX: 0,
      previewOffsetY: 0,
      dropAnchorId: null,
    };
  }

  it("reorders within the full card order", () => {
    const commits: string[][] = [];
    commitWorktreeCardDragDrop({
      session: session("w1", ["w1", "w2", "w3"]),
      sidebarDropIndex: 3,
      fullCardIds: ["w1", "w2", "w3"],
      onCommitWorktreeOrder: (next) => commits.push(next),
    });
    expect(commits).toEqual([["w2", "w3", "w1"]]);
  });

  it("maps a filtered drop index into the full order", () => {
    const commits: string[][] = [];
    commitWorktreeCardDragDrop({
      session: session("w3", ["w1", "w3"]),
      sidebarDropIndex: 0,
      fullCardIds: ["w1", "w2", "w3"],
      onCommitWorktreeOrder: (next) => commits.push(next),
    });
    expect(commits).toEqual([["w3", "w1", "w2"]]);
  });

  it("ignores the slots bordering the dragged card", () => {
    const commits: string[][] = [];
    const push = (next: string[]) => commits.push(next);
    commitWorktreeCardDragDrop({
      session: session("w2", ["w1", "w2", "w3"]),
      sidebarDropIndex: 1,
      fullCardIds: ["w1", "w2", "w3"],
      onCommitWorktreeOrder: push,
    });
    commitWorktreeCardDragDrop({
      session: session("w2", ["w1", "w2", "w3"]),
      sidebarDropIndex: 2,
      fullCardIds: ["w1", "w2", "w3"],
      onCommitWorktreeOrder: push,
    });
    expect(commits).toEqual([]);
  });
});

describe("isWorktreeCardDragBlocked", () => {
  function card(): {
    row: HTMLElement;
    select: HTMLElement;
    kebab: HTMLElement;
    input: HTMLElement;
  } {
    const row = document.createElement("div");
    const select = document.createElement("button");
    select.className = "shell-worktree-card-select";
    const title = document.createElement("span");
    const input = document.createElement("input");
    select.append(title, input);
    const kebab = document.createElement("button");
    kebab.setAttribute("aria-label", "Worktree actions");
    row.append(select, kebab);
    document.body.appendChild(row);
    return { row, select, kebab, input };
  }

  it("allows grabs on the select surface but blocks real controls", () => {
    const { row, select, kebab, input } = card();
    try {
      expect(
        isWorktreeCardDragBlocked(select.querySelector("span"), row),
      ).toBe(false);
      expect(isWorktreeCardDragBlocked(select, row)).toBe(false);
      expect(isWorktreeCardDragBlocked(kebab, row)).toBe(true);
      expect(isWorktreeCardDragBlocked(input, row)).toBe(true);
    } finally {
      row.remove();
    }
  });
});

describe("worktree card drop geometry", () => {
  const rects = [
    { worktreeId: "w1", cardIndex: 0, top: 0, bottom: 40 },
    { worktreeId: "w2", cardIndex: 1, top: 48, bottom: 88 },
  ];
  const cardIds = ["w1", "w2"];

  it("projects the grab point to the card center", () => {
    expect(
      getWorktreeCardDragReferenceY({
        localY: 100,
        grab: { offsetY: 30, height: 40 },
        activeHeight: 0,
      }),
    ).toBe(90);
    expect(
      getWorktreeCardDragReferenceY({ localY: 100, grab: null, activeHeight: 0 }),
    ).toBe(100);
  });

  it("rejects degenerate grabs", () => {
    expect(getWorktreeCardDragGrab({ offsetY: 5, height: 0 })).toBeNull();
    expect(getWorktreeCardDragGrab({ offsetY: 5, height: 40 })).toEqual({
      offsetY: 5,
      height: 40,
    });
  });

  it("splits a hovered card at its midpoint", () => {
    expect(
      computeWorktreeCardDropSlot({
        localY: 10,
        scrollTop: 0,
        rects,
        cardIds,
        cardCount: 2,
      }),
    ).toEqual({ dropIndex: 0, dropIndicatorY: 0, dropAnchorId: "w1" });
    expect(
      computeWorktreeCardDropSlot({
        localY: 60,
        scrollTop: 0,
        rects,
        cardIds,
        cardCount: 2,
      }),
    ).toEqual({ dropIndex: 1, dropIndicatorY: 44, dropAnchorId: "w2" });
  });

  it("holds the anchor decision across sub-pixel jitter", () => {
    const anchor = { beforeWorktreeId: "w2", pointerY: 60, scrollTop: 0 };
    expect(
      shouldReevaluateWorktreeCardDropAnchor({
        anchor,
        pointerY: 60.2,
        scrollTop: 0,
      }),
    ).toBe(false);
    expect(
      shouldReevaluateWorktreeCardDropAnchor({
        anchor,
        pointerY: 62,
        scrollTop: 0,
      }),
    ).toBe(true);
    expect(
      resolveWorktreeCardDropAnchorIndex({ anchor, cardIds }),
    ).toBe(1);
    expect(getWorktreeCardDropAnchorId({ cardIds, dropIndex: 2 })).toBeNull();
  });

  it("re-derives the held line from live rects", () => {
    expect(
      indicatorYForHeldDropIndex({ rects, dropIndex: 1, scrollTop: 0 }),
    ).toBe(44);
    expect(
      indicatorYForHeldDropIndex({ rects, dropIndex: 2, scrollTop: 0 }),
    ).toBe(92);
    expect(
      indicatorYForHeldDropIndex({ rects: [], dropIndex: 0, scrollTop: 0 }),
    ).toBeNull();
  });
});
