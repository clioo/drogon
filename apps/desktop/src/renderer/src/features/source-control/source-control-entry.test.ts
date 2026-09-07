import { describe, expect, test } from "vitest";
import type { GitStatusEntry } from "../../../../shared/git-contract";
import {
  canCommitEntries,
  rowKey,
  rowsForEntry,
  STATUS_LABELS,
} from "./source-control-entry";

function ordinary(overrides: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return { path: "a.txt", staged: ".", unstaged: "M", kind: "ordinary", ...overrides };
}

describe("rowsForEntry", () => {
  test("a both-sides change yields a staged and an unstaged row", () => {
    const rows = rowsForEntry(ordinary({ staged: "M", unstaged: "M" }));
    expect(rows.map((row) => row.area)).toEqual(["staged", "unstaged"]);
    expect(rows[0].status).toBe("modified");
  });

  test("untracked paths yield one untracked row with line counts", () => {
    const rows = rowsForEntry(
      ordinary({ path: "new.txt", staged: "?", unstaged: "?", kind: "untracked" }),
      { path: "new.txt", stagedAdded: null, stagedRemoved: null, unstagedAdded: 4, unstagedRemoved: 0 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].area).toBe("untracked");
    expect(rows[0].status).toBe("untracked");
    expect(rows[0].added).toBe(4);
  });

  test("ignored paths never render", () => {
    expect(rowsForEntry(ordinary({ kind: "ignored" }))).toEqual([]);
  });

  test("renames keep their origin path and letter", () => {
    const rows = rowsForEntry(
      ordinary({ path: "b.txt", staged: "R", unstaged: ".", kind: "rename", origPath: "a.txt" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("renamed");
    expect(rows[0].origPath).toBe("a.txt");
  });

  test("staged counts attach to staged rows, unstaged to unstaged rows", () => {
    const rows = rowsForEntry(ordinary({ staged: "M", unstaged: "M" }), {
      path: "a.txt",
      stagedAdded: 2,
      stagedRemoved: 1,
      unstagedAdded: 5,
      unstagedRemoved: 0,
    });
    expect(rows[0].added).toBe(2);
    expect(rows[0].removed).toBe(1);
    expect(rows[1].added).toBe(5);
  });
});

describe("row status letters", () => {
  test("letters match the source palette", () => {
    expect(STATUS_LABELS).toEqual({
      modified: "M",
      added: "A",
      deleted: "D",
      renamed: "R",
      untracked: "U",
      copied: "C",
    });
  });

  test("row keys scope paths by area", () => {
    expect(rowKey("staged", "a.txt")).toBe("staged::a.txt");
    expect(rowKey("unstaged", "a.txt")).not.toBe(rowKey("staged", "a.txt"));
  });

  test("commit needs at least one staged row", () => {
    expect(canCommitEntries([{ path: "a.txt", area: "unstaged", status: "modified" }])).toBe(false);
    expect(canCommitEntries([{ path: "a.txt", area: "staged", status: "modified" }])).toBe(true);
  });
});
