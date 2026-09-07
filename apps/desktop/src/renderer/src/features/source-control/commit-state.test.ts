import { describe, expect, test } from "vitest";
import { getCommitMessageTextareaRows } from "./commit-message-rows";
import { getCommitSubmitModifierLabel, isCommitSubmitShortcut } from "./commit-shortcut";

describe("commit composer state", () => {
  test("textarea rows grow with newlines and clamp to 2..12", () => {
    expect(getCommitMessageTextareaRows("")).toBe(2);
    expect(getCommitMessageTextareaRows("one line")).toBe(2);
    expect(getCommitMessageTextareaRows("a\nb\nc")).toBe(3);
    expect(getCommitMessageTextareaRows(Array(40).fill("x").join("\n"))).toBe(12);
  });

  test("submit shortcut is the platform modifier plus Enter", () => {
    const modifier = getCommitSubmitModifierLabel();
    expect(["⌘", "Ctrl"]).toContain(modifier);
    const withModifier =
      modifier === "⌘" ? { metaKey: true } : { ctrlKey: true };
    expect(isCommitSubmitShortcut({ key: "Enter", ...withModifier })).toBe(true);
    expect(isCommitSubmitShortcut({ key: "Enter" })).toBe(false);
    expect(isCommitSubmitShortcut({ key: "Enter", ...withModifier, shiftKey: true })).toBe(false);
    expect(isCommitSubmitShortcut({ key: " " , ...withModifier })).toBe(false);
  });
});
