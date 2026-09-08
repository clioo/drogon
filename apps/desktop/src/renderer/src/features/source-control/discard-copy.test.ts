// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/right-sidebar/source-control-discard-confirmation.test.ts
// (per-entry delete/permanently-delete copy), adapted to the local
// discard-confirmation copy helpers.
import { describe, expect, test } from "vitest";
import {
  getDiscardAreaConfirmationCopy,
  getDiscardEntryConfirmationCopy,
} from "./discard-confirmation";

describe("discard confirmation copy", () => {
  test("untracked entries delete permanently", () => {
    const copy = getDiscardEntryConfirmationCopy({
      area: "untracked",
      path: "notes/scratch.txt",
      status: "untracked",
    });
    expect(copy.title).toBe('Delete "scratch.txt"?');
    expect(copy.description).toContain("permanently delete");
    expect(copy.confirmLabel).toBe("Delete");
  });

  test("deleted tracked files restore", () => {
    const copy = getDiscardEntryConfirmationCopy({
      area: "unstaged",
      path: "gone.txt",
      status: "deleted",
    });
    expect(copy.title).toBe('Restore "gone.txt"?');
    expect(copy.confirmLabel).toBe("Restore");
  });

  test("modified tracked files discard", () => {
    const copy = getDiscardEntryConfirmationCopy({
      area: "unstaged",
      path: "src/a.ts",
      status: "modified",
    });
    expect(copy.title).toBe('Discard changes to "a.ts"?');
    expect(copy.description).toContain("cannot be undone");
    expect(copy.confirmLabel).toBe("Discard");
  });

  test("area copies count files", () => {
    expect(getDiscardAreaConfirmationCopy("untracked", 1).title).toBe(
      "Delete 1 untracked file?",
    );
    expect(getDiscardAreaConfirmationCopy("untracked", 3).confirmLabel).toBe("Delete 3");
    expect(getDiscardAreaConfirmationCopy("staged", 2).title).toBe(
      "Discard all staged changes?",
    );
    expect(getDiscardAreaConfirmationCopy("unstaged", 2).description).toContain("2 files");
  });
});
