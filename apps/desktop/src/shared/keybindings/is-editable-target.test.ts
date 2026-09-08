// @vitest-environment jsdom
// Fork parity (read-only reference `src/renderer/src/lib/editable-target.ts`):
// xterm's helper textarea must not count as editable, or global chords
// (⌘J/⌘P palettes, ⌘1–9 workspace jump) die while the terminal is focused.
import { describe, expect, test } from "vitest";
import { isEditableTarget } from "./dispatcher";

describe("isEditableTarget", () => {
  test("xterm helper textarea is not editable", () => {
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    expect(isEditableTarget(helper)).toBe(false);
  });

  test("plain text fields stay editable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
  });

  test("non-elements are not editable", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document.createTextNode("x"))).toBe(false);
  });
});
