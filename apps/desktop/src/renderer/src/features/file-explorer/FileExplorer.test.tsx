import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FileExplorerToolbar } from "./FileExplorerToolbar";
import { FileExplorerNameFilter } from "./FileExplorerNameFilter";
import { FileExplorerTreeStatus } from "./FileExplorerTreeStatus";
import { FileExplorerTreePane } from "./FileExplorerTreePane";
import { FileExplorerRowMenu, DeleteConfirmDialog } from "./FileExplorerMenus";
import { InlineInputRow } from "./InlineInputRow";
import type { ExplorerNode } from "./tree-model";
import type { ExplorerCapabilities } from "./explorer-policy";

const caps: ExplorerCapabilities = {
  canMutate: true,
  canReveal: false,
  canOpenTerminal: true,
};
const rows: ExplorerNode[] = [
  { name: "src", path: "src", isDirectory: true, depth: 0 },
  { name: "main.ts", path: "src/main.ts", isDirectory: false, depth: 1 },
  { name: "README.md", path: "README.md", isDirectory: false, depth: 0 },
];
const noop = () => {};

describe("FileExplorerToolbar", () => {
  test("renders the task's toolbar contract", () => {
    const html = renderToString(
      createElement(FileExplorerToolbar, {
        repoName: "folder",
        canCreate: true,
        onNewFile: noop,
        onNewFolder: noop,
        canRefresh: true,
        isRefreshing: false,
        showRefreshSpinner: false,
        onRefresh: noop,
        canCollapseAll: true,
        onCollapseAll: noop,
        canRevealActive: true,
        onRevealActive: noop,
        showDotfiles: true,
        onToggleDotfiles: noop,
      }),
    );
    for (const label of [
      "New File",
      "New Folder",
      "Reveal Active File",
      "Collapse All",
      "Refresh Explorer",
      "More Explorer Actions",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("folder");
  });
});

describe("FileExplorerNameFilter", () => {
  test("renders the find box with clear control when filtering", () => {
    const html = renderToString(
      createElement(FileExplorerNameFilter, {
        query: "main",
        onQueryChange: noop,
        onClear: noop,
      }),
    );
    expect(html).toContain('aria-label="Find files"');
    expect(html).toContain('aria-label="Clear file filter"');
  });
});

describe("FileExplorerTreeStatus", () => {
  test("covers loading, error and empty copy", () => {
    expect(
      renderToString(createElement(FileExplorerTreeStatus, { isLoading: true, error: null, isEmpty: false })),
    ).toContain("animate-spin");
    expect(
      renderToString(
        createElement(FileExplorerTreeStatus, { isLoading: false, error: "boom", isEmpty: false }),
      ),
    ).toContain("Could not load files for this workspace:");
    expect(
      renderToString(
        createElement(FileExplorerTreeStatus, {
          isLoading: false,
          error: null,
          isEmpty: true,
          emptyMessage: "No files match this filter",
        }),
      ),
    ).toContain("No files match this filter");
  });
});

describe("FileExplorerTreePane", () => {
  const pane = (extra?: Partial<React.ComponentProps<typeof FileExplorerTreePane>>) =>
    createElement(FileExplorerTreePane, {
      rows,
      expanded: new Set<string>(["src"]),
      pendingDirs: new Set<string>(),
      selectedPaths: new Set<string>(["src/main.ts"]),
      inline: null,
      hasFilter: false,
      filterLoading: false,
      filterError: null,
      onSelectRow: noop,
      onToggleDir: noop,
      onMoveSelection: noop,
      onSelectReplace: noop,
      onStartRename: noop,
      onRowMenu: noop,
      onBackgroundMenu: noop,
      onBackgroundDoubleClick: noop,
      onSubmitInline: () => true,
      onCancelInline: noop,
      ...extra,
    });

  test("rows carry treeitem roles with level, expansion and selection", () => {
    const html = renderToString(pane());
    expect(html).toContain('role="tree"');
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("src/main.ts");
  });

  test("an empty tree reports the filter message when filtering", () => {
    const html = renderToString(
      pane({ rows: [], hasFilter: true, filterLoading: false, filterError: null }),
    );
    expect(html).toContain("No files match this filter");
  });

  test("a rename inline row replaces its row with a labelled input", () => {
    const html = renderToString(
      pane({
        inline: {
          input: {
            parentPath: "src",
            type: "rename",
            depth: 1,
            existingName: "main.ts",
            existingPath: "src/main.ts",
          },
          error: null,
        },
      }),
    );
    expect(html).toContain("data-file-explorer-inline-input");
    expect(html).toContain("Rename to");
    expect(html).not.toContain("data-path=\"src/main.ts\"");
  });
});

describe("FileExplorerRowMenu", () => {
  test("a file row menu carries the MVP item set", () => {
    const html = renderToString(
      createElement(FileExplorerRowMenu, {
        node: rows[1],
        selectionSize: 1,
        caps,
        point: { x: 10, y: 10 },
        onAction: noop,
        onClose: noop,
      }),
    );
    for (const item of [
      "New File",
      "New Folder",
      "Copy Path",
      "Copy Relative Path",
      "Reveal in Finder",
      "Rename",
      "Delete",
    ]) {
      expect(html).toContain(item);
    }
  });
});

describe("InlineInputRow", () => {
  test("new-file rows are labelled inputs", () => {
    const html = renderToString(
      createElement(InlineInputRow, {
        depth: 0,
        inlineInput: { parentPath: "", type: "file", depth: 0 },
        error: null,
        onSubmit: () => true,
        onCancel: noop,
      }),
    );
    expect(html).toContain('aria-label="New file name"');
  });
});

describe("DeleteConfirmDialog", () => {
  test("uses an alertdialog with the permanent-delete copy", () => {
    const html = renderToString(
      createElement(DeleteConfirmDialog, {
        title: "Permanently delete 'a.txt'?",
        description: "This permanently deletes the file. This cannot be undone.",
        confirmLabel: "Delete",
        pending: false,
        error: null,
        onConfirm: noop,
        onCancel: noop,
      }),
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Permanently delete");
    expect(html).toContain("Cancel");
  });
});
