// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the Shortcuts section's pure override/list edits (ported with
// the helpers from the fork's keybinding-override-edits and
// shortcut-binding-list-mutations modules).
import { describe, expect, test } from "vitest";
import {
  adjustRecordingIndexAfterRemove,
  appendBinding,
  hasOwnBindingOverride,
  removeBindingAt,
  removeBindingOverride,
  replaceBindingAt,
  sameBindings,
} from "./keybinding-overrides";

describe("override map edits", () => {
  test("sameBindings compares order-sensitively", () => {
    expect(sameBindings(["a"], ["a"])).toBe(true);
    expect(sameBindings(["a"], ["a", "b"])).toBe(false);
    expect(sameBindings(["a", "b"], ["b", "a"])).toBe(false);
  });
  test("has/remove round-trip on the override map", () => {
    const overrides = { "a.b": ["Mod+X"] };
    expect(hasOwnBindingOverride(overrides, "a.b")).toBe(true);
    expect(hasOwnBindingOverride(overrides, "c.d")).toBe(false);
    expect(removeBindingOverride(overrides, "a.b")).toEqual({});
    expect(overrides).toEqual({ "a.b": ["Mod+X"] });
  });
});

describe("binding list edits", () => {
  test("append/replace/remove copy the list", () => {
    expect(appendBinding(["a"], "b")).toEqual(["a", "b"]);
    expect(replaceBindingAt(["a", "b"], 1, "c")).toEqual(["a", "c"]);
    expect(replaceBindingAt(["a"], 7, "c")).toEqual(["a"]);
    expect(removeBindingAt(["a", "b"], 0)).toEqual(["b"]);
    expect(removeBindingAt(["a"], -1)).toEqual(["a"]);
  });
  test("adjustRecordingIndexAfterRemove tracks the pending row", () => {
    expect(adjustRecordingIndexAfterRemove(null, 0)).toBeNull();
    expect(adjustRecordingIndexAfterRemove(1, 1)).toBeNull();
    expect(adjustRecordingIndexAfterRemove(2, 0)).toBe(1);
    expect(adjustRecordingIndexAfterRemove(0, 2)).toBe(0);
  });
});
