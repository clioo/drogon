// MIT Copyright (c) 2026 Lovecast Inc. Issue #335: the strip's editor
// Rename plans through App's pure planner, then retargets through the
// shell helper — this pins the decision table (success plan, no-ops,
// user-facing throws, collision absorb) without mounting App.

import { describe, expect, test } from "vitest";
import { planEditorFileRename } from "./App";
import {
  editorDiffTabId,
  editorTabId,
  retargetEditorTabsAfterRename,
  type EditorTabState,
} from "./features/shell/editor-tab";

const fileTab = (
  path: string,
  extra?: Partial<EditorTabState>,
): EditorTabState => ({
  tabId: editorTabId("ws1", path),
  workspaceId: "ws1",
  path,
  dirty: false,
  ...extra,
});

describe("planEditorFileRename", () => {
  test("a clean file tab plans a same-directory rename", () => {
    const plan = planEditorFileRename(
      [fileTab("src/a.ts")],
      "ws1::src/a.ts",
      "c.ts",
    );
    expect(plan).toEqual({
      kind: "rename",
      workspaceId: "ws1",
      from: "src/a.ts",
      to: "src/c.ts",
    });
  });

  test("unknown, diff, missing and unchanged names are no-ops", () => {
    const tabs = [fileTab("src/a.ts")];
    expect(planEditorFileRename(tabs, "ws1::nope.ts", "c.ts")).toEqual({
      kind: "noop",
    });
    expect(planEditorFileRename(tabs, "ws1::src/a.ts", "a.ts")).toEqual({
      kind: "noop",
    });
    const diffTabs: EditorTabState[] = [
      {
        tabId: editorDiffTabId("ws1", "unstaged", "src/a.ts"),
        workspaceId: "ws1",
        path: "src/a.ts",
        dirty: false,
        diff: "unstaged",
      },
    ];
    expect(
      planEditorFileRename(
        diffTabs,
        editorDiffTabId("ws1", "unstaged", "src/a.ts"),
        "c.ts",
      ),
    ).toEqual({ kind: "noop" });
    expect(
      planEditorFileRename(
        [fileTab("src/gone.ts", { missing: "deleted" })],
        "ws1::src/gone.ts",
        "c.ts",
      ),
    ).toEqual({ kind: "noop" });
  });

  test("dirty tabs and path separators throw the user-facing message", () => {
    const tabs = [fileTab("src/a.ts", { dirty: true })];
    expect(() => planEditorFileRename(tabs, "ws1::src/a.ts", "c.ts")).toThrow(
      "Save the file before renaming it.",
    );
    const clean = [fileTab("src/a.ts")];
    expect(() =>
      planEditorFileRename(clean, "ws1::src/a.ts", "sub/c.ts"),
    ).toThrow("A name cannot contain path separators.");
    expect(() =>
      planEditorFileRename(clean, "ws1::src/a.ts", "..\\c.ts"),
    ).toThrow("A name cannot contain path separators.");
  });
});

describe("rename plan → retarget chain", () => {
  test("a daemon-confirmed plan retargets the open tab and activates it", () => {
    const tabs = [fileTab("src/a.ts"), fileTab("src/b.ts")];
    const plan = planEditorFileRename(tabs, "ws1::src/a.ts", "c.ts");
    if (plan.kind !== "rename") throw new Error("expected a rename plan");
    // The caller applies this only after files.rename resolves; a failed
    // RPC never reaches the retarget (renameEditorFile returns before
    // setEditorTabs when checked() throws).
    const retargeted = retargetEditorTabsAfterRename(
      tabs,
      "ws1::src/a.ts",
      plan.to,
    );
    expect(retargeted.tabs.map((tab) => tab.tabId)).toEqual([
      "ws1::src/c.ts",
      "ws1::src/b.ts",
    ]);
    expect(retargeted.activatedTabId).toBe("ws1::src/c.ts");
  });

  test("a plan onto an already-open path absorbs into that tab", () => {
    const tabs = [fileTab("src/a.ts"), fileTab("src/b.ts")];
    const plan = planEditorFileRename(tabs, "ws1::src/a.ts", "b.ts");
    if (plan.kind !== "rename") throw new Error("expected a rename plan");
    const retargeted = retargetEditorTabsAfterRename(
      tabs,
      "ws1::src/a.ts",
      plan.to,
    );
    expect(retargeted.tabs.map((tab) => tab.tabId)).toEqual(["ws1::src/b.ts"]);
    expect(retargeted.activatedTabId).toBe("ws1::src/b.ts");
  });
});
