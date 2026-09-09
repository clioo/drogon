// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's use-workspace-kanban-drawer-lingering.test.tsx and
   WorkspaceKanbanSearchField.test.tsx at pinned source c9790628
   (clioo/drogon-orca), plus new coverage for the ported column-resize and
   native-drag hooks (source covers them via its virtualized board suites).
   happy-dom was swapped for jsdom (Drogon's environment). */
import React, { act } from "react";
import { renderHook } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceKanbanDrawerLingering } from "./use-kanban-drawer-lingering";
import WorkspaceKanbanSearchField, {
  overlayReserve,
} from "./WorkspaceKanbanSearchField";
import { useWorkspaceKanbanColumnResize } from "./use-kanban-column-resize";
import { useWorkspaceKanbanNativeDrag } from "./use-kanban-native-drag";
import { writeWorkspaceDragData } from "./drag-data";
import {
  WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
  WORKSPACE_BOARD_COLUMN_WIDTH_MIN,
} from "./workspace-status";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("workspace board close linger", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps drawer state through the close animation, then releases it at 300 ms", () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) => useWorkspaceKanbanDrawerLingering(open),
      { initialProps: { open: true } },
    );
    act(() => rerender({ open: false }));
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    unmount();
  });

  it("cancels the pending release when reopened", () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) => useWorkspaceKanbanDrawerLingering(open),
      { initialProps: { open: true } },
    );
    act(() => rerender({ open: false }));
    act(() => vi.advanceTimersByTime(299));
    act(() => rerender({ open: true }));
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    unmount();
  });
});

let container: HTMLDivElement;
let root: Root;
const onQueryChange = vi.fn();
const onClear = vi.fn();
const onClose = vi.fn();

function renderField(props: {
  query: string;
  isFiltering?: boolean;
  isTooLarge?: boolean;
  matchCount?: number;
  totalCount?: number;
}): void {
  act(() => {
    root.render(
      <WorkspaceKanbanSearchField
        query={props.query}
        isFiltering={props.isFiltering ?? props.query.trim() !== ""}
        isTooLarge={props.isTooLarge ?? false}
        matchCount={props.matchCount ?? 0}
        totalCount={props.totalCount ?? 0}
        onQueryChange={onQueryChange}
        onClear={onClear}
        onClose={onClose}
      />,
    );
  });
}

function input(): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>("input");
  if (!element) {
    throw new Error("field not rendered");
  }
  return element;
}

function clearButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Clear search"]',
  );
}

function liveRegion(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!element) {
    throw new Error("live region not rendered");
  }
  return element;
}

