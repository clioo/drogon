// MIT Copyright (c) 2026 Lovecast Inc. Tests for terminal-split.ts (the
// Split Terminal Right subset of issue #129): the two-pane state machine,
// persistence round-trip, focus routing and tab badge/title semantics.
import { describe, expect, it } from "vitest";
import {
  activateSplitPane,
  aggregateSplitAgentState,
  closeTerminalSplitPane,
  createTerminalSplit,
  equalizeTerminalSplit,
  hydrateTerminalSplits,
  isSplitPaneSession,
  migrateSplitTabIdentity,
  persistTerminalSplits,
  pruneTerminalSplits,
  replaceTerminalSplitPane,
  resizeTerminalSplit,
  sanitizeTerminalSplits,
  secondarySplitPaneIds,
  splitForTab,
  splitFractionFromClientX,
  splitRightShortcutLabel,
  splitSizesFromFirst,
  type TerminalSplitMap,
} from "./terminal-split";

describe("createTerminalSplit", () => {
  it("opens a two-pane split with focus on the new pane", () => {
    const split = createTerminalSplit("root", "second");
    expect(split.rootId).toBe("root");
    expect(split.panes).toEqual(["root", "second"]);
    expect(split.activePaneId).toBe("second");
    expect(split.sizes).toEqual([0.5, 0.5]);
  });
});

describe("focus routing", () => {
  const splits: TerminalSplitMap = {
    root: {
      rootId: "root",
      panes: ["root", "second"],
      activePaneId: "second",
      sizes: [0.5, 0.5],
    },
  };

  it("moves the active pane on explicit focus", () => {
    const next = activateSplitPane(splits, "root", "root");
    expect(next.root.activePaneId).toBe("root");
  });

  it("ignores focus for unknown tabs and panes", () => {
    expect(activateSplitPane(splits, "missing", "root")).toBe(splits);
    expect(activateSplitPane(splits, "root", "ghost")).toBe(splits);
  });

  it("resolves the split for its tab only", () => {
    expect(splitForTab(splits, "root")?.panes).toEqual(["root", "second"]);
    expect(splitForTab(splits, "other")).toBeNull();
  });

  it("marks both panes as split members", () => {
    expect(isSplitPaneSession(splits, "root")).toBe(true);
    expect(isSplitPaneSession(splits, "second")).toBe(true);
    expect(isSplitPaneSession(splits, "other")).toBe(false);
  });

  it("hides the second pane id from the tab strip", () => {
    expect([...secondarySplitPaneIds(splits)]).toEqual(["second"]);
  });
});

describe("resize", () => {
  const splits: TerminalSplitMap = {
    root: {
      rootId: "root",
      panes: ["root", "second"],
      activePaneId: "root",
      sizes: [0.5, 0.5],
    },
  };

  it("clamps dragged sizes to the fork bounds", () => {
    expect(resizeTerminalSplit(splits, "root", 0.05).root.sizes).toEqual([
      0.2, 0.8,
    ]);
    expect(resizeTerminalSplit(splits, "root", 0.95).root.sizes).toEqual([
      0.8, 0.2,
    ]);
    expect(resizeTerminalSplit(splits, "root", 0.3).root.sizes).toEqual([
      0.3, 0.7,
    ]);
  });

  it("equalizes back to halves", () => {
    const resized = resizeTerminalSplit(splits, "root", 0.7);
    expect(equalizeTerminalSplit(resized, "root").root.sizes).toEqual([
      0.5, 0.5,
    ]);
  });

  it("converts pointer positions to clamped fractions", () => {
    expect(splitFractionFromClientX(100, 800, 500)).toBeCloseTo(0.5);
    expect(splitFractionFromClientX(100, 800, 0)).toBe(0.2);
    expect(splitFractionFromClientX(100, 0, 500)).toBe(0.5);
    expect(splitSizesFromFirst(Number.NaN)).toEqual([0.5, 0.5]);
  });
});

describe("closeTerminalSplitPane", () => {
  const splits: TerminalSplitMap = {
    root: {
      rootId: "root",
      panes: ["root", "second"],
      activePaneId: "second",
      sizes: [0.6, 0.4],
    },
  };

  it("closing the second pane keeps the root tab", () => {
    const outcome = closeTerminalSplitPane(splits, "second");
    expect(outcome.splits).toEqual({});
    expect(outcome.survivorId).toBe("root");
    expect(outcome.dissolvedRoot).toBe("root");
  });

  it("closing the root promotes the survivor", () => {
    const outcome = closeTerminalSplitPane(splits, "root");
    expect(outcome.splits).toEqual({});
    expect(outcome.survivorId).toBe("second");
    expect(outcome.dissolvedRoot).toBe("root");
  });

  it("leaves non-members untouched", () => {
    const outcome = closeTerminalSplitPane(splits, "ghost");
    expect(outcome.splits).toBe(splits);
    expect(outcome.survivorId).toBeNull();
  });
});

