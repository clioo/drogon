// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createTerminalShiftEnterHandler } from "./terminal-shift-enter";
import { TerminalKittyKeyboardModeTracker } from "../../../../shared/terminal-kitty-keyboard-mode-tracker";
const key = (type: string, init: KeyboardEventInit = {}) => new KeyboardEvent(type, { key: "Enter", code: "Enter", shiftKey: true, cancelable: true, bubbles: true, ...init });

test("shell keeps source legacy fallback: one Alt-Enter, never a submitting plain CR", () => {
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
test("shell uses this PTY's observed negotiation and returns to legacy after pop/reset", () => {
  const tracker = new TerminalKittyKeyboardModeTracker();
  const send = vi.fn();
  const handle = createTerminalShiftEnterHandler(() => tracker.flags, send);
  tracker.scan("\x1b[>1"); tracker.scan("u");
  handle(key("keydown")); handle(key("keyup"));
  tracker.scan("\x1b[<u");
  handle(key("keydown")); handle(key("keyup"));
  expect(send.mock.calls).toEqual([["\x1b[13;2u"], ["\x1b\r"]]);
});
// Pi 0.85.1 (bundle-verified): CSI-u is its native Shift+Enter, accepted
// with or without kitty negotiation. Legacy ESC CR is Alt+Enter which
// submits directly in idle via followUp/onSubmit, and bare LF inserts
// newline via the editor raw-data branch in both kitty states (never
// submits) — per the adversarial review of PR #406 — so a Pi pane
// must send CSI-u even when its tracker lost the push (snapshot reset,
// truncated replay, boot race). This pin fails if the Pi encoding moves
// off CSI-u again (the 2026-09-10 submit regression).
test("pi always sends CSI-u, even with unproven kitty state", () => {
  for (const flags of [0, 1, 7]) {
    const send = vi.fn();
    const handle = createTerminalShiftEnterHandler(() => flags, send, { forceCsiU: true });
    const down = key("keydown");
    expect(handle(down)).toBe(true);
    expect(send.mock.calls).toEqual([["\x1b[13;2u"]]);
    expect(handle(key("keyup", { shiftKey: false }))).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  }
});
test("pi survives the snapshot-reset race that broke 2026-09-10", () => {
  const tracker = new TerminalKittyKeyboardModeTracker();
  tracker.resetForSnapshot();
  const send = vi.fn();
  const handle = createTerminalShiftEnterHandler(() => tracker.flags, send, { forceCsiU: true });
  expect(handle(key("keydown"))).toBe(true);
  expect(send.mock.calls).toEqual([["\x1b[13;2u"]]);
});
test.each([{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { key: "Tab" }])("does not take another shortcut or IME transaction: %j", (init) => {
  const send = vi.fn();
  const event = key("keydown", init);
  expect(createTerminalShiftEnterHandler(() => 1, send)(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
