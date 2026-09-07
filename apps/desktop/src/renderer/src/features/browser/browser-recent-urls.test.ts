// Workspace-local recents: http(s) only, revisit bumps, capped, isolated.
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MAX_BROWSER_RECENT_URLS,
  readBrowserRecentUrls,
  recordBrowserRecentUrl,
} from "./browser-recent-urls";

function storage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
}

describe("browser recent URLs", () => {
  beforeEach(() => {
    storage();
  });

  test("records committed pages newest-first", () => {
    recordBrowserRecentUrl({ workspaceId: "w1", url: "https://a.test/", title: "A", now: 1 });
    recordBrowserRecentUrl({ workspaceId: "w1", url: "https://b.test/", title: "B", now: 2 });
    expect(readBrowserRecentUrls("w1").map((entry) => entry.url)).toEqual([
      "https://b.test/",
      "https://a.test/",
    ]);
  });

  test("a revisit moves to the front and bumps the visit count", () => {
    recordBrowserRecentUrl({ workspaceId: "w1", url: "https://a.test/", title: "A", now: 1 });
    recordBrowserRecentUrl({ workspaceId: "w1", url: "https://b.test/", title: "B", now: 2 });
    recordBrowserRecentUrl({ workspaceId: "w1", url: "https://a.test/", title: "A", now: 3 });
    const entries = readBrowserRecentUrls("w1");
    expect(entries[0]).toMatchObject({ url: "https://a.test/", visitCount: 2 });
    expect(entries).toHaveLength(2);
  });

  test("blank and non-http(s) URLs are never history", () => {
    recordBrowserRecentUrl({ workspaceId: "w1", url: "about:blank", title: "", now: 1 });
    recordBrowserRecentUrl({ workspaceId: "w1", url: "file:///etc/passwd", title: "x", now: 2 });
    expect(readBrowserRecentUrls("w1")).toEqual([]);
  });

  test("workspaces never share recents and the list is capped", () => {
    for (let index = 0; index < MAX_BROWSER_RECENT_URLS + 5; index += 1) {
      recordBrowserRecentUrl({
        workspaceId: "w1",
        url: `https://w1.test/${index}`,
        title: `${index}`,
        now: index,
      });
    }
    recordBrowserRecentUrl({ workspaceId: "w2", url: "https://w2.test/", title: "W2", now: 1 });
    expect(readBrowserRecentUrls("w1")).toHaveLength(MAX_BROWSER_RECENT_URLS);
    expect(readBrowserRecentUrls("w2").map((entry) => entry.url)).toEqual([
      "https://w2.test/",
    ]);
  });
});
