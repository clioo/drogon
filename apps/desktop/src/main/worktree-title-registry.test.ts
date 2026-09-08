import { describe, expect, test } from "vitest";
// Production import order (main/index.ts): the project bridge registers
// first, the tasks bridge second and overwrites the shared native
// registry's `worktree.list` entry. Whichever bridge writes last must
// still preserve the rename title — zod strips unknown keys, so a
// title-less schema here silently drops it for BOTH bridges (the
// first-class `drogon:worktreeList` loses the inline-rename title even
// though the daemon returned it).
import "./project-bridge";
import "./tasks-bridge";
import { resultSchemas } from "../shared/result-validation";

const daemonList = {
  worktrees: [
    {
      id: "t1",
      projectId: "p1",
      workspaceId: "w9",
      path: "/data/repo/demo-a",
      branch: "demo-a",
      head: "abc",
      baseRef: null,
      title: "ZQ",
      createdAt: "2026-09-07T00:00:00Z",
    },
  ],
};

describe("shared native worktree.list registry entry", () => {
  test("preserves the rename title after all main bridges load", () => {
    const schema =
      resultSchemas["worktree.list" as keyof typeof resultSchemas];
    expect(schema.parse(daemonList)).toEqual(daemonList);
  });

  test("accepts an unset title (never renamed) as explicit null", () => {
    const schema =
      resultSchemas["worktree.list" as keyof typeof resultSchemas];
    const withoutTitle = {
      worktrees: [{ ...daemonList.worktrees[0], title: null }],
    };
    expect(schema.parse(withoutTitle)).toEqual(withoutTitle);
  });
});
