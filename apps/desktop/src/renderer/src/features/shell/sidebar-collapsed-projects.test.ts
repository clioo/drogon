// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Storage adapter tests for the
   collapsed project sections (the fork's collapsedWorktreeGroups store
   slice, adapted to localStorage like sidebar-order.ts). */
import { describe, expect, test } from "vitest";
import {
  loadCollapsedProjectIds,
  saveCollapsedProjectIds,
} from "./sidebar-collapsed-projects";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("collapsed project sections storage", () => {
  test("round-trips the collapsed ids", () => {
    const storage = memoryStorage();
    saveCollapsedProjectIds(storage, ["p-2", "p-1"]);
    expect(loadCollapsedProjectIds(storage)).toEqual(["p-2", "p-1"]);
  });

  test("an empty storage reads empty", () => {
    expect(loadCollapsedProjectIds(memoryStorage())).toEqual([]);
  });

  test("corrupt JSON reads empty instead of throwing", () => {
    expect(
      loadCollapsedProjectIds(memoryStorage({ "drogon:shell:collapsed-projects": "{nope" })),
    ).toEqual([]);
  });

  test("non-string entries are dropped, not trusted", () => {
    expect(
      loadCollapsedProjectIds(
        memoryStorage({
          "drogon:shell:collapsed-projects": '["p-1", 7, null, "p-2"]',
        }),
      ),
    ).toEqual(["p-1", "p-2"]);
  });

  test("a failed write is swallowed (collapse state is cosmetic)", () => {
    const quota: Pick<Storage, "setItem"> = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    saveCollapsedProjectIds(quota, ["p-1"]);
  });
});
