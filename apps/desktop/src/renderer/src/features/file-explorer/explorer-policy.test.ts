import { describe, expect, test } from "vitest";
import {
  buildBackgroundMenuItems,
  buildRowMenuItems,
  deleteConfirmationFor,
  deleteShortcutLabel,
  renameShortcutLabel,
  revealLabel,
  validateInlineName,
  type ExplorerCapabilities,
} from "./explorer-policy";
import type { ExplorerNode } from "./tree-model";

const fileNode: ExplorerNode = {
  name: "a.txt",
  path: "a.txt",
  isDirectory: false,
  depth: 0,
};
const dirNode: ExplorerNode = {
  name: "src",
  path: "src",
  isDirectory: true,
  depth: 0,
};
const mutable: ExplorerCapabilities = {
  canMutate: true,
  canReveal: true,
  canOpenTerminal: true,
};

describe("deleteShortcutLabel and revealLabel", () => {
  test("macOS uses Finder and ⌘⌫ copy", () => {
    expect(deleteShortcutLabel("Mac OS")).toBe("⌘⌫");
    expect(revealLabel("Mac OS")).toBe("Reveal in Finder");
  });

  test("other platforms use Delete and their own reveal copy", () => {
    expect(deleteShortcutLabel("Linux")).toBe("Delete");
    expect(revealLabel("Linux")).toBe("Open Containing Folder");
    expect(revealLabel("Windows")).toBe("Reveal in File Explorer");
  });
});

describe("renameShortcutLabel", () => {
  test("macOS shows ↩ like the fork, elsewhere Enter", () => {
    expect(renameShortcutLabel("Mac OS")).toBe("↩");
    expect(renameShortcutLabel("Linux")).toBe("Enter");
    expect(renameShortcutLabel("Windows")).toBe("Enter");
  });

  test("the row menu carries the platform rename shortcut", () => {
    const mac = buildRowMenuItems(fileNode, 1, mutable).find((item) => item.id === "rename");
    expect(mac?.shortcut).toBe(renameShortcutLabel());
  });
});

describe("buildRowMenuItems Collapse Folder (fork gate)", () => {
  test("shows only for expanded directories, after Open in Terminal", () => {
    const collapsed = buildRowMenuItems(dirNode, 1, mutable, false);
    expect(collapsed.some((item) => item.id === "collapse-folder")).toBe(false);
    const fileExpanded = buildRowMenuItems(fileNode, 1, mutable, true);
    expect(fileExpanded.some((item) => item.id === "collapse-folder")).toBe(false);
    const expanded = buildRowMenuItems(dirNode, 1, mutable, true);
    const ids = expanded.map((item) => item.id);
    expect(ids).toContain("collapse-folder");
    // Source order: Open in Terminal, [Find in Folder — not ported],
    // Collapse Folder, Reveal in Finder.
    expect(ids.indexOf("collapse-folder")).toBeGreaterThan(
      ids.indexOf("open-in-terminal"),
    );
    expect(ids.indexOf("collapse-folder")).toBeLessThan(
      ids.indexOf("reveal-in-finder"),
    );
  });
});

describe("buildRowMenuItems", () => {
  test("a file row carries the MVP subset in source order", () => {
    const items = buildRowMenuItems(fileNode, 1, mutable);
    expect(items.map((item) => item.id)).toEqual([
      "new-file",
      "new-folder",
      "copy-path",
      "copy-relative-path",
      "reveal-in-finder",
      "rename",
      "delete",
    ]);
    // The test caps carry canReveal; without a shell bridge the item
    // stays visible but disabled with its reason.
    expect(items.find((item) => item.id === "reveal-in-finder")?.disabled).toBeUndefined();
    const unrevealed = buildRowMenuItems(fileNode, 1, { ...mutable, canReveal: false });
    const reveal = unrevealed.find((item) => item.id === "reveal-in-finder");
    expect(reveal?.disabled).toBe(true);
    expect(reveal?.disabledReason).toMatch(/shell bridge/);
  });

  test("a directory row gains Open in Terminal; multi-selection pluralizes copy", () => {
    const ids = buildRowMenuItems(dirNode, 3, mutable).map((item) => item.id);
    expect(ids).toContain("open-in-terminal");
    const labels = Object.fromEntries(
      buildRowMenuItems(dirNode, 3, mutable).map((item) => [item.id, item.label]),
    );
    expect(labels["copy-path"]).toBe("Copy Paths");
    expect(labels["copy-relative-path"]).toBe("Copy Relative Paths");
  });

  test("mutations disable (never hide) without bridge support", () => {
    const items = buildRowMenuItems(fileNode, 1, {
      ...mutable,
      canMutate: false,
    });
    expect(items.map((item) => item.id)).toContain("rename");
    for (const item of items) {
      if (["new-file", "new-folder", "rename", "delete"].includes(item.id)) {
        expect(item.disabled).toBe(true);
        expect(item.disabledReason).toMatch(/daemon/);
      } else {
        expect(item.disabled).toBeUndefined();
      }
    }
  });

  test("delete stays destructive with the platform shortcut", () => {
    const items = buildRowMenuItems(fileNode, 1, mutable);
    const del = items.find((item) => item.id === "delete");
    expect(del?.destructive).toBe(true);
    expect(del?.shortcut).toBe(deleteShortcutLabel());
  });
});

describe("buildBackgroundMenuItems", () => {
  test("the empty area offers New File and New Folder", () => {
    expect(buildBackgroundMenuItems(mutable).map((item) => item.id)).toEqual([
      "new-file",
      "new-folder",
    ]);
  });
});

describe("deleteConfirmationFor", () => {
  test("a single file uses the permanent-delete copy", () => {
    expect(deleteConfirmationFor([fileNode])).toEqual({
      title: "Permanently delete 'a.txt'?",
      description: "This permanently deletes the file. This cannot be undone.",
      confirmLabel: "Delete",
    });
  });

  test("a directory names its contents; batches count items", () => {
    expect(deleteConfirmationFor([dirNode]).description).toMatch(
      /directory and its contents/,
    );
    expect(deleteConfirmationFor([fileNode, dirNode]).title).toBe(
      "Permanently delete 2 items?",
    );
  });
});

describe("validateInlineName", () => {
  const siblings = new Set(["taken.txt"]);
  test("blank names refuse with guidance", () => {
    expect(validateInlineName("   ", "file", siblings)).toEqual({
      ok: false,
      error: "Enter a name.",
    });
  });

  test("separators and dot segments refuse", () => {
    for (const bad of ["a/b", "a\\b", ".", ".."]) {
      expect(validateInlineName(bad, "file", siblings).ok).toBe(false);
    }
  });

  test("collisions refuse; renames to the same name cancel", () => {
    expect(validateInlineName("taken.txt", "file", siblings)).toEqual({
      ok: false,
      error: "A file or folder with this name already exists.",
    });
    expect(validateInlineName("same.txt", "rename", siblings, "same.txt")).toEqual({
      ok: true,
      unchanged: true,
    });
    expect(validateInlineName("new.txt", "rename", siblings, "old.txt")).toEqual({
      ok: true,
      unchanged: false,
    });
  });
});
