// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/sidebar/project-group-header-drag-start.test.ts
// (arming on the row and on svg content, rejecting presses outside the
// handle, buttons/inputs as actions), adapted to the flat project list.
import { describe, expect, it } from "vitest";
import {
  isProjectHeaderActionTarget,
  isProjectHeaderDragHandleTarget,
} from "./project-header-drag-contract";
import { createProjectHeaderDragSession } from "./project-header-drag-start";
import { commitProjectHeaderDragDrop } from "./project-header-drag-commit";

function row(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-project-header-drag-handle", "");
  document.body.appendChild(element);
  return element;
}

function pointerEvent(
  currentTarget: HTMLElement,
  target: EventTarget | null,
  overrides: Record<string, unknown> = {},
): React.PointerEvent<HTMLElement> {
  return {
    button: 0,
    pointerId: 7,
    clientX: 10,
    clientY: 20,
    target,
    currentTarget,
    ...overrides,
  } as unknown as React.PointerEvent<HTMLElement>;
}

describe("isProjectHeaderDragHandleTarget", () => {
  it("arms on the row and on svg content inside it", () => {
    const handle = row();
    try {
      expect(isProjectHeaderDragHandleTarget(handle, handle)).toBe(true);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      handle.appendChild(svg);
      expect(isProjectHeaderDragHandleTarget(svg, handle)).toBe(true);
    } finally {
      handle.remove();
    }
  });

  it("rejects presses outside the handle", () => {
    const handle = row();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    try {
      expect(isProjectHeaderDragHandleTarget(outside, handle)).toBe(false);
      expect(isProjectHeaderDragHandleTarget(null, handle)).toBe(false);
    } finally {
      handle.remove();
      outside.remove();
    }
  });
});

describe("isProjectHeaderActionTarget", () => {
  it("treats buttons and inputs as actions, plain spans as drag surface", () => {
    const handle = row();
    try {
      const button = document.createElement("button");
      const label = document.createElement("span");
      handle.append(button, label);
      expect(isProjectHeaderActionTarget(button, handle)).toBe(true);
      expect(isProjectHeaderActionTarget(label, handle)).toBe(false);
      expect(isProjectHeaderActionTarget(handle, handle)).toBe(false);
    } finally {
      handle.remove();
    }
  });
});

describe("createProjectHeaderDragSession", () => {
  const known = new Set(["a", "b"]);
  const visible = ["a", "b"];
  const scroll = () => document.createElement("div");

  it("arms a session for a left-button press on the handle", () => {
    const handle = row();
    try {
      const session = createProjectHeaderDragSession({
        event: pointerEvent(handle, handle),
        projectId: "a",
        knownProjectIds: known,
        visibleProjectIds: visible,
        getScrollContainer: scroll,
      });
      expect(session).toMatchObject({
        projectId: "a",
        pointerId: 7,
        promoted: false,
      });
    } finally {
      handle.remove();
    }
  });

  it("refuses right-clicks, action targets, unknown and single projects", () => {
    const handle = row();
    const button = document.createElement("button");
    handle.appendChild(button);
    try {
      const base = {
        projectId: "a",
        knownProjectIds: known,
        visibleProjectIds: visible,
        getScrollContainer: scroll,
      };
      expect(
        createProjectHeaderDragSession({
          ...base,
          event: pointerEvent(handle, handle, { button: 2 }),
        }),
      ).toBeNull();
      expect(
        createProjectHeaderDragSession({
          ...base,
          event: pointerEvent(handle, button),
        }),
      ).toBeNull();
      expect(
        createProjectHeaderDragSession({
          ...base,
          projectId: "gone",
          event: pointerEvent(handle, handle),
        }),
      ).toBeNull();
      expect(
        createProjectHeaderDragSession({
          ...base,
          visibleProjectIds: ["a"],
          event: pointerEvent(handle, handle),
        }),
      ).toBeNull();
      expect(
        createProjectHeaderDragSession({
          ...base,
          getScrollContainer: () => null,
          event: pointerEvent(handle, handle),
        }),
      ).toBeNull();
    } finally {
      handle.remove();
    }
  });
});

describe("commitProjectHeaderDragDrop", () => {
  function session(projectId: string, sidebarProjectHeaderIds: string[]) {
    return {
      projectId,
      sidebarProjectHeaderIds,
      pointerId: 1,
      headerRects: [],
      handleEl: document.createElement("div"),
      startX: 0,
      startY: 0,
      latestPointerY: 0,
      promoted: true,
    };
  }

  it("commits a visible drop index into the full order", () => {
    const commits: string[][] = [];
    commitProjectHeaderDragDrop({
      session: session("c", ["b", "c"]),
      sidebarDropIndex: 0,
      allProjectIds: ["a", "b", "c", "d"],
      onCommitProjectOrder: (next) => commits.push(next),
    });
    expect(commits).toEqual([["a", "c", "b", "d"]]);
  });

  it("ignores the slots bordering the dragged header", () => {
    const commits: string[][] = [];
    const push = (next: string[]) => commits.push(next);
    commitProjectHeaderDragDrop({
      session: session("b", ["a", "b", "c"]),
      sidebarDropIndex: 1,
      allProjectIds: ["a", "b", "c"],
      onCommitProjectOrder: push,
    });
    commitProjectHeaderDragDrop({
      session: session("b", ["a", "b", "c"]),
      sidebarDropIndex: 2,
      allProjectIds: ["a", "b", "c"],
      onCommitProjectOrder: push,
    });
    expect(commits).toEqual([]);
  });
});
