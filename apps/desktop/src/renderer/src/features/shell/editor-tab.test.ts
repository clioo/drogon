// MIT Copyright (c) 2026 Lovecast Inc. R16-BJ (#294/#302): the editor tab
// store's diff flavor, per-tab view mode and missing tombstone identity.

import { describe, expect, test } from "vitest";
import {
  editorDiffTabId,
  editorDiffTabLabel,
  editorTabId,
  editorTabLabel,
  renameTargetPath,
  retargetEditorTabsAfterRename,
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

describe("tab rename retarget (#335)", () => {
  const fileTab = (path: string, extra?: Partial<EditorTabState>): EditorTabState => ({
    tabId: editorTabId("ws1", path),
    workspaceId: "ws1",
    path,
    dirty: false,
    ...extra,
  });

  test("renameTargetPath stays in the file's own directory", () => {
    expect(renameTargetPath("src/a.ts", "b.ts")).toBe("src/b.ts");
    expect(renameTargetPath("notes.md", "todo.md")).toBe("todo.md");
  });

  test("a renamed tab keeps its slot under the new path and identity", () => {
    const tabs = [fileTab("src/a.ts"), fileTab("src/b.ts")];
    const result = retargetEditorTabsAfterRename(tabs, "ws1::src/a.ts", "src/c.ts");
    expect(result.activatedTabId).toBe("ws1::src/c.ts");
    expect(result.tabs.map((tab) => tab.tabId)).toEqual([
      "ws1::src/c.ts",
      "ws1::src/b.ts",
    ]);
    expect(result.tabs[0].path).toBe("src/c.ts");
  });

  test("a rename clears the missing tombstone instead of keeping it", () => {
    const tabs = [fileTab("src/a.ts", { missing: "deleted" })];
    const result = retargetEditorTabsAfterRename(tabs, "ws1::src/a.ts", "src/c.ts");
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].missing).toBeUndefined();
    expect(result.tabs[0].path).toBe("src/c.ts");
  });

  test("a target that is already open absorbs the renamed tab", () => {
    const tabs = [fileTab("src/a.ts"), fileTab("src/b.ts")];
    const result = retargetEditorTabsAfterRename(tabs, "ws1::src/a.ts", "src/b.ts");
    expect(result.tabs.map((tab) => tab.tabId)).toEqual(["ws1::src/b.ts"]);
    expect(result.activatedTabId).toBe("ws1::src/b.ts");
  });

  test("unknown ids, same paths and diff tabs change nothing", () => {
    const tabs = [fileTab("src/a.ts")];
    expect(
      retargetEditorTabsAfterRename(tabs, "ws1::nope.ts", "src/c.ts").activatedTabId,
    ).toBeNull();
    expect(
      retargetEditorTabsAfterRename(tabs, "ws1::src/a.ts", "src/a.ts").activatedTabId,
    ).toBeNull();
    const diffTabs: EditorTabState[] = [
      {
        tabId: editorDiffTabId("ws1", "unstaged", "src/a.ts"),
        workspaceId: "ws1",
        path: "src/a.ts",
        dirty: false,
        diff: "unstaged",
      },
    ];
    const diffResult = retargetEditorTabsAfterRename(
      diffTabs,
      editorDiffTabId("ws1", "unstaged", "src/a.ts"),
      "src/c.ts",
    );
    expect(diffResult.activatedTabId).toBeNull();
    expect(diffResult.tabs).toEqual(diffTabs);
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
