// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc. R16-BJ (#294/#302): the strip tab's
// diff flavor (GitCompareArrows icon + source-suffixed label) and the
// fork's missing-file tombstone (line-through label + mutation badge,
// verbatim EditorFileTab.tsx copy).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { EditorStripTab } from "./EditorStripTab";
import { editorDiffTabId, editorTabId, type EditorTabState } from "../editor-tab";

afterEach(cleanup);

function renderTab(tab: EditorTabState, handlers: { onActivate?: () => void; onClose?: () => void } = {}) {
  return render(
    <TooltipProvider>
      <EditorStripTab
        tab={tab}
        isActive
        hasTabsToRight={false}
        onActivate={handlers.onActivate ?? (() => {})}
        onClose={handlers.onClose ?? (() => {})}
      />
    </TooltipProvider>,
  );
}

const fileTab: EditorTabState = {
  tabId: editorTabId("ws-1", "src/app.ts"),
  workspaceId: "ws-1",
  path: "src/app.ts",
  dirty: false,
};

const unstagedDiffTab: EditorTabState = {
  tabId: editorDiffTabId("ws-1", "unstaged", "src/app.ts"),
  workspaceId: "ws-1",
  path: "src/app.ts",
  dirty: false,
  diff: "unstaged",
};

const stagedDiffTab: EditorTabState = {
  tabId: editorDiffTabId("ws-1", "staged", "src/app.ts"),
  workspaceId: "ws-1",
  path: "src/app.ts",
  dirty: false,
  diff: "staged",
};

describe("editor strip tab: diff flavor (#294)", () => {
  it("a diff tab carries the fork's diff label with its source", () => {
    const { container } = renderTab(unstagedDiffTab);
    expect(screen.getByText("app.ts (diff)")).toBeTruthy();
    // The fork's diff-tab icon is lucide's GitCompareArrows; a file tab
    // renders the plain file icon instead.
    expect(container.querySelector("svg.lucide-git-compare-arrows")).toBeTruthy();
    expect(container.querySelector("svg.lucide-file-text")).toBeNull();
  });

  it("staged and unstaged tabs of one file are two tabs with distinct labels", () => {
    const first = renderTab(unstagedDiffTab);
    expect(screen.getByText("app.ts (diff)")).toBeTruthy();
    first.unmount();
    renderTab(stagedDiffTab);
    expect(screen.getByText("app.ts (staged diff)")).toBeTruthy();
  });

  it("a plain file tab keeps the file icon and base-name label", () => {
    const { container } = renderTab(fileTab);
    expect(screen.getByText("app.ts")).toBeTruthy();
    expect(container.querySelector("svg.lucide-file-text")).toBeTruthy();
    expect(container.querySelector("svg.lucide-git-compare-arrows")).toBeNull();
  });
});

describe("editor strip tab: missing-file tombstone (#302)", () => {
  it("a deleted file's tab shows the struck label plus the deleted badge", () => {
    const { container } = renderTab({
      ...fileTab,
      path: "scratch.txt",
      tabId: editorTabId("ws-1", "scratch.txt"),
      missing: "deleted",
    });
    const label = screen.getByText("scratch.txt");
    expect(label.className).toContain("line-through");
    const badge = screen.getByText("deleted");
    // Fork EditorFileTab.tsx badge classes, verbatim.
    expect(badge.className).toContain("text-[10px]");
    expect(badge.className).toContain("text-muted-foreground");
    expect(container.querySelector("svg.lucide-git-compare-arrows")).toBeNull();
  });

  it("the tombstoned tab still closes like any other tab", () => {
    const onClose = vi.fn();
    renderTab(
      {
        ...fileTab,
        path: "scratch.txt",
        tabId: editorTabId("ws-1", "scratch.txt"),
        missing: "deleted",
        dirty: false,
      },
      { onClose },
    );
    fireEvent.click(screen.getByRole("button", { name: "Close scratch.txt" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
