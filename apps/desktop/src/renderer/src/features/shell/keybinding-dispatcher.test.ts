// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
import { describe, expect, test, vi } from "vitest";
import { dispatchShellKeybinding } from "./keybinding-dispatcher";

function keydown(
  key: string,
  options: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe("shell keybinding dispatcher", () => {
  test("claims a source default and calls its shell handler once", () => {
    const event = keydown("w", { metaKey: true });
    const close = vi.fn();
    const match = dispatchShellKeybinding({
      event,
      handlers: { "tab.close": close },
      platform: "darwin",
      context: "app",
    });
    expect(match).toEqual({ id: "tab.close", digitIndex: null });
    expect(close).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  test("does not double-dispatch after a pane handler claimed the event", () => {
    const event = keydown("w", { metaKey: true });
    event.preventDefault();
    const close = vi.fn();
    expect(
      dispatchShellKeybinding({
        event,
        handlers: { "tab.close": close },
        platform: "darwin",
        context: "app",
      }),
    ).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  test("prefers terminal pane ownership for Cmd+W", () => {
    const event = keydown("w", { metaKey: true });
    const closePane = vi.fn();
    const match = dispatchShellKeybinding({
      event,
      handlers: { "terminal.closePane": closePane },
      platform: "darwin",
      context: "terminal",
    });
    expect(match?.id).toBe("terminal.closePane");
    expect(closePane).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  test("passes Cmd+W through to the focused terminal TUI", () => {
    const event = keydown("w", { metaKey: true });
    const close = vi.fn();
    const panel = document.createElement("div");
    panel.id = "active-session-panel";
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    panel.append(helper);
    document.body.append(panel);
    Object.defineProperty(event, "target", { value: helper });
    const match = dispatchShellKeybinding({
      event,
      handlers: { "tab.close": close },
      platform: "darwin",
    });
    expect(match).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    panel.remove();
  });

  test("matches the macOS-only Ports chord without stealing linux", () => {
    const macEvent = keydown("i", { metaKey: true, shiftKey: true });
    const ports = vi.fn();
    expect(
      dispatchShellKeybinding({
        event: macEvent,
        handlers: { "sidebar.ports.toggle": ports },
        platform: "darwin",
        context: "app",
      })?.id,
    ).toBe("sidebar.ports.toggle");
    expect(ports).toHaveBeenCalledOnce();

    const linuxEvent = keydown("i", { ctrlKey: true, shiftKey: true });
    expect(
      dispatchShellKeybinding({
        event: linuxEvent,
        handlers: { "sidebar.ports.toggle": ports },
        platform: "linux",
        context: "app",
      }),
    ).toBeNull();
  });

  test("does not dispatch a held repeat", () => {
    const event = keydown("t", { metaKey: true, repeat: true });
    const create = vi.fn();
    expect(
      dispatchShellKeybinding({
        event,
        handlers: { "tab.newTerminal": create },
        platform: "darwin",
        context: "app",
      }),
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
