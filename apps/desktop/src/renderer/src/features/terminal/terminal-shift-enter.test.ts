// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createTerminalShiftEnterHandler } from "./terminal-shift-enter";
import { TerminalKittyKeyboardModeTracker } from "../../../../shared/terminal-kitty-keyboard-mode-tracker";
const key = (type: string, init: KeyboardEventInit = {}) => new KeyboardEvent(type, { key: "Enter", code: "Enter", shiftKey: true, cancelable: true, bubbles: true, ...init });

test("source legacy fallback is one Alt-Enter, never a submitting plain CR", () => {
  const send = vi.fn();
  const handle = createTerminalShiftEnterHandler(() => 0, send);
  const down = key("keydown");
  expect(handle(down)).toBe(true);
  expect(down.defaultPrevented).toBe(true);
  expect(down.cancelBubble).toBe(true);
  expect(send.mock.calls).toEqual([["\x1b\r"]]);
  expect(handle(key("keypress"))).toBe(true);
  expect(handle(key("keyup", { shiftKey: false }))).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
test("uses this PTY's observed negotiation and returns to legacy after pop/reset", () => {
  const tracker = new TerminalKittyKeyboardModeTracker();
  const send = vi.fn();
  const handle = createTerminalShiftEnterHandler(() => tracker.flags, send);
  tracker.scan("\x1b[>1"); tracker.scan("u");
  handle(key("keydown")); handle(key("keyup"));
  tracker.scan("\x1b[<u");
  handle(key("keydown")); handle(key("keyup"));
  expect(send.mock.calls).toEqual([["\x1b[13;2u"], ["\x1b\r"]]);
});
test.each([{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { key: "Tab" }])("does not take another shortcut or IME transaction: %j", (init) => {
  const send = vi.fn();
  const event = key("keydown", init);
  expect(createTerminalShiftEnterHandler(() => 1, send)(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
