import { describe, expect, it } from "vitest";
import {
  bulkCloseTargets,
  loadTabStripState,
  moveTabOrder,
  parseTabStripState,
  partitionPinnedOrder,
  reconcileTabOrder,
  resolveTabTitle,
  saveTabStripState,
  shiftTabOrder,
  tabStripStorageKey,
  togglePinnedOrder,
} from "./tab-order";

function memStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("reconcileTabOrder", () => {
  it("keeps stored positions and appends new tabs at the end", () => {
    expect(reconcileTabOrder(["b", "a"], ["a", "b", "c"], ["d"])).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("drops stored ids that no longer exist and dedupes stale doubles", () => {
    expect(reconcileTabOrder(["a", "gone", "a", "b"], ["a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("starts from natural order without stored state", () => {
    expect(reconcileTabOrder(undefined, ["s1", "s2"], ["b1"])).toEqual([
      "s1",
      "s2",
      "b1",
    ]);
  });

  it("keeps stored positions for editor (file) tabs alongside sessions and browser tabs", () => {
    expect(
      reconcileTabOrder(
        ["src/b.ts", "s1", "src/a.ts"],
        ["s1"],
        ["b1"],
        ["src/a.ts", "src/b.ts"],
      ),
    ).toEqual(["src/b.ts", "s1", "src/a.ts", "b1"]);
  });

  it("drops a closed editor tab id and appends a newly opened one", () => {
    expect(
      reconcileTabOrder(["src/a.ts", "s1"], ["s1"], [], ["src/b.ts"]),
    ).toEqual(["s1", "src/b.ts"]);
  });
});

describe("moveTabOrder", () => {
  it("moves the active tab onto the over tab", () => {
    expect(moveTabOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveTabOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("is a no-op for unknown ids or a self drop", () => {
    expect(moveTabOrder(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveTabOrder(["a", "b"], "a", "missing")).toEqual(["a", "b"]);
  });
});

describe("shiftTabOrder", () => {
  it("moves by a signed delta and clamps at the ends", () => {
    expect(shiftTabOrder(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(shiftTabOrder(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(shiftTabOrder(["a", "b", "c"], "c", 5)).toEqual(["a", "b", "c"]);
  });
});

describe("pinned ordering", () => {
  it("renders pinned tabs first in stored relative order", () => {
    expect(partitionPinnedOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("pinning lands the tab at the end of the pinned block", () => {
    expect(togglePinnedOrder(["a", "b", "c"], ["a"], "c")).toEqual({
      order: ["a", "c", "b"],
      pinned: ["a", "c"],
    });
  });

  it("unpinning keeps the tab in place among unpinned tabs", () => {
    expect(togglePinnedOrder(["a", "c", "b"], ["a", "c"], "a")).toEqual({
      order: ["c", "a", "b"],
      pinned: ["c"],
    });
  });
});

describe("bulkCloseTargets", () => {
  const order = ["p", "a", "b", "c"];
  const pinned = ["p"];

  it("close others skips the anchor and pinned tabs", () => {
    expect(bulkCloseTargets(order, pinned, "a", "others")).toEqual(["b", "c"]);
  });

  it("close to the right/left follows strip order without pinned tabs", () => {
    expect(bulkCloseTargets(order, pinned, "a", "to-right")).toEqual([
      "b",
      "c",
    ]);
    expect(bulkCloseTargets(order, pinned, "c", "to-left")).toEqual(["a", "b"]);
  });

  it("returns nothing for an unknown anchor", () => {
    expect(bulkCloseTargets(order, pinned, "missing", "others")).toEqual([]);
  });
});

describe("tab-strip persistence", () => {
  it("round-trips order, pins and titles per workspace", () => {
    const storage = memStorage();
    saveTabStripState(storage, "ws-1", {
      order: ["a", "b"],
      pinned: ["a"],
      titles: { b: "Custom" },
      splits: {},
    });
    expect(loadTabStripState(storage, "ws-1")).toEqual({
      order: ["a", "b"],
      pinned: ["a"],
      titles: { b: "Custom" },
      splits: {},
    });
    expect(loadTabStripState(storage, "ws-2")).toEqual({
      order: [],
      pinned: [],
      titles: {},
      splits: {},
    });
  });

  it("uses one envelope key per workspace", () => {
    expect(tabStripStorageKey("ws-1")).toBe("drogon:tab-strip:ws-1");
  });

  it("drops malformed envelopes and pins for unknown tabs", () => {
    expect(parseTabStripState("not json")).toEqual({
      order: [],
      pinned: [],
      titles: {},
      splits: {},
    });
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], pinned: ["ghost"], titles: { a: 7 } } }),
      ),
    ).toEqual({ order: ["a"], pinned: [], titles: {}, splits: {} });
  });

  it("round-trips splits additively and reads pre-split envelopes", () => {
    const storage = memStorage();
    saveTabStripState(storage, "ws-1", {
      order: ["a"],
      pinned: [],
      titles: {},
      splits: {
        a: { panes: ["a", "b"], active: "b", sizes: [0.6, 0.4] },
      },
    });
    expect(loadTabStripState(storage, "ws-1").splits).toEqual({
      a: { panes: ["a", "b"], active: "b", sizes: [0.6, 0.4] },
    });
    // Pre-split envelopes (no splits key) hydrate to no splits.
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], pinned: [], titles: {} } }),
      ).splits,
    ).toEqual({});
    // Malformed splits never survive the boundary.
    expect(
      parseTabStripState(
        JSON.stringify({
          state: { order: ["a"], pinned: [], titles: {}, splits: { a: { panes: ["a", "a"] } } },
        }),
      ).splits,
    ).toEqual({});
  });
});

describe("resolveTabTitle", () => {
  it("prefers the custom rename", () => {
    expect(resolveTabTitle("a", "Terminal 1", { a: "db" })).toBe("db");
    expect(resolveTabTitle("b", "Terminal 2", { a: "db" })).toBe("Terminal 2");
  });
});
