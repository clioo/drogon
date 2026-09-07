import { describe, expect, test, vi } from "vitest";
import type { FileBridge } from "../../../../shared/file-contract";
import {
  collectWorkspaceFiles,
  fuzzyMatchPath,
  rankQuickOpenFiles,
} from "./quick-open-matches";

describe("fuzzyMatchPath", () => {
  test("basename matches outrank directory-only matches", () => {
    const base = fuzzyMatchPath("fb", "foo/bar.ts");
    const dirOnly = fuzzyMatchPath("fb", "frobnicator/x.ts");
    expect(base).toBeGreaterThan(dirOnly);
  });

  test("consecutive and boundary matches score higher", () => {
    expect(fuzzyMatchPath("bar", "foo/bar.ts")).toBeGreaterThan(
      fuzzyMatchPath("bar", "foo/bxaexr.ts"),
    );
  });

  test("non-subsequence scores zero and empty query scores zero", () => {
    expect(fuzzyMatchPath("zzz", "foo/bar.ts")).toBe(0);
    expect(fuzzyMatchPath("", "foo/bar.ts")).toBe(0);
  });

  test("matching is case-insensitive", () => {
    expect(fuzzyMatchPath("BAR", "foo/bar.ts")).toBe(
      fuzzyMatchPath("bar", "foo/bar.ts"),
    );
  });
});

describe("rankQuickOpenFiles", () => {
  const files = [
    { path: "src/renderer/App.tsx", name: "App.tsx" },
    { path: "src/renderer/settings-panel.tsx", name: "settings-panel.tsx" },
    { path: "docs/notes.md", name: "notes.md" },
  ];

  test("empty query returns walk order with zero scores", () => {
    const ranked = rankQuickOpenFiles(files, "  ");
    expect(ranked.map((row) => row.path)).toEqual(files.map((f) => f.path));
  });

  test("best fuzzy match leads", () => {
    const ranked = rankQuickOpenFiles(files, "app");
    expect(ranked[0].path).toBe("src/renderer/App.tsx");
  });

  test("non-matching files are dropped", () => {
    const ranked = rankQuickOpenFiles(files, "app");
    expect(ranked.some((row) => row.path === "docs/notes.md")).toBe(false);
  });
});

function listing(
  path: string,
  entries: { name: string; kind: "file" | "directory" }[],
) {
  return {
    ok: true as const,
    result: {
      hostId: "h",
      workspaceId: "w",
      path,
      entries: entries.map((entry) => ({
        ...entry,
        size: 1,
        mtime: "2026-01-01T00:00:00Z",
      })),
      truncated: false,
    },
  };
}

describe("collectWorkspaceFiles", () => {
  test("walks directories breadth-first over the files.list bridge", async () => {
    const fileList = vi.fn(async ({ path }: { path: string }) => {
      if (path === ".")
        return listing(".", [
          { name: "src", kind: "directory" },
          { name: "README.md", kind: "file" },
        ]);
      return listing("src", [{ name: "index.ts", kind: "file" }]);
    });
    const bridge = { fileList } as unknown as FileBridge;
    const { files, truncated } = await collectWorkspaceFiles({
      bridge,
      scope: { hostId: "h", workspaceId: "w" },
    });
    expect(truncated).toBe(false);
    expect(files.map((f) => f.path).sort()).toEqual([
      "README.md",
      "src/index.ts",
    ]);
    expect(fileList).toHaveBeenCalledWith({
      hostId: "h",
      workspaceId: "w",
      path: ".",
      limitEntries: expect.any(Number),
    });
  });

  test("an unreadable directory is skipped without aborting the walk", async () => {
    const fileList = vi.fn(async ({ path }: { path: string }) => {
      if (path === ".")
        return listing(".", [
          { name: "locked", kind: "directory" },
          { name: "ok.md", kind: "file" },
        ]);
      return { ok: false as const, error: { message: "denied" } };
    });
    const bridge = { fileList } as unknown as FileBridge;
    const { files } = await collectWorkspaceFiles({
      bridge,
      scope: { hostId: "h", workspaceId: "w" },
    });
    expect(files.map((f) => f.path)).toEqual(["ok.md"]);
  });

  test("file cap truncates instead of growing without bound", async () => {
    const fileList = vi.fn(async ({ path }: { path: string }) =>
      listing(path, [
        { name: "a.md", kind: "file" },
        { name: "b.md", kind: "file" },
      ]),
    );
    const bridge = { fileList } as unknown as FileBridge;
    const { files, truncated } = await collectWorkspaceFiles({
      bridge,
      scope: { hostId: "h", workspaceId: "w" },
      maxFiles: 1,
    });
    expect(files).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});
