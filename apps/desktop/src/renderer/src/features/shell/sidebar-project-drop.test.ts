// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  computeProjectHeaderDropPreview,
  getSidebarDragAutoscroll,
  measureProjectHeaderDragRects,
} from "./sidebar-project-drop";

function rect(top: number, bottom: number, projectId = "p", headerIndex = 0) {
  return { projectId, headerIndex, top, bottom };
}

function container(top = 0, scrollTop = 0, scrollHeight = 1000): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ top, left: 0, right: 200, bottom: top + 400 }) as DOMRect;
  Object.defineProperty(element, "scrollTop", { value: scrollTop });
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { value: 400 });
  return element;
}

function header(
  host: HTMLElement,
  projectId: string,
  index: number,
  top: number,
  height: number,
): void {
  const element = document.createElement("div");
  element.setAttribute("data-project-header-id", projectId);
  element.setAttribute("data-project-header-index", String(index));
  const hostRect = host.getBoundingClientRect();
  element.getBoundingClientRect = () =>
    ({ top: hostRect.top + top, height } as DOMRect);
  host.appendChild(element);
}

describe("measureProjectHeaderDragRects", () => {
  it("reads header ids and indices in container coordinates, sorted by top", () => {
    const host = container(100, 50);
    document.body.appendChild(host);
    try {
      header(host, "b", 1, 160, 30);
      header(host, "a", 0, 60, 30);
      const malformed = document.createElement("div");
      malformed.setAttribute("data-project-header-id", "broken");
      host.appendChild(malformed);
      const rects = measureProjectHeaderDragRects(host);
      expect(rects).toEqual([
        { projectId: "a", headerIndex: 0, top: 110, bottom: 140 },
        { projectId: "b", headerIndex: 1, top: 210, bottom: 240 },
      ]);
    } finally {
      host.remove();
    }
  });
});

describe("computeProjectHeaderDropPreview", () => {
  const rects = [
    rect(0, 30, "a", 0),
    rect(60, 90, "b", 1),
    rect(120, 150, "c", 2),
  ];

  it("returns null without headers", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 10,
        containerTop: 0,
        scrollTop: 0,
        rects: [],
        headerCount: 0,
      }),
    ).toBeNull();
  });

  it("splits a hovered header at its midpoint", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 10,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
      }),
    ).toEqual({ dropIndex: 0, dropIndicatorY: 0 });
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 20,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
      }),
    ).toEqual({ dropIndex: 1, dropIndicatorY: 56 });
  });

  it("snaps an interior gap to the nearer boundary slot", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 45,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
      }),
    ).toEqual({ dropIndex: 1, dropIndicatorY: 56 });
  });

  it("offers the trailing edge slot inside the edge zone", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 160,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
      }),
    ).toEqual({ dropIndex: 3, dropIndicatorY: 153 });
  });

  it("returns null far outside the list and below the content end", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 500,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
      }),
    ).toBeNull();
    expect(
      computeProjectHeaderDropPreview({
        pointerY: 160,
        containerTop: 0,
        scrollTop: 0,
        rects,
        headerCount: 3,
        contentBottom: 100,
      }),
    ).toBeNull();
  });

  it("floors the indicator at the scroll top", () => {
    expect(
      computeProjectHeaderDropPreview({
        pointerY: -190,
        containerTop: 0,
        scrollTop: 200,
        rects,
        headerCount: 3,
      }),
    ).toEqual({ dropIndex: 0, dropIndicatorY: 200 });
  });
});

describe("getSidebarDragAutoscroll", () => {
  const rect = { left: 0, right: 200, top: 100, bottom: 500 };

  it("scrolls down near the bottom edge and up near the top edge", () => {
    const down = getSidebarDragAutoscroll({
      point: { clientX: 50, clientY: 490 },
      containerRect: rect,
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 400,
      elapsedMs: 16,
    });
    expect(down).not.toBeNull();
    expect(down!.scrollTop).toBeGreaterThan(0);
    const up = getSidebarDragAutoscroll({
      point: { clientX: 50, clientY: 110 },
      containerRect: rect,
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 400,
      elapsedMs: 16,
    });
    expect(up).not.toBeNull();
    expect(up!.scrollTop).toBeLessThan(100);
  });

  it("stays put mid-list, outside the column, or without overflow", () => {
    const mid = { clientX: 50, clientY: 300 };
    expect(
      getSidebarDragAutoscroll({
        point: mid,
        containerRect: rect,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
        elapsedMs: 16,
      }),
    ).toBeNull();
    expect(
      getSidebarDragAutoscroll({
        point: { clientX: 500, clientY: 490 },
        containerRect: rect,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
        elapsedMs: 16,
      }),
    ).toBeNull();
    expect(
      getSidebarDragAutoscroll({
        point: mid,
        containerRect: rect,
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: 400,
        elapsedMs: 16,
      }),
    ).toBeNull();
  });
});
