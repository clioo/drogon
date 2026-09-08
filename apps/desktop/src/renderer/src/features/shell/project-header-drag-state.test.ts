// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectHeaderDrag } from "./project-header-drag";

function fireWindow(type: string, init: Record<string, unknown>): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  window.dispatchEvent(event);
}

describe("useProjectHeaderDrag state machine", () => {
  it("promotes past the threshold, previews the drop, and commits on pointerup", () => {
    window.requestAnimationFrame = (() => 0) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as unknown as typeof window.cancelAnimationFrame;

    const scroll = document.createElement("div");
    scroll.className = "shell-sidebar-scroll";
    // jsdom has no layout: fake the scroller geometry the drop math needs.
    Object.defineProperty(scroll, "scrollTop", { value: 0 });
    Object.defineProperty(scroll, "scrollHeight", { value: 400 });
    Object.defineProperty(scroll, "clientHeight", { value: 400 });
    document.body.appendChild(scroll);
    try {
      for (const [id, index] of [["a", "0"], ["b", "1"]] as const) {
        const header = document.createElement("div");
        header.setAttribute("data-project-header-id", id);
        header.setAttribute("data-project-header-index", index);
        header.setAttribute("data-project-header-drag-handle", "");
        scroll.appendChild(header);
      }
      const headerA = scroll.children[0] as HTMLElement;
      const onCommitProjectOrder = vi.fn();

      const { result } = renderHook(() =>
        useProjectHeaderDrag({
          allProjectIds: ["a", "b"],
          visibleProjectIds: ["a", "b"],
          knownProjectIds: new Set(["a", "b"]),
          onCommitProjectOrder,
          getScrollContainer: () => scroll,
        }),
      );

      act(() => {
        result.current.onHandlePointerDown(
          {
            button: 0,
            pointerId: 5,
            clientX: 10,
            clientY: 10,
            target: headerA,
            currentTarget: headerA,
          } as unknown as React.PointerEvent<HTMLElement>,
          "a",
        );
      });
      // Below the threshold: armed but not promoted.
      act(() => {
        fireWindow("pointermove", { pointerId: 5, clientX: 11, clientY: 11 });
      });
      expect(result.current.state.draggingProjectId).toBeNull();

      // Past the threshold: promoted with a trailing-edge preview.
      act(() => {
        fireWindow("pointermove", { pointerId: 5, clientX: 10, clientY: 50 });
      });
      expect(result.current.state).toEqual({
        draggingProjectId: "a",
        dropIndex: 2,
        dropIndicatorY: 3,
      });

      // Release commits the visible drop into the full order.
      act(() => {
        fireWindow("pointerup", { pointerId: 5, clientX: 10, clientY: 50 });
      });
      expect(onCommitProjectOrder).toHaveBeenCalledWith(["b", "a"]);
      expect(result.current.state.draggingProjectId).toBeNull();
    } finally {
      scroll.remove();
    }
  });

  it("cancels on Escape without committing", () => {
    window.requestAnimationFrame = (() => 0) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as unknown as typeof window.cancelAnimationFrame;

    const scroll = document.createElement("div");
    scroll.className = "shell-sidebar-scroll";
    document.body.appendChild(scroll);
    try {
      for (const [id, index] of [["a", "0"], ["b", "1"]] as const) {
        const header = document.createElement("div");
        header.setAttribute("data-project-header-id", id);
        header.setAttribute("data-project-header-index", index);
        header.setAttribute("data-project-header-drag-handle", "");
        scroll.appendChild(header);
      }
      const headerA = scroll.children[0] as HTMLElement;
      const onCommitProjectOrder = vi.fn();

      const { result } = renderHook(() =>
        useProjectHeaderDrag({
          allProjectIds: ["a", "b"],
          visibleProjectIds: ["a", "b"],
          knownProjectIds: new Set(["a", "b"]),
          onCommitProjectOrder,
          getScrollContainer: () => scroll,
        }),
      );

      act(() => {
        result.current.onHandlePointerDown(
          {
            button: 0,
            pointerId: 5,
            clientX: 10,
            clientY: 10,
            target: headerA,
            currentTarget: headerA,
          } as unknown as React.PointerEvent<HTMLElement>,
          "a",
        );
      });
      act(() => {
        fireWindow("pointermove", { pointerId: 5, clientX: 10, clientY: 50 });
      });
      expect(result.current.state.draggingProjectId).toBe("a");

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Escape" });
        window.dispatchEvent(event);
      });
      expect(onCommitProjectOrder).not.toHaveBeenCalled();
      expect(result.current.state.draggingProjectId).toBeNull();
    } finally {
      scroll.remove();
    }
  });
});