describe("WorkspaceKanbanSearchField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reports every keystroke without debouncing", () => {
    renderField({ query: "" });

    act(() => {
      // Why: React's value tracker shadows the `value` property, so a plain
      // assignment would look like a no-op and never fire onChange.
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input(), "or");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalledWith("or");
  });

  it("only offers the clear affordance for a non-empty query", () => {
    renderField({ query: "" });
    expect(clearButton()).toBeNull();

    renderField({ query: "orca", matchCount: 3, totalCount: 12 });
    act(() => {
      clearButton()?.click();
    });

    expect(onClear).toHaveBeenCalledOnce();
  });

  it("hides the visual match count from assistive tech but keeps the clear button named", () => {
    renderField({ query: "orca", matchCount: 3, totalCount: 12 });

    const count = container.querySelector('span[aria-hidden="true"]');
    expect(count?.textContent).toBe("3 / 12");
    expect(clearButton()?.getAttribute("aria-hidden")).toBeNull();
    expect(clearButton()?.getAttribute("aria-label")).toBe("Clear search");
  });

  it("withholds counts for text that never narrows the board", () => {
    renderField({
      query: "   ",
      isFiltering: false,
      matchCount: 12,
      totalCount: 12,
    });

    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(clearButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(liveRegion().textContent).toBe("");
  });

  it("announces match counts only after the query settles", () => {
    renderField({ query: "orca", matchCount: 3, totalCount: 12 });
    expect(liveRegion().textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(liveRegion().textContent).toBe("3 of 12 workspaces match");

    renderField({ query: "zzz", matchCount: 0, totalCount: 12 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(liveRegion().textContent).toBe("No workspaces match");

    renderField({ query: "" });
    expect(liveRegion().textContent).toBe("");
  });

  it("clears a non-empty query on Escape and closes the board on an empty one", () => {
    // Why: useWorkspaceBoardPanel's Escape listener is capture-phase on
    // document, so it runs before this handler and stopPropagation cannot
    // reach it. The panel defers to board text fields instead, which makes
    // this field solely responsible for both Escape outcomes.
    renderField({ query: "orca", matchCount: 3, totalCount: 12 });

    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    renderField({ query: "" });
    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says so when a query was discarded for length instead of silently not filtering", () => {
    // Why: an over-bound query and a query that matched everything look
    // identical — full field, untouched board — without this.
    renderField({
      query: "x".repeat(3000),
      isFiltering: false,
      isTooLarge: true,
    });

    expect(container.textContent).toContain("Too long");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(liveRegion().textContent).toContain("too long");

    renderField({ query: "orca", matchCount: 3, totalCount: 12 });
    expect(container.textContent).not.toContain("Too long");
    expect(input().getAttribute("aria-invalid")).toBeNull();
  });

  it("leaves Escape to the IME while a composition is in progress", () => {
    renderField({ query: "検索", matchCount: 1, totalCount: 12 });

    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onClear).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps focus in the field after the clear button unmounts itself", () => {
    renderField({ query: "orca", matchCount: 3, totalCount: 12 });
    act(() => {
      input().focus();
      clearButton()?.click();
    });

    expect(onClear).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
  });

  it("reserves overlay width in font-relative units, capped so text stays visible", () => {
    // '298 / 1024' is 10 characters; a fixed reserve would let it overlap.
    expect(overlayReserve("298 / 1024")).toContain("10ch");
    expect(overlayReserve("3 / 9")).toContain("5ch");

    // Capped, so a wide counter in a narrow drawer cannot squeeze the typed
    // text to nothing — overlapping is the better failure at that size.
    expect(overlayReserve("298 / 1024")).toContain("55%");

    // No overlay means only the clear button needs clearing.
    expect(overlayReserve(null)).toBe("32px");
  });
});

describe("useWorkspaceKanbanColumnResize", () => {
  it("clamps the committed width and follows external width changes", () => {
    const onCommit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ width }: { width: number }) =>
        useWorkspaceKanbanColumnResize(width, onCommit),
      { initialProps: { width: 10 } },
    );
    expect(result.current.columnWidth).toBe(WORKSPACE_BOARD_COLUMN_WIDTH_MIN);

    act(() => rerender({ width: 400 }));
    expect(result.current.columnWidth).toBe(400);
    expect(onCommit).not.toHaveBeenCalled();
    unmount();
  });

  it("steps the width with the keyboard and commits the new value", () => {
    const onCommit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ width }: { width: number }) =>
        useWorkspaceKanbanColumnResize(width, onCommit),
      { initialProps: { width: 300 } },
    );

    act(() => {
      result.current.onColumnResizeKeyDown({
        key: "ArrowRight",
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      } as React.KeyboardEvent<HTMLElement>);
    });
    expect(onCommit).toHaveBeenCalledWith(320);
    // The committed prop stays authoritative outside an active drag (the real
    // caller persists it and passes it back), so the draft follows it.
    act(() => rerender({ width: 320 }));
    expect(result.current.columnWidth).toBe(320);

    act(() => {
      result.current.onColumnResizeKeyDown({
        key: "ArrowLeft",
        shiftKey: true,
        preventDefault() {},
        stopPropagation() {},
      } as React.KeyboardEvent<HTMLElement>);
    });
    // Shift doubles the source's 20px step.
    expect(onCommit).toHaveBeenLastCalledWith(280);
    unmount();
  });

  it("ignores keys other than the horizontal arrows", () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWorkspaceKanbanColumnResize(300, onCommit),
    );
    act(() => {
      result.current.onColumnResizeKeyDown({
        key: "ArrowUp",
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      } as React.KeyboardEvent<HTMLElement>);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.columnWidth).toBe(300);
    unmount();
  });

  it("drags from the pointer down position and stops on pointer up", async () => {
    const onCommit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ width }: { width: number }) =>
        useWorkspaceKanbanColumnResize(width, onCommit),
      { initialProps: { width: 300 } },
    );

    act(() => {
      result.current.onColumnResizeStart({
        button: 0,
        clientX: 100,
        preventDefault() {},
        stopPropagation() {},
      } as React.PointerEvent<HTMLElement>);
    });
    expect(result.current.isResizingColumn).toBe(true);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 160 }));
    });
    // The draft publishes on the next animation frame (source behavior).
    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    });
    // The live draft is authoritative while the drag is active.
    expect(result.current.columnWidth).toBe(360);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(result.current.isResizingColumn).toBe(false);
    expect(onCommit).toHaveBeenCalledWith(360);
    expect(document.body.style.cursor).toBe("");
    unmount();
  });

  it("clamps a drag at the board width bounds", () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWorkspaceKanbanColumnResize(
        WORKSPACE_BOARD_COLUMN_WIDTH_MAX,
        onCommit,
      ),
    );

    act(() => {
      result.current.onColumnResizeStart({
        button: 0,
        clientX: 0,
        preventDefault() {},
        stopPropagation() {},
      } as React.PointerEvent<HTMLElement>);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 1000 }));
    });
    expect(result.current.columnWidth).toBe(WORKSPACE_BOARD_COLUMN_WIDTH_MAX);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    unmount();
  });
});

