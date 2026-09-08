// MIT Copyright (c) 2026 Lovecast Inc. Tests pin the reference row set,
// order, labels and disabled ladders ported into commit-dropdown-items.ts.
import { describe, expect, test } from "vitest";
import {
  buildCommitDropdownItems,
  formatCountLabel,
  formatSyncLabel,
  type CommitDropdownState,
} from "./commit-dropdown-items";

const ready: CommitDropdownState = {
  hasMessage: true,
  canCommit: true,
  commitBusy: false,
  syncBusy: false,
  hasUpstream: true,
  ahead: 2,
  behind: 1,
  createPrDisabled: false,
  createPrReason: null,
};

function labels(state: CommitDropdownState): string[] {
  return buildCommitDropdownItems(state)
    .filter((entry) => "label" in entry)
    .map((entry) => ("label" in entry ? entry.label : ""));
}

describe("commit dropdown items (fork row set)", () => {
  test("renders the reference rows in order", () => {
    expect(labels(ready)).toEqual([
      "Commit",
      "Commit & Push",
      "Commit & Sync",
      "Push (2)",
      "Create PR",
      "Push before PR",
      "Fast-forward (1)",
      "Sync (↓1 ↑2)",
      "Fetch",
    ]);
  });

  test("hides Push before PR unless the branch is ahead, like the source", () => {
    expect(labels({ ...ready, ahead: 0 })).not.toContain("Push before PR");
    expect(labels({ ...ready, ahead: 0 })).toContain("Push");
  });

  test("commit rows require staged changes and a message", () => {
    const empty = buildCommitDropdownItems({
      ...ready,
      hasMessage: false,
      canCommit: false,
    });
    const commit = empty.find((entry) => entry.id === "commit");
    expect(commit && "disabled" in commit && commit.disabled).toBe(true);
    expect(commit && "title" in commit && commit.title).toBe(
      "Write a commit message to commit",
    );
    const commitPush = empty.find((entry) => entry.id === "commit-push");
    expect(commitPush && "hint" in commitPush && commitPush.hint).toBe(
      "Write a message first",
    );
  });

  test("remote rows require an upstream, with the source's reason copy", () => {
    const noUpstream = buildCommitDropdownItems({ ...ready, hasUpstream: false });
    for (const id of ["commit-push", "commit-sync", "push"]) {
      const row = noUpstream.find((entry) => entry.id === id);
      expect(row && "disabled" in row && row.disabled).toBe(true);
      expect(row && "title" in row && row.title).toBe(
        "Upstream required. Publish your branch first.",
      );
    }
    const ff = noUpstream.find((entry) => entry.id === "fast-forward");
    expect(ff && "title" in ff && ff.title).toBe(
      "Pulling requires an upstream. Publish your branch first.",
    );
  });

  test("a running remote action disables the remote rows", () => {
    const busy = buildCommitDropdownItems({ ...ready, syncBusy: true });
    for (const id of ["push", "fast-forward", "sync", "fetch"]) {
      const row = busy.find((entry) => entry.id === id);
      expect(row && "disabled" in row && row.disabled).toBe(true);
    }
  });

  test("there is no amend row: the reference UI has none", () => {
    expect(buildCommitDropdownItems(ready).some((entry) => entry.id === "amend")).toBe(
      false,
    );
  });

  test("label helpers match the source formats", () => {
    expect(formatCountLabel("Push", 0)).toBe("Push");
    expect(formatCountLabel("Push", 3)).toBe("Push (3)");
    expect(formatSyncLabel("Sync", 0, 0)).toBe("Sync");
    expect(formatSyncLabel("Sync", 1, 2)).toBe("Sync (↓2 ↑1)");
  });
});
