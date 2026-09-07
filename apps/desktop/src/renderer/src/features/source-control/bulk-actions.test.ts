import { describe, expect, test, vi } from "vitest";
import {
  getDiscardAllPaths,
  getStageAllPaths,
  getUnstageAllPaths,
  isStageableStatusEntry,
  runDiscardAllForArea,
} from "./discard-sequence";
import type { SourceControlEntry } from "./source-control-entry";

function row(path: string, area: SourceControlEntry["area"]): SourceControlEntry {
  return { path, area, status: area === "untracked" ? "untracked" : "modified" };
}

describe("bulk action path resolution", () => {
  const entries = [row("s.txt", "staged"), row("m.txt", "unstaged"), row("u.txt", "untracked")];

  test("stage-all covers unstaged and untracked only", () => {
    expect(getStageAllPaths(entries, "unstaged")).toEqual(["m.txt"]);
    expect(getStageAllPaths(entries, "untracked")).toEqual(["u.txt"]);
    expect(isStageableStatusEntry(row("s.txt", "staged"))).toBe(false);
  });

  test("unstage-all covers staged only", () => {
    expect(getUnstageAllPaths(entries)).toEqual(["s.txt"]);
  });

  test("discard-all is scoped to its own area", () => {
    expect(getDiscardAllPaths(entries, "unstaged")).toEqual(["m.txt"]);
    expect(getDiscardAllPaths(entries, "untracked")).toEqual(["u.txt"]);
    expect(getDiscardAllPaths(entries, "staged")).toEqual(["s.txt"]);
  });
});

describe("runDiscardAllForArea", () => {
  test("continues past a stuck file and reports it", async () => {
    const onError = vi.fn();
    const result = await runDiscardAllForArea(["a.txt", "bad.txt", "c.txt"], false, {
      discardOne: async (path) => {
        if (path === "bad.txt") throw new Error("locked");
      },
      onError: (_path, error) => void onError(error),
    });
    expect(result.discarded).toEqual(["a.txt", "c.txt"]);
    expect(result.failed).toEqual(["bad.txt"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("empty path lists are a no-op", async () => {
    const discardOne = vi.fn();
    expect(await runDiscardAllForArea([], true, { discardOne })).toEqual({
      discarded: [],
      failed: [],
    });
    expect(discardOne).not.toHaveBeenCalled();
  });
});