describe("useWorkspaceKanbanNativeDrag", () => {
  function makeDataTransfer(): DataTransfer {
    const store = new Map<string, string>();
    const types: string[] = [];
    const transfer = {
      effectAllowed: "uninitialized",
      dropEffect: "none",
      files: [],
      items: [],
      types,
      setData(type: string, value: string) {
        store.set(type, value);
        types.length = 0;
        for (const key of store.keys()) types.push(key);
      },
      getData(type: string) {
        return store.get(type) ?? "";
      },
      clearData() {
        store.clear();
        types.length = 0;
      },
      setDragImage() {},
    };
    return transfer as unknown as DataTransfer;
  }

  it("only reacts to drops carrying workspace drag data", () => {
    const dropWorktrees = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWorkspaceKanbanNativeDrag(dropWorktrees),
    );

    const transfer = makeDataTransfer();
    const emptyDrop = {
      dataTransfer: makeDataTransfer(),
      preventDefault() {},
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleDrop(emptyDrop, "todo");
    });
    expect(dropWorktrees).not.toHaveBeenCalled();

    writeWorkspaceDragData(transfer, ["a", "b"]);
    const drop = {
      dataTransfer: transfer,
      preventDefault() {},
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleDrop(drop, "doing");
    });
    expect(dropWorktrees).toHaveBeenCalledWith(["a", "b"], "doing");
    expect(result.current.dragOverStatus).toBeNull();
    unmount();
  });

  it("tracks the hovered lane and clears it when the pointer truly leaves", () => {
    const { result, unmount } = renderHook(() =>
      useWorkspaceKanbanNativeDrag(vi.fn()),
    );

    const transferOver = makeDataTransfer();
    writeWorkspaceDragData(transferOver, "a");
    const over = {
      dataTransfer: transferOver,
      preventDefault() {},
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleDragOver(over, "todo");
    });
    expect(result.current.dragOverStatus).toBe("todo");

    // A related target inside the same element is not a leave.
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.appendChild(child);
    const innerLeave = {
      relatedTarget: child,
      currentTarget: parent,
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleDragLeave(innerLeave);
    });
    expect(result.current.dragOverStatus).toBe("todo");

    const outerLeave = {
      relatedTarget: null,
      currentTarget: parent,
    } as unknown as React.DragEvent;
    act(() => {
      result.current.handleDragLeave(outerLeave);
    });
    expect(result.current.dragOverStatus).toBeNull();
    unmount();
  });

  it("tracks pin-drop hover separately and finishes both on drag finish", () => {
    const { result, unmount } = renderHook(() =>
      useWorkspaceKanbanNativeDrag(vi.fn()),
    );
    const transfer = makeDataTransfer();
    writeWorkspaceDragData(transfer, "a");
    const over = {
      dataTransfer: transfer,
      preventDefault() {},
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handleDragOver(over, "todo");
      result.current.handlePinDragOver(over);
    });
    expect(result.current.dragOverStatus).toBe("todo");
    expect(result.current.pinDragOver).toBe(true);

    act(() => {
      result.current.handleDragFinish();
    });
    expect(result.current.dragOverStatus).toBeNull();
    expect(result.current.pinDragOver).toBe(false);
    unmount();
  });
});

afterEach(cleanup);
