// @vitest-environment jsdom
import { expect, test } from "vitest";
import { preventTerminalBacktabNavigation } from "./terminal-backtab-navigation";

test("Backtab keeps xterm encoding but cancels browser focus navigation and bubbling", () => {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  expect(preventTerminalBacktabNavigation(event)).toBe(true);
  expect(event.defaultPrevented).toBe(true);
  expect(event.cancelBubble).toBe(true);
});
test.each([
  { key: "Tab", shiftKey: false },
  { key: "Tab", shiftKey: true, ctrlKey: true },
  { key: "Tab", shiftKey: true, metaKey: true },
  { key: "Tab", shiftKey: true, altKey: true },
  { key: "Enter", shiftKey: true },
  { key: "Tab", shiftKey: true, isComposing: true },
  { key: "Tab", shiftKey: true, keyCode: 229 },
])("leaves unrelated chords and IME ownership intact: %j", (init) => {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  expect(preventTerminalBacktabNavigation(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(event.cancelBubble).toBe(false);
});
test("keyup does not introduce another action", () => {
  const event = new KeyboardEvent("keyup", { key: "Tab", shiftKey: true, cancelable: true });
  expect(preventTerminalBacktabNavigation(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
});
