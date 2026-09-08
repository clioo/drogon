// @vitest-environment jsdom
/* Tasks persisted seed (R16-BF): last session's rows survive a renderer
   restart in localStorage so the next cold open paints instantly and
   revalidates underneath. Corrupt entries, foreign shapes, quota failures
   and overgrowth must never throw or leak across keys. */

import { afterEach, describe, expect, test } from "vitest";
import {
  clearTasksPageSeedStorage,
  readTasksPageSeed,
  writeTasksPageSeed,
} from "./tasks-page-seed-storage";
import type { TasksPageCacheKey } from "./TasksPage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function key(overrides: Partial<TasksPageCacheKey> = {}): TasksPageCacheKey {
  return {
    projectId: "p1",
    kind: "issues",
    state: "open",
    query: undefined,
    page: 1,
    source: "auto",
    ...overrides,
  };
}

function result() {
  return { repo: "example/repo", workItems: [], hasNextPage: false, furthestPage: 1 };
}

afterEach(() => {
  clearTasksPageSeedStorage();
});

describe("tasks page seed storage", () => {
  test("round-trips one result per request key", () => {
    const storage = memoryStorage();
    writeTasksPageSeed(key(), { repo: "r", workItems: [], hasNextPage: true, furthestPage: 2 }, storage);
    expect(readTasksPageSeed(key(), storage)).toMatchObject({ repo: "r", hasNextPage: true });
    expect(readTasksPageSeed(key({ page: 2 }), storage)).toBeUndefined();
    expect(readTasksPageSeed(key({ projectId: "p2" }), storage)).toBeUndefined();
  });

  test("corrupt or foreign-shaped entries read as absent", () => {
    const storage = memoryStorage();
    storage.setItem("drogon:tasks-page-seeds:v1", "{not json");
    expect(readTasksPageSeed(key(), storage)).toBeUndefined();
    storage.setItem("drogon:tasks-page-seeds:v1", JSON.stringify({ "p1|issues|open||1|auto": { savedAt: 1, result: { workItems: [{ nope: true }] } } }));
    expect(readTasksPageSeed(key(), storage)).toBeUndefined();
  });

  test("a throwing storage never propagates", () => {
    const failing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(readTasksPageSeed(key(), failing)).toBeUndefined();
    expect(() => writeTasksPageSeed(key(), result(), failing)).not.toThrow();
    expect(() => clearTasksPageSeedStorage(failing)).not.toThrow();
  });

  test("entries stay bounded", () => {
    const storage = memoryStorage();
    for (let page = 1; page <= 80; page++) {
      writeTasksPageSeed(key({ page }), result(), storage);
    }
    const raw = JSON.parse(storage.getItem("drogon:tasks-page-seeds:v1")!);
    expect(Object.keys(raw).length).toBeLessThanOrEqual(64);
    // Newest survives the eviction.
    expect(readTasksPageSeed(key({ page: 80 }), storage)).toBeDefined();
  });
});
