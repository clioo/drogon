// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's src/renderer/src/components/sidebar/
   use-workspace-kanban-selection.test.tsx and
   use-workspace-kanban-outside-dismiss.test.ts at pinned source c9790628
   (clioo/drogon-orca). Adapted to Drogon fixtures and jsdom; toggle-click
   modifiers are passed explicitly instead of reading the host UA. Re-renders
   reuse one hook instance (renderHook) exactly like the source's persistent
   root, so selection state survives between renders. */
import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
} from "./host-identity";
import { useWorkspaceKanbanSelection } from "./use-kanban-selection";
import { isWorkspaceBoardKeepOpenTarget } from "./use-kanban-outside-dismiss";
import { worktree } from "./test-fixtures";

type Row = ReturnType<typeof worktree>;

const alpha = worktree("alpha");
const beta = worktree("beta");
const gamma = worktree("gamma");
const delta = worktree("delta");
const fullBoard = [alpha, beta, gamma, delta];

function gesture(
  worktreeId: string,
  modifiers: { shiftKey?: boolean; toggle?: boolean },
) {
  const identity = worktreeId.includes("|")
    ? worktreeId
    : `local|${worktreeId}`;
  const isMac = navigator.userAgent.includes("Mac");
  act(() => {
    selection.result.current.updateSelectionForGesture(
      {
        metaKey: modifiers.toggle ? isMac : false,
        ctrlKey: modifiers.toggle ? !isMac : false,
        shiftKey: modifiers.shiftKey ?? false,
      } as React.MouseEvent<HTMLElement>,
      identity,
    );
  });
}

function click(worktreeId: string, shiftKey = false): void {
  gesture(worktreeId, { shiftKey });
}

function toggleClick(worktreeId: string): void {
  gesture(worktreeId, { toggle: true });
}

function selectedIds(): string[] {
  return [...selection.result.current.selectedWorktreeIds]
    .map(getWorktreeIdFromHostIdentity)
    .sort();
}

let selection: {
  result: { current: ReturnType<typeof useWorkspaceKanbanSelection> };
  rerender: (props: {
    board: readonly Row[];
    rendered: readonly Row[];
  }) => void;
  unmount: () => void;
};

function renderSelection(
  rendered: readonly Row[] = fullBoard,
  board: readonly Row[] = fullBoard,
) {
  const hook = renderHook(
    ({
      board,
      rendered,
    }: {
      board: readonly Row[];
      rendered: readonly Row[];
    }) => useWorkspaceKanbanSelection(true, board, rendered),
    { initialProps: { board, rendered } },
  );
  selection = {
    result: hook.result,
    rerender: hook.rerender,
    unmount: hook.unmount,
  };
  return selection;
}

afterEach(() => {
  selection?.unmount();
  cleanup();
});

