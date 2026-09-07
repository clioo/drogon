// MIT Copyright (c) 2026 Lovecast Inc. Tests for the ported automation
// list keyboard navigation helpers.
import { describe, expect, it } from "vitest";
import {
  activateAutomationListEnterTarget,
  findAutomationListSelectionIndex,
  getAutomationListArrowNavigationTarget,
  getAutomationListEnterNavigationTarget,
  shouldHandleAutomationListSearchArrowKey,
  shouldHandleAutomationListSearchEnterKey,
} from "./automation-list-keyboard-navigation";

const items = [
  { kind: "local" as const, id: "a" },
  { kind: "local" as const, id: "b" },
  { kind: "local" as const, id: "c" },
];

function keyEvent(key: string): {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
} {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    nativeEvent: { isComposing: false },
  };
}

describe("automation list keyboard navigation", () => {
  it("finds the selected index and misses unknown ids", () => {
    expect(findAutomationListSelectionIndex(items, "b")).toBe(1);
    expect(findAutomationListSelectionIndex(items, "zzz")).toBe(-1);
    expect(findAutomationListSelectionIndex(items, null)).toBe(-1);
  });

  it("steps down and up, clamping at the ends", () => {
    expect(
      getAutomationListArrowNavigationTarget({
        items,
        selectedId: "b",
        key: "ArrowDown",
      }),
    ).toEqual({ kind: "local", id: "c" });
    expect(
      getAutomationListArrowNavigationTarget({
        items,
        selectedId: "b",
        key: "ArrowUp",
      }),
    ).toEqual({ kind: "local", id: "a" });
    expect(
      getAutomationListArrowNavigationTarget({
        items,
        selectedId: "c",
        key: "ArrowDown",
      }),
    ).toEqual({ kind: "local", id: "c" });
    expect(
      getAutomationListArrowNavigationTarget({
        items,
        selectedId: null,
        key: "ArrowDown",
      }),
    ).toEqual({ kind: "local", id: "a" });
    expect(
      getAutomationListArrowNavigationTarget({
        items,
        selectedId: null,
        key: "ArrowUp",
      }),
    ).toEqual({ kind: "local", id: "c" });
  });

  it("returns null for an empty list", () => {
    expect(
      getAutomationListArrowNavigationTarget({
        items: [],
        selectedId: null,
        key: "ArrowDown",
      }),
    ).toBeNull();
    expect(
      getAutomationListEnterNavigationTarget({ items: [], selectedId: null }),
    ).toBeNull();
  });

  it("enter prefers the selection and falls back to the first row", () => {
    expect(
      getAutomationListEnterNavigationTarget({ items, selectedId: "b" }),
    ).toEqual({ kind: "local", id: "b" });
    expect(
      getAutomationListEnterNavigationTarget({ items, selectedId: null }),
    ).toEqual({ kind: "local", id: "a" });
  });

  it("enter activation selects the row and opens the detail", () => {
    let selected: string | null = null;
    let opened = 0;
    activateAutomationListEnterTarget({
      items,
      selectedId: null,
      selectAutomationRow: (id) => {
        selected = id;
      },
      onOpenDetail: () => {
        opened += 1;
      },
    });
    expect(selected).toBe("a");
    expect(opened).toBe(1);
  });

  it("gates search arrow/enter handling on plain keys", () => {
    expect(shouldHandleAutomationListSearchArrowKey(keyEvent("ArrowDown"))).toBe(
      true,
    );
    expect(
      shouldHandleAutomationListSearchArrowKey({
        ...keyEvent("ArrowDown"),
        shiftKey: true,
      }),
    ).toBe(false);
    expect(shouldHandleAutomationListSearchEnterKey(keyEvent("Enter"))).toBe(
      true,
    );
    expect(shouldHandleAutomationListSearchEnterKey(keyEvent("ArrowDown"))).toBe(
      false,
    );
  });
});
