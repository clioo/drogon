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
  hasRemotes: true,
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
      "Publish Branch",
      "Force Push",
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
    for (const id of ["push", "publish", "force-push", "fast-forward", "sync", "fetch"]) {
      const row = busy.find((entry) => entry.id === id);
      expect(row && "disabled" in row && row.disabled).toBe(true);
    }
  });

  test("there is no amend row: the reference UI has none", () => {
    expect(buildCommitDropdownItems(ready).some((entry) => entry.id === "amend")).toBe(
      false,
    );
  });

  test("publish is enabled only without an upstream on an existing remote", () => {
    const fresh = buildCommitDropdownItems({
      ...ready,
      hasUpstream: false,
      hasRemotes: true,
    });
    const publish = fresh.find((entry) => entry.id === "publish");
    expect(publish && "disabled" in publish && publish.disabled).toBe(false);
    expect(publish && "title" in publish && publish.title).toBe(
      "Publish this branch to origin and track it as upstream",
    );
    const tracked = buildCommitDropdownItems(ready);
    const alreadyUpstream = tracked.find((entry) => entry.id === "publish");
    expect(alreadyUpstream && "disabled" in alreadyUpstream && alreadyUpstream.disabled).toBe(
      true,
    );
    expect(alreadyUpstream && "title" in alreadyUpstream && alreadyUpstream.title).toBe(
      "This branch already tracks an upstream.",
    );
    const noRemote = buildCommitDropdownItems({
      ...ready,
      hasUpstream: false,
      hasRemotes: false,
    });
    const blocked = noRemote.find((entry) => entry.id === "publish");
    expect(blocked && "disabled" in blocked && blocked.disabled).toBe(true);
    expect(blocked && "title" in blocked && blocked.title).toBe(
      "No remote configured. Add one with git remote add first.",
    );
  });

  test("force push needs an upstream and names the lease refusal", () => {
    const force = buildCommitDropdownItems(ready).find((entry) => entry.id === "force-push");
    expect(force && "disabled" in force && force.disabled).toBe(false);
    expect(force && "title" in force && force.title).toBe(
      "Rewrite the upstream branch with your local history, refusing when the remote moved first",
    );
    const noUpstream = buildCommitDropdownItems({ ...ready, hasUpstream: false });
    const blocked = noUpstream.find((entry) => entry.id === "force-push");
    expect(blocked && "disabled" in blocked && blocked.disabled).toBe(true);
    expect(blocked && "title" in blocked && blocked.title).toBe(
      "Upstream required. Publish your branch first.",
    );
  });

  test("merge pull, rebase and abort rows stay omitted by design (#332)", () => {
    // No row kind may introduce the declined operations; the full
    // actionable row set is pinned by the order test above.
    for (const entry of buildCommitDropdownItems(ready)) {
      expect(entry.kind).not.toMatch(/merge|rebase|abort/i);
    }
  });

  test("label helpers match the source formats", () => {
    expect(formatCountLabel("Push", 0)).toBe("Push");
    expect(formatCountLabel("Push", 3)).toBe("Push (3)");
    expect(formatSyncLabel("Sync", 0, 0)).toBe("Sync");
    expect(formatSyncLabel("Sync", 1, 2)).toBe("Sync (↓2 ↑1)");
  });
});