describe("useWorkspaceKanbanSelection", () => {
  it("ranges across the whole board when nothing is filtered", () => {
    renderSelection();

    click(alpha.id);
    click(gamma.id, true);

    expect(selectedIds()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("never ranges through cards a search has hidden", () => {
    renderSelection([alpha, gamma]);

    click(alpha.id);
    click(gamma.id, true);

    expect(selectedIds()).toEqual(["alpha", "gamma"]);
  });

  it("keeps a hidden card selected so clearing the search restores the selection", () => {
    renderSelection();
    click(alpha.id);
    click(beta.id, true);
    expect(selectedIds()).toEqual(["alpha", "beta"]);

    selection.rerender({ board: fullBoard, rendered: [alpha] });
    expect(selectedIds()).toEqual(["alpha", "beta"]);

    selection.rerender({ board: fullBoard, rendered: fullBoard });
    expect(selectedIds()).toEqual(["alpha", "beta"]);
  });

  it("extends the range from a visible card when a search hides the anchor", () => {
    // Anchor lands on delta, then a query hides only delta.
    renderSelection();
    click(alpha.id);
    toggleClick(beta.id);
    toggleClick(delta.id);
    expect(selectedIds()).toEqual(["alpha", "beta", "delta"]);

    selection.rerender({ board: fullBoard, rendered: [alpha, beta, gamma] });
    click(gamma.id, true);

    // Without a rendered anchor this collapsed to just gamma, dropping the
    // still-visible alpha and beta along with it.
    expect(selectedIds()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("replaces a hidden selection on every replace-shaped gesture alike", () => {
    // Why: a range, a plain click and a non-additive marquee all mean "replace".
    // If a range alone carried hidden cards through, the user would be left with
    // a selection they cannot see, count, or narrow.
    renderSelection();
    click(delta.id);
    toggleClick(alpha.id);
    expect(selectedIds()).toEqual(["alpha", "delta"]);

    selection.rerender({ board: fullBoard, rendered: [alpha, beta, gamma] });
    click(gamma.id, true);

    expect(selectedIds()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("lets a plain click clear a selection the search is hiding", () => {
    renderSelection();
    click(alpha.id);
    toggleClick(delta.id);

    selection.rerender({ board: fullBoard, rendered: [alpha, beta, gamma] });
    click(beta.id);

    expect(selectedIds()).toEqual(["beta"]);
  });

  it("still prunes ids that leave the board entirely", () => {
    renderSelection();
    click(alpha.id);
    click(gamma.id, true);

    const remaining = [alpha, beta];
    selection.rerender({ board: remaining, rendered: remaining });

    expect(selectedIds()).toEqual(["alpha", "beta"]);
  });

  it("selects same-id cards independently by host", () => {
    const local = worktree("shared");
    const remote = worktree("shared", { hostId: "ssh:host-b" });
    renderSelection([local, remote], [local, remote]);

    click(getWorktreeHostIdentity(local));
    expect([...selection.result.current.selectedWorktreeIds]).toEqual([
      getWorktreeHostIdentity(local),
    ]);
    expect(selection.result.current.selectedWorktrees).toEqual([local]);

    toggleClick(getWorktreeHostIdentity(remote));
    expect(selection.result.current.selectedWorktreeIds).toEqual(
      new Set([
        getWorktreeHostIdentity(local),
        getWorktreeHostIdentity(remote),
      ]),
    );
    expect(selection.result.current.selectedWorktrees).toEqual([local, remote]);
  });

  it("clears the selection for the caller", () => {
    renderSelection();
    click(alpha.id);
    act(() => selection.result.current.clearSelection());
    expect(selectedIds()).toEqual([]);
    expect(selection.result.current.selectionAnchorId).toBeNull();
  });

  it("narrows a multi-selection to the context target for menus", () => {
    renderSelection();
    click(alpha.id);
    toggleClick(gamma.id);
    expect(selection.result.current.selectedWorktreeIds.size).toBe(2);

    let scoped: readonly Row[] = [];
    act(() => {
      scoped = selection.result.current.selectForContextMenu(
        {} as React.MouseEvent<HTMLElement>,
        beta,
      );
    });
    expect(scoped.map((row) => row.id)).toEqual(["beta"]);
    expect(selectedIds()).toEqual(["beta"]);
  });
});

class FakeNode {
  parentElement: FakeElement | null = null;
}

class FakeElement extends FakeNode {
  private readonly attributes: ReadonlySet<string>;

  constructor(
    attributes: readonly string[] = [],
    parentElement: FakeElement | null = null,
  ) {
    super();
    this.attributes = new Set(attributes);
    this.parentElement = parentElement;
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  private matches(selector: string): boolean {
    return selector
      .split(",")
      .map((part) => part.trim())
      .some((part) => this.attributes.has(part));
  }
}

describe("workspace kanban outside dismiss keep-open targets", () => {
  beforeEach(() => {
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("Element", FakeElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the board open when a Sonner toast action is clicked", () => {
    const toast = new FakeElement(["[data-sonner-toast]"]);
    const action = new FakeElement([], toast);

    expect(
      isWorkspaceBoardKeepOpenTarget(action as unknown as EventTarget),
    ).toBe(true);
  });

  it("keeps the board open when the contextual tour panel is clicked", () => {
    const panel = new FakeElement(["[data-contextual-tour-panel]"]);
    const nextButton = new FakeElement([], panel);

    expect(
      isWorkspaceBoardKeepOpenTarget(nextButton as unknown as EventTarget),
    ).toBe(true);
  });

  it("keeps the board open for Radix menu and dialog content", () => {
    const menu = new FakeElement(['[data-slot="dropdown-menu-content"]']);
    const item = new FakeElement([], menu);
    expect(isWorkspaceBoardKeepOpenTarget(item as unknown as EventTarget)).toBe(
      true,
    );

    const dialog = new FakeElement(['[data-slot="dialog-content"]']);
    expect(
      isWorkspaceBoardKeepOpenTarget(dialog as unknown as EventTarget),
    ).toBe(true);
  });

  it("does not keep the board open for generic outside content", () => {
    const target = new FakeElement();

    expect(
      isWorkspaceBoardKeepOpenTarget(target as unknown as EventTarget),
    ).toBe(false);
  });
});
