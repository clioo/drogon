import { describe, expect, it } from "vitest";
import {
  MENTU_TAB_ID,
  bulkCloseTargets,
  loadTabStripState,
  moveTabOrder,
  parseTabStripState,
  partitionPinnedOrder,
  reconcileTabOrder,
  remapTabOrder,
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
      editors: [],
      browsers: [],
      mentu: false,
    });
    expect(loadTabStripState(storage, "ws-1")).toEqual({
      order: ["a", "b"],
      pinned: ["a"],
      titles: { b: "Custom" },
      splits: {},
      editors: [],
      browsers: [],
      mentu: false,
    });
    expect(loadTabStripState(storage, "ws-2")).toEqual({
      order: [],
      pinned: [],
      titles: {},
      splits: {},
      editors: [],
      browsers: [],
      mentu: false,
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
      editors: [],
      browsers: [],
      mentu: false,
    });
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], pinned: ["ghost"], titles: { a: 7 } } }),
      ),
    ).toEqual({
      order: ["a"],
      pinned: [],
      titles: {},
      splits: {},
      editors: [],
      browsers: [],
      mentu: false,
    });
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
      editors: [],
      browsers: [],
      mentu: false,
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

describe("tab-strip membership (R16-AJ, fixes #215)", () => {
  it("round-trips editor paths and browser id+url records", () => {
    const storage = memStorage();
    saveTabStripState(storage, "ws-1", {
      order: ["ws-1::notes.txt", "browser-tab-1"],
      pinned: [],
      titles: {},
      splits: {},
      editors: ["notes.txt", "src/a.ts"],
      browsers: [{ tabId: "browser-tab-1", url: "https://example.com/" }],
      mentu: false,
    });
    expect(loadTabStripState(storage, "ws-1")).toEqual({
      order: ["ws-1::notes.txt", "browser-tab-1"],
      pinned: [],
      titles: {},
      splits: {},
      editors: ["notes.txt", "src/a.ts"],
      browsers: [{ tabId: "browser-tab-1", url: "https://example.com/" }],
      mentu: false,
    });
  });

  it("reads pre-membership envelopes as no restored tabs", () => {
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], pinned: [], titles: {} } }),
      ),
    ).toEqual({
      order: ["a"],
      pinned: [],
      titles: {},
      splits: {},
      editors: [],
      browsers: [],
      mentu: false,
    });
  });

  it("sanitizes membership: drops empties, overlong entries, dupes and caps the lists", () => {
    const longPath = `p/${"x".repeat(2048)}`;
    const longUrl = `https://example.com/${"y".repeat(4096)}`;
    const editors = ["a.txt", "", longPath, "a.txt", 7, null];
    const browsers = [
      { tabId: "b1", url: "https://example.com/" },
      { tabId: "", url: "https://example.com/" },
      { tabId: "b2", url: "" },
      { tabId: "b3", url: longUrl },
      { tabId: "b1", url: "https://other.example/" },
      { tabId: "b4" },
      null,
      "b5",
    ];
    const parsed = parseTabStripState(
      JSON.stringify({ state: { order: [], editors, browsers } }),
    );
    expect(parsed.editors).toEqual(["a.txt"]);
    expect(parsed.browsers).toEqual([
      { tabId: "b1", url: "https://example.com/" },
    ]);
  });

  it("caps editor and browser lists instead of growing the envelope", () => {
    const editors = Array.from({ length: 200 }, (_, i) => `file-${i}.txt`);
    const browsers = Array.from({ length: 30 }, (_, i) => ({
      tabId: `b${i}`,
      url: "https://example.com/",
    }));
    const parsed = parseTabStripState(
      JSON.stringify({ state: { order: [], editors, browsers } }),
    );
    expect(parsed.editors).toHaveLength(128);
    expect(parsed.browsers).toHaveLength(16);
  });

  it("drops non-array membership keys", () => {
    expect(
      parseTabStripState(
        JSON.stringify({
          state: { order: [], editors: "notes.txt", browsers: { b1: "x" } },
        }),
      ),
    ).toMatchObject({ editors: [], browsers: [] });
  });
});

describe("remapTabOrder", () => {
  it("rewrites mapped ids in place and passes the rest through", () => {
    expect(
      remapTabOrder(["s1", "browser-tab-1", "ws::a.txt"], {
        "browser-tab-1": "browser-tab-9",
      }),
    ).toEqual(["s1", "browser-tab-9", "ws::a.txt"]);
  });

  it("is an identity for an empty mapping", () => {
    expect(remapTabOrder(["a", "b"], {})).toEqual(["a", "b"]);
  });
});

describe("resolveTabTitle", () => {
  it("prefers the custom rename", () => {
    expect(resolveTabTitle("a", "Terminal 1", { a: "db" })).toBe("db");
    expect(resolveTabTitle("b", "Terminal 2", { a: "db" })).toBe("Terminal 2");
  });
});

// The Mentu tab's strip membership: one stable id in `order`, one boolean in
// the envelope. Reconciling must never invent the tab while it is closed and
// must keep its stored position while it is open.
describe("Mentu tab membership", () => {
  it("only admits the Mentu id while the tab is open", () => {
    expect(reconcileTabOrder(["a"], ["a"], [], [], false)).toEqual(["a"]);
    expect(reconcileTabOrder(["a"], ["a"], [], [], true)).toEqual([
      "a",
      MENTU_TAB_ID,
    ]);
    // Its stored position survives a restart, like any other tab.
    expect(
      reconcileTabOrder(
        ["a", MENTU_TAB_ID, "b"],
        ["a", "b"],
        [],
        [],
        true,
      ),
    ).toEqual(["a", MENTU_TAB_ID, "b"]);
    // A closed Mentu tab is dropped even if the stored order still has it.
    expect(
      reconcileTabOrder(["a", MENTU_TAB_ID, "b"], ["a", "b"], [], [], false),
    ).toEqual(["a", "b"]);
  });

  it("round-trips the membership flag and defaults to closed", () => {
    const storage = memStorage();
    const open = {
      order: ["a", MENTU_TAB_ID],
      pinned: [],
      titles: {},
      splits: {},
      editors: [],
      browsers: [],
      mentu: true,
    };
    saveTabStripState(storage, "ws-1", open);
    expect(loadTabStripState(storage, "ws-1").mentu).toBe(true);

    const closed = { ...open, order: ["a"], mentu: false };
    saveTabStripState(storage, "ws-2", closed);
    expect(loadTabStripState(storage, "ws-2").mentu).toBe(false);

    // Pre-Mentu envelopes and junk both hydrate to closed — never to a tab
    // the user never opened.
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], pinned: [], titles: {} } }),
      ).mentu,
    ).toBe(false);
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], mentu: "yes" } }),
      ).mentu,
    ).toBe(false);
    expect(
      parseTabStripState(
        JSON.stringify({ state: { order: ["a"], mentu: 1 } }),
      ).mentu,
    ).toBe(false);
  });

  it("the Mentu tab can be pinned and bulk-closed like any other tab", () => {
    const order = ["a", MENTU_TAB_ID, "b"];
    expect(
      togglePinnedOrder(order, [], MENTU_TAB_ID).pinned,
    ).toEqual([MENTU_TAB_ID]);
    expect(
      bulkCloseTargets(order, [MENTU_TAB_ID], "a", "others"),
    ).toEqual(["b"]);
  });
});
