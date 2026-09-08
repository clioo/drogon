// MIT Copyright (c) 2026 Lovecast Inc. R16-BJ (#294/#302): the editor tab
// store's diff flavor, per-tab view mode and missing tombstone identity.

import { describe, expect, test } from "vitest";
import {
  editorDiffTabId,
  editorDiffTabLabel,
  editorTabId,
  editorTabLabel,
  type EditorTabState,
} from "./editor-tab";

describe("editor diff tab identity (#294)", () => {
  test("a diff tab is keyed by workspace, area AND path", () => {
    // Fork buildDiffEditorFileId legacy shape: the staged and unstaged
    // diffs of one file coexist as two tabs.
    expect(editorDiffTabId("ws1", "staged", "src/App.tsx")).toBe(
      "ws1::diff::staged::src/App.tsx",
    );
    expect(editorDiffTabId("ws1", "unstaged", "src/App.tsx")).toBe(
      "ws1::diff::unstaged::src/App.tsx",
    );
    expect(editorDiffTabId("ws1", "staged", "src/App.tsx")).not.toBe(
      editorDiffTabId("ws1", "unstaged", "src/App.tsx"),
    );
    // ...and never collides with the same path's file tab.
    expect(editorDiffTabId("ws1", "staged", "src/App.tsx")).not.toBe(
      editorTabId("ws1", "src/App.tsx"),
    );
  });

  test("diff tab labels carry their source like the fork (editor-labels.ts)", () => {
    expect(editorDiffTabLabel("src/App.tsx", "unstaged")).toBe(
      "App.tsx (diff)",
    );
    expect(editorDiffTabLabel("src/App.tsx", "staged")).toBe(
      "App.tsx (staged diff)",
    );
    // File tabs keep the plain base name.
    expect(editorTabLabel("src/App.tsx")).toBe("App.tsx");
  });

  test("file tabs stay untainted by the diff flavor", () => {
    const fileTab: EditorTabState = {
      tabId: editorTabId("ws1", "notes.md"),
      workspaceId: "ws1",
      path: "notes.md",
      dirty: false,
    };
    expect(fileTab.diff).toBeUndefined();
    expect(fileTab.missing).toBeUndefined();
    expect(fileTab.view).toBeUndefined();
  });
});

describe("missing-file tombstone state (#302)", () => {
  test("a tombstoned tab keeps its identity so a reappearance can clear it", () => {
    const tab: EditorTabState = {
      tabId: editorTabId("ws1", "scratch.txt"),
      workspaceId: "ws1",
      path: "scratch.txt",
      dirty: false,
      missing: "deleted",
    };
    expect(tab.missing).toBe("deleted");
    expect(editorTabId(tab.workspaceId, tab.path)).toBe(tab.tabId);
  });
});
