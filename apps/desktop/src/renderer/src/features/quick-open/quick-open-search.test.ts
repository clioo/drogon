// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/quick-open-search.test.ts (natural order and
// score 0 for empty queries, filename-over-path ranking, limit bounding,
// oversized-query rejection), adapted to the local search API.
import { describe, expect, test } from "vitest";
import {
  applyQuickOpenRecency,
  getPreparedQuickOpenFiles,
  isQuickOpenQueryTooLarge,
  loadQuickOpenRecentFiles,
  normalizeQuickOpenQuery,
  prepareQuickOpenFiles,
  rankQuickOpenFiles,
  recordQuickOpenRecentFile,
  splitQuickOpenPath,
} from "./quick-open-search";

const FILES = [
  "src/components/App.tsx",
  "src/renderer/quick-open.ts",
  "README.md",
  "foo/bar.ts",
  "frobnicator/x.ts",
];

function indexed() {
  return prepareQuickOpenFiles(FILES);
}

describe("rankQuickOpenFiles", () => {
  test("empty query returns natural filename order with score 0", () => {
    const files = prepareQuickOpenFiles(["songs/100 - b.txt", "songs/9 - c.txt"]);
    expect(rankQuickOpenFiles("", files).map((row) => row.path)).toEqual([
      "songs/9 - c.txt",
      "songs/100 - b.txt",
    ]);
    expect(rankQuickOpenFiles("   ", indexed(), 100)).toHaveLength(FILES.length);
    expect(
      rankQuickOpenFiles("   ", indexed(), 100).every((row) => row.score === 0),
    ).toBe(true);
  });

  test("boundary and filename matches rank first", () => {
    const ranked = rankQuickOpenFiles("fb", indexed(), 10).map((row) => row.path);
    // foo/bar.ts matches on boundaries; the long frobnicator path trails.
    expect(ranked[0]).toBe("foo/bar.ts");
    expect(ranked).toContain("frobnicator/x.ts");
  });

  test("full filename match wins", () => {
    const ranked = rankQuickOpenFiles("quick-open", indexed(), 10);
    expect(ranked[0].path).toBe("src/renderer/quick-open.ts");
  });

  test("non-matching queries return nothing", () => {
    expect(rankQuickOpenFiles("zzz-nope", indexed(), 10)).toEqual([]);
  });

  test("limit bounds the result set", () => {
    expect(rankQuickOpenFiles("", indexed(), 2)).toHaveLength(2);
    expect(rankQuickOpenFiles("zzz-nope", indexed(), 0)).toEqual([]);
  });

  test("oversized queries match nothing", () => {
    expect(isQuickOpenQueryTooLarge("x".repeat(3 * 1024))).toBe(true);
    expect(rankQuickOpenFiles("x".repeat(3 * 1024), indexed(), 10)).toEqual([]);
  });

  test("query normalization trims and lowercases", () => {
    expect(normalizeQuickOpenQuery("  App.TSX ")).toBe("app.tsx");
  });

  test("prepared index is cached per array identity", () => {
    const files = [...FILES];
    expect(getPreparedQuickOpenFiles(files)).toBe(getPreparedQuickOpenFiles(files));
  });
});

describe("splitQuickOpenPath", () => {
  test("splits dir and name for dimmed rendering", () => {
    expect(splitQuickOpenPath("src/components/App.tsx")).toEqual({
      dir: "src/components/",
      name: "App.tsx",
    });
    expect(splitQuickOpenPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });
});

describe("quick open recency", () => {
  function storage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
  }

  test("recent files lead the empty-query list", () => {
    const ordered = applyQuickOpenRecency(FILES, ["foo/bar.ts", "README.md"]);
    expect(ordered.slice(0, 2)).toEqual(["foo/bar.ts", "README.md"]);
    expect(ordered).toHaveLength(FILES.length);
  });

  test("unknown recents are ignored", () => {
    expect(applyQuickOpenRecency(FILES, ["gone.txt"])).toEqual(FILES);
  });

  test("record round-trips through storage most-recent-first", () => {
    const store = storage();
    recordQuickOpenRecentFile(store, "ws-1", "a.ts");
    recordQuickOpenRecentFile(store, "ws-1", "b.ts");
    recordQuickOpenRecentFile(store, "ws-1", "a.ts");
    expect(loadQuickOpenRecentFiles(store, "ws-1")).toEqual(["a.ts", "b.ts"]);
    expect(loadQuickOpenRecentFiles(store, "ws-2")).toEqual([]);
  });
});
