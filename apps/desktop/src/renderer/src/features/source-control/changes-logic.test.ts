import { describe, expect, test } from "vitest";
import type { GitStatusEntry } from "../../../../shared/git-contract";
import {
  badgeFor,
  canCommit,
  groupChanges,
  groupsFor,
  hasLocalChanges,
} from "./changes-grouping";
import { parseUnifiedDiff } from "./unified-diff";

const ordinary = (staged: string, unstaged: string): GitStatusEntry => ({
  path: "a.txt",
  staged,
  unstaged,
  kind: "ordinary",
});

describe("changes grouping", () => {
  test("unstaged-only work groups unstaged (v2 dot for unmodified)", () => {
    expect(groupsFor(ordinary(".", "M"))).toEqual(["unstaged"]);
  });

  test("staged-only work groups staged", () => {
    expect(groupsFor(ordinary("M", "."))).toEqual(["staged"]);
  });

  test("dual-modified paths appear in both groups", () => {
    expect(groupsFor(ordinary("M", "M"))).toEqual(["staged", "unstaged"]);
  });

  test("untracked groups alone and conflicts never stage", () => {
    expect(groupsFor({ ...ordinary("?", "?"), kind: "untracked" })).toEqual([
      "untracked",
    ]);
    expect(groupsFor({ ...ordinary("U", "U"), kind: "unmerged" })).toEqual([
      "unstaged",
    ]);
  });

  test("ignored paths never render", () => {
    expect(groupsFor({ ...ordinary("!", "!"), kind: "ignored" })).toEqual([]);
  });

  test("renames keep their marker and group staged", () => {
    const entry: GitStatusEntry = {
      path: "b.txt",
      staged: "R",
      unstaged: ".",
      kind: "rename",
      origPath: "a.txt",
    };
    expect(groupsFor(entry)).toEqual(["staged"]);
    expect(badgeFor(entry, "staged")).toBe("R");
  });

  test("commit needs staged work; push needs any visible work", () => {
    expect(canCommit([ordinary(".", "M")])).toBe(false);
    expect(canCommit([ordinary("M", ".")])).toBe(true);
    expect(hasLocalChanges([ordinary(".", "M")])).toBe(true);
    expect(hasLocalChanges([])).toBe(false);
  });

  test("groupChanges preserves status order per group", () => {
    const grouped = groupChanges([
      { ...ordinary(".", "M"), path: "b.txt" },
      { ...ordinary("M", "."), path: "a.txt" },
    ]);
    expect(grouped.unstaged.map((e) => e.path)).toEqual(["b.txt"]);
    expect(grouped.staged.map((e) => e.path)).toEqual(["a.txt"]);
    expect(grouped.untracked).toEqual([]);
  });
});

describe("unified diff parser", () => {
  const sample = [
    "diff --git a/a.txt b/a.txt",
    "index 1111111..2222222 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,2 +1,2 @@",
    " one",
    "-old",
    "+new",
    "\\ No newline at end of file",
  ].join("\n");

  test("splits hunks and classifies lines", () => {
    const parsed = parseUnifiedDiff(sample);
    expect(parsed.truncated).toBe(false);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].header).toBe("");
    expect(parsed.hunks[0].lines.map((l) => l.kind)).toEqual([
      "file",
      "file",
      "file",
      "file",
    ]);
    expect(parsed.hunks[1].header).toBe("@@ -1,2 +1,2 @@");
    expect(parsed.hunks[1].lines.map((l) => l.kind)).toEqual([
      "context",
      "del",
      "add",
      "noeol",
    ]);
  });

  test("caps rendered lines instead of dropping them silently", () => {
    const parsed = parseUnifiedDiff(sample, 3);
    expect(parsed.truncated).toBe(true);
    expect(
      parsed.hunks.flatMap((h) => h.lines).length +
        parsed.hunks.filter((h) => h.header.startsWith("@@")).length,
    ).toBeLessThanOrEqual(3);
  });

  test("empty diff parses to no hunks", () => {
    expect(parseUnifiedDiff("")).toEqual({ hunks: [], truncated: false });
  });
});
