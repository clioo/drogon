// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-link-action-request.test.ts
// and terminal-link-pointer-gesture.test.ts (focused subset): the popover
// request policy — plain clicks request, direct/modifier clicks open, drags
// and selections never do, and dismissal only closes its own request.
import { describe, expect, it, vi } from "vitest";

import {
  closeTerminalLinkActionRequest,
  requestTerminalLinkAction,
  type TerminalLinkActionContext,
  type TerminalLinkActionRequest,
} from "./terminal-link-action-request";
import {
  installTerminalLinkPointerGesture,
} from "./terminal-link-pointer-gesture";
import { isTerminalLinkActionActivation } from "./terminal-link-activation";

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    clientX: 12,
    clientY: 34,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent;
}

function fakeGesture(canRequestAction = true) {
  return { canRequestAction: () => canRequestAction, dispose: () => {} };
}

function context(
  overrides: Partial<TerminalLinkActionContext> = {},
): TerminalLinkActionContext {
  return {
    paneId: 1,
    pointerGesture: fakeGesture(),
    claimPtyMouse: () => true,
    request: vi.fn(),
    focusTerminal: () => {},
    ...overrides,
  };
}

function details() {
  return {
    destination: "/tmp/work/src/app.ts",
    kind: "file" as const,
    primary: { label: "Open file", run: () => {} },
    alternate: { label: "Open in Finder", run: () => {} },
  };
}

describe("terminal link action activation gate", () => {
  it("requests only on plain left clicks", () => {
    expect(isTerminalLinkActionActivation(mouseEvent())).toBe(true);
    expect(
      isTerminalLinkActionActivation(mouseEvent({ metaKey: true })),
    ).toBe(false);
    expect(
      isTerminalLinkActionActivation(mouseEvent({ ctrlKey: true })),
    ).toBe(false);
    expect(
      isTerminalLinkActionActivation(mouseEvent({ shiftKey: true })),
    ).toBe(false);
    expect(isTerminalLinkActionActivation(mouseEvent({ altKey: true }))).toBe(
      false,
    );
    expect(isTerminalLinkActionActivation(undefined)).toBe(false);
  });
});

describe("requestTerminalLinkAction", () => {
  it("requests the popover with the pointer anchor and prevents default", () => {
    const actionContext = context();
    const event = mouseEvent();
    const handled = requestTerminalLinkAction(event, actionContext, details());
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(actionContext.request).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: 1,
        anchorX: 12,
        anchorY: 34,
        destination: "/tmp/work/src/app.ts",
        kind: "file",
      }),
    );
  });

  it("does nothing without a context or when the gesture rejects", () => {
    const noContext = requestTerminalLinkAction(
      mouseEvent(),
      null,
      details(),
    );
    expect(noContext).toBe(false);

    const blocked = context({ pointerGesture: fakeGesture(false) });
    const event = mouseEvent();
    expect(requestTerminalLinkAction(event, blocked, details())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(blocked.request).not.toHaveBeenCalled();
  });

  it("does nothing when the PTY mouse claim fails", () => {
    const claimed = context({ claimPtyMouse: () => false });
    const event = mouseEvent();
    expect(requestTerminalLinkAction(event, claimed, details())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(claimed.request).not.toHaveBeenCalled();
  });
});

describe("closeTerminalLinkActionRequest", () => {
  const open: TerminalLinkActionRequest = {
    paneId: 1,
    anchorX: 0,
    anchorY: 0,
    destination: "d",
    kind: "file",
    primary: { label: "Open file", run: () => {} },
    focusTerminal: () => {},
  };
  const other: TerminalLinkActionRequest = { ...open, destination: "other" };

  it("closes its own request", () => {
    expect(closeTerminalLinkActionRequest(open, open)).toBeNull();
  });

  it("keeps a newer request when an older one dismisses late", () => {
    expect(closeTerminalLinkActionRequest(other, open)).toBe(other);
  });

  it("closes without a dismissed argument", () => {
    expect(closeTerminalLinkActionRequest(open)).toBeNull();
  });
});

describe("terminal link pointer gesture", () => {
  function gestureHost(hasSelection = false) {
    const listeners: Array<(event: MouseEvent) => void> = [];
    const element = {
      addEventListener: (_: string, listener: (event: MouseEvent) => void) => {
        listeners.push(listener);
      },
      removeEventListener: () => {},
    };
    const terminal = {
      hasSelection: () => hasSelection,
      element: element as unknown as HTMLElement,
    };
    const gesture = installTerminalLinkPointerGesture(terminal);
    return { gesture, mousedown: listeners[0] };
  }

  it("allows the action after a clean owned-press", () => {
    const { gesture, mousedown } = gestureHost();
    mousedown(mouseEvent());
    expect(gesture.canRequestAction(mouseEvent())).toBe(true);
    gesture.dispose();
  });

  it("rejects presses the terminal does not own and selections", () => {
    const unowned = gestureHost();
    // Alt makes the press unowned (neither direct nor action activation).
    unowned.mousedown(mouseEvent({ altKey: true }));
    expect(unowned.gesture.canRequestAction(mouseEvent())).toBe(false);
    unowned.gesture.dispose();

    const selected = gestureHost(true);
    selected.mousedown(mouseEvent());
    expect(selected.gesture.canRequestAction(mouseEvent())).toBe(false);
    selected.gesture.dispose();
  });
});
