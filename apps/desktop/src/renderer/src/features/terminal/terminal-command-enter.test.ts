// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createTerminalCommandEnterHandler } from "./terminal-command-enter";

const key = (type: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent(type, {
    key: "Enter",
    code: "Enter",
    metaKey: true,
    cancelable: true,
    bubbles: true,
    ...init,
  });

test("macOS Command+Enter submits exactly one plain Return and claims the DOM transaction", () => {
  const send = vi.fn();
  const handle = createTerminalCommandEnterHandler(true, send);
  const down = key("keydown");
  const press = key("keypress");
  const up = key("keyup");

  expect(handle(down)).toBe(true);
  expect(handle(press)).toBe(true);
  expect(handle(up)).toBe(true);

  expect(send.mock.calls).toEqual([["\r"]]);
  for (const event of [down, press, up]) {
    expect(event.defaultPrevented).toBe(true);
    expect(event.cancelBubble).toBe(true);
  }
});

test("held Command+Enter repeats are independent submits while release is still swallowed", () => {
  const send = vi.fn();
  const handle = createTerminalCommandEnterHandler(true, send);

  expect(handle(key("keydown"))).toBe(true);
  expect(handle(key("keydown", { repeat: true }))).toBe(true);
  expect(handle(key("keyup"))).toBe(true);

  expect(send.mock.calls).toEqual([["\r"], ["\r"]]);
});

test.each([
  { metaKey: false },
  { shiftKey: true },
  { ctrlKey: true },
  { altKey: true },
  { isComposing: true },
  { keyCode: 229 },
  { key: "Tab" },
])("does not take another shortcut or IME transaction: %j", (init) => {
  const send = vi.fn();
  const event = key("keydown", init);
  expect(createTerminalCommandEnterHandler(true, send)(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

test("does not claim Ctrl+Enter on non-mac platforms", () => {
  const send = vi.fn();
  const event = key("keydown", { metaKey: false, ctrlKey: true });
  expect(createTerminalCommandEnterHandler(false, send)(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

test("keyup without a claimed keydown is left to xterm", () => {
  const send = vi.fn();
  const event = key("keyup");
  expect(createTerminalCommandEnterHandler(true, send)(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