describe("replaceTerminalSplitPane", () => {
  const splits: TerminalSplitMap = {
    root: {
      rootId: "root",
      panes: ["root", "second"],
      activePaneId: "second",
      sizes: [0.5, 0.5],
    },
  };

  it("swaps the restarted pane slot and keeps the tab root", () => {
    const next = replaceTerminalSplitPane(splits, "second", "third");
    expect(next.root.panes).toEqual(["root", "third"]);
    expect(next.root.activePaneId).toBe("third");
    expect(next.root.rootId).toBe("root");
  });

  it("leaves focus alone when another pane restarts", () => {
    const next = replaceTerminalSplitPane(splits, "root", "fresh");
    expect(next.root.panes).toEqual(["fresh", "second"]);
    expect(next.root.activePaneId).toBe("second");
  });
});

describe("persistence", () => {
  it("round-trips through the tab-strip envelope", () => {
    const splits: TerminalSplitMap = {
      root: {
        rootId: "root",
        panes: ["root", "second"],
        activePaneId: "second",
        sizes: [0.6, 0.4],
      },
    };
    const persisted = persistTerminalSplits(splits);
    expect(sanitizeTerminalSplits(JSON.parse(JSON.stringify(persisted)))).toEqual(
      persisted,
    );
    expect(hydrateTerminalSplits(persisted)).toEqual(splits);
  });

  it("hydrates missing focus and sizes with fork defaults", () => {
    const hydrated = hydrateTerminalSplits({ root: { panes: ["root", "s2"] } });
    expect(hydrated.root.activePaneId).toBe("root");
    expect(hydrated.root.sizes).toEqual([0.5, 0.5]);
  });

  it("rejects malformed envelopes without inventing splits", () => {
    expect(sanitizeTerminalSplits(null)).toEqual({});
    expect(sanitizeTerminalSplits([])).toEqual({});
    expect(
      sanitizeTerminalSplits({
        root: { panes: ["root", "root"] },
        other: { panes: ["other"] },
        mismatched: { panes: ["a", "b"] },
        ghost: { panes: ["", "b"] },
      }),
    ).toEqual({});
  });

  it("prunes splits whose daemon sessions are gone", () => {
    const splits: TerminalSplitMap = {
      alive: {
        rootId: "alive",
        panes: ["alive", "alive-2"],
        activePaneId: "alive-2",
        sizes: [0.5, 0.5],
      },
      stale: {
        rootId: "stale",
        panes: ["stale", "gone"],
        activePaneId: "gone",
        sizes: [0.5, 0.5],
      },
    };
    const pruned = pruneTerminalSplits(
      splits,
      new Set(["alive", "alive-2", "stale"]),
    );
    expect(Object.keys(pruned)).toEqual(["alive"]);
    expect(pruned.alive).toBe(splits.alive);
  });
});

describe("tab title and badge semantics", () => {
  it("aggregates the badge to the hottest pane state", () => {
    expect(aggregateSplitAgentState("idle", "working")).toBe("working");
    expect(aggregateSplitAgentState("working", "needs_input")).toBe(
      "needs_input",
    );
    expect(aggregateSplitAgentState("needs_input", "idle")).toBe("needs_input");
    expect(aggregateSplitAgentState("idle", "idle")).toBe("idle");
    expect(aggregateSplitAgentState("unknown", "exited")).toBe("exited");
  });

  it("migrates strip identity when the survivor is promoted", () => {
    const next = migrateSplitTabIdentity(
      { order: ["a", "root", "b"], pinned: ["root"], titles: { root: "Mine" } },
      "root",
      "second",
    );
    expect(next.order).toEqual(["a", "second", "b"]);
    expect(next.pinned).toEqual(["second"]);
    expect(next.titles).toEqual({ second: "Mine" });
  });

  it("keeps the survivor rename when both panes were renamed", () => {
    const next = migrateSplitTabIdentity(
      { order: ["root"], pinned: [], titles: { root: "Old", second: "New" } },
      "root",
      "second",
    );
    expect(next.titles).toEqual({ second: "New" });
  });
});

describe("splitRightShortcutLabel", () => {
  it("mirrors the fork chords per platform", () => {
    expect(splitRightShortcutLabel(true)).toBe("⌘D");
    expect(splitRightShortcutLabel(false)).toBe("Ctrl+Shift+D");
  });
});
