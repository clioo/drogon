import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  CHANGES_ROUTE_ID,
  ChangesView,
  createChangesPanelDescriptor,
  isChangesAvailable,
  type ChangesViewCallbacks,
  type ChangesViewData,
} from "./ChangesPanel";

const noop: ChangesViewCallbacks = {
  onSelect: () => {},
  onStage: () => {},
  onUnstage: () => {},
  onCommitMessage: () => {},
  onCommit: () => {},
  onPush: () => {},
  onPrCreate: () => {},
  onRefresh: () => {},
};

const base: ChangesViewData = {
  branchHead: "main",
  ahead: 1,
  hasUpstream: true,
  staged: [
    { path: "a.txt", staged: "M", unstaged: ".", kind: "ordinary" },
  ],
  unstaged: [
    { path: "b.txt", staged: ".", unstaged: "M", kind: "ordinary" },
  ],
  untracked: [
    { path: "new.txt", staged: "?", unstaged: "?", kind: "untracked" },
  ],
  statusTruncated: false,
  selection: null,
  diff: { phase: "idle" },
  commitMessage: "",
  commitReady: false,
  pushEnabled: true,
  pushTitle: "Push 1 commit upstream",
  busy: null,
  notice: null,
  prUrl: null,
};

function render(data: ChangesViewData): string {
  // renderToString splits text nodes with `<!-- -->` comments; strip them
  // so assertions read the visible strings.
  return renderToString(
    createElement(ChangesView, { data, callbacks: noop }),
  ).replace(/<!-- -->/g, "");
}

describe("changes view", () => {
  test("renders all three groups with badges", () => {
    const html = render(base);
    expect(html).toContain("Staged (1)");
    expect(html).toContain("Unstaged (1)");
    expect(html).toContain("Untracked (1)");
    expect(html).toContain("a.txt");
    expect(html).toContain("b.txt");
    expect(html).toContain("new.txt");
  });

  test("commit is disabled without a message; push explains its state", () => {
    const html = render(base);
    expect(html).toContain("Stage changes and write a message to commit");
    const ready = render({ ...base, commitMessage: "fix", commitReady: true });
    expect(ready).toContain("Commit staged changes");
  });

  test("push is disabled with an honest title when up to date", () => {
    const html = render({
      ...base,
      ahead: 0,
      pushEnabled: false,
      pushTitle: "Already up to date with upstream",
    });
    expect(html).toContain("Already up to date with upstream");
  });

  test("renders unified diff lines and truncation notice", () => {
    const html = render({
      ...base,
      selection: { path: "a.txt", staged: false },
      diff: {
        phase: "ready",
        diff: "@@ -1 +1 @@\n-old\n+new",
        truncated: true,
      },
    });
    expect(html).toContain("-old");
    expect(html).toContain("+new");
    expect(html).toContain("Diff truncated to the display budget.");
  });

  test("empty work renders the no-changes state", () => {
    const html = render({
      ...base,
      staged: [],
      unstaged: [],
      untracked: [],
      ahead: 0,
      pushEnabled: false,
      pushTitle: "Already up to date with upstream",
    });
    expect(html).toContain("No changes.");
  });
});

describe("changes panel contract", () => {
  test("route id and capability gate", () => {
    expect(CHANGES_ROUTE_ID).toBe("changes");
    expect(isChangesAvailable(["git.v1"])).toBe(true);
    expect(isChangesAvailable(["files.v1"])).toBe(false);
  });

  test("factory descriptor carries the git capability", () => {
    const descriptor = createChangesPanelDescriptor({
      bridge: undefined as never,
    });
    expect(descriptor.id).toBe("changes");
    expect(descriptor.title).toBe("Changes");
    expect(descriptor.capability).toBe("git.v1");
    expect(typeof descriptor.component).toBe("function");
  });
});
