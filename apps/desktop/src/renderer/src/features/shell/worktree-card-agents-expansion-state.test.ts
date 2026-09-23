// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   worktree-card-agents-expansion-state behaviour: disclosure state must
   outlive a WorktreeCard remount (project collapse / sidebar rebuild),
   per worktree id, LRU-bounded, with idle entries dropped. */
import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS,
  clearWorktreeAgentExpansionStateForTests,
  getWorktreeAgentExpansionCountForTests,
  resetWorktreeAgentExpansionMemoryForTests,
  seedWorktreeAgentExpansionStateForTests,
  useWorktreeAgentExpansionState,
} from "./worktree-card-agents-expansion-state";

function fresh() {
  clearWorktreeAgentExpansionStateForTests();
}

describe("useWorktreeAgentExpansionState", () => {
  test("state survives a remount of the same worktree id", () => {
    fresh();
    const first = renderHook(() => useWorktreeAgentExpansionState("wt-1"));
    act(() => first.result.current.toggleCompactRootList());
    expect(first.result.current.compactRootListExpanded).toBe(true);
    first.unmount();
    const second = renderHook(() => useWorktreeAgentExpansionState("wt-1"));
    expect(second.result.current.compactRootListExpanded).toBe(true);
  });

  test("state is independent per worktree id", () => {
    fresh();
    const a = renderHook(() => useWorktreeAgentExpansionState("wt-a"));
    const b = renderHook(() => useWorktreeAgentExpansionState("wt-b"));
    act(() => a.result.current.toggleCompactRootList());
    expect(a.result.current.compactRootListExpanded).toBe(true);
    expect(b.result.current.compactRootListExpanded).toBe(false);
  });

  test("toggleLineageParent folds and unfolds one parent session", () => {
    fresh();
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-1"));
    act(() => hook.result.current.toggleLineageParent("s-9"));
    expect(hook.result.current.collapsedLineageParents.has("s-9")).toBe(true);
    act(() => hook.result.current.toggleLineageParent("s-9"));
    expect(hook.result.current.collapsedLineageParents.has("s-9")).toBe(false);
  });

  test("entries with no non-default state never occupy an LRU slot", () => {
    fresh();
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-quiet"));
    // Toggling twice returns to default and drops the entry.
    act(() => hook.result.current.toggleCompactRootList());
    act(() => hook.result.current.toggleCompactRootList());
    expect(getWorktreeAgentExpansionCountForTests()).toBe(0);
  });

  test("the lineage fold survives a simulated renderer reload", () => {
    fresh();
    const first = renderHook(() => useWorktreeAgentExpansionState("wt-1"));
    act(() => first.result.current.toggleLineageParent("s-9"));
    expect(first.result.current.collapsedLineageParents.has("s-9")).toBe(true);
    first.unmount();
    // A reload empties the module map but keeps localStorage.
    resetWorktreeAgentExpansionMemoryForTests();
    const second = renderHook(() => useWorktreeAgentExpansionState("wt-1"));
    expect(second.result.current.collapsedLineageParents.has("s-9")).toBe(
      true,
    );
    second.unmount();
  });

  test("folds are independent per worktree across a workspace switch and reload", () => {
    fresh();
    const a = renderHook(() => useWorktreeAgentExpansionState("wt-a"));
    act(() => a.result.current.toggleLineageParent("s-1", ["s-1"]));
    const b = renderHook(() => useWorktreeAgentExpansionState("wt-b"));
    act(() => b.result.current.toggleLineageParent("s-2", ["s-2"]));
    a.unmount();
    b.unmount();
    resetWorktreeAgentExpansionMemoryForTests();
    const a2 = renderHook(() => useWorktreeAgentExpansionState("wt-a"));
    const b2 = renderHook(() => useWorktreeAgentExpansionState("wt-b"));
    expect([...a2.result.current.collapsedLineageParents]).toEqual(["s-1"]);
    expect([...b2.result.current.collapsedLineageParents]).toEqual(["s-2"]);
    a2.unmount();
    b2.unmount();
  });

  test("a corrupt storage payload degrades to nothing collapsed", () => {
    fresh();
    localStorage.setItem(
      "drogon:shell:collapsed-lineage-parents",
      "not-json{{{",
    );
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-x"));
    expect(hook.result.current.collapsedLineageParents.size).toBe(0);
    // Folding still works afterwards — the bad payload is simply ignored.
    act(() => hook.result.current.toggleLineageParent("s-1", ["s-1"]));
    expect(hook.result.current.collapsedLineageParents.has("s-1")).toBe(true);
    hook.unmount();
  });

  test("a wrong-shaped payload keeps only clean string ids", () => {
    fresh();
    localStorage.setItem(
      "drogon:shell:collapsed-lineage-parents",
      JSON.stringify({
        "wt-x": ["s-1", 1, null, "", "s-1"],
        "": ["s-2"],
        "wt-y": "nope",
        "wt-z": [],
      }),
    );
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-x"));
    expect([...hook.result.current.collapsedLineageParents]).toEqual(["s-1"]);
    hook.unmount();
  });

  test("reads never prune; the next toggle with live ids does", () => {
    fresh();
    seedWorktreeAgentExpansionStateForTests("wt-p", {
      collapsedLineageParents: new Set(["dead-1", "live-1"]),
      compactRootListExpanded: false,
      cardFolded: false,
    });
    // A read alone never prunes, so a collapsed parent whose children
    // merely exited keeps its fold across list refreshes.
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-p"));
    expect(hook.result.current.collapsedLineageParents.has("dead-1")).toBe(
      true,
    );
    // The next toggle prunes ids of sessions that no longer exist.
    act(() =>
      hook.result.current.toggleLineageParent("live-2", ["live-1", "live-2"]),
    );
    expect(hook.result.current.collapsedLineageParents.has("dead-1")).toBe(
      false,
    );
    expect(hook.result.current.collapsedLineageParents.has("live-1")).toBe(
      true,
    );
    expect(hook.result.current.collapsedLineageParents.has("live-2")).toBe(
      true,
    );
    hook.unmount();
  });

  test("the LRU bound holds and evicts the oldest entry", () => {
    fresh();
    for (let index = 0; index < MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS + 10; index += 1) {
      seedWorktreeAgentExpansionStateForTests(`wt-${index}`, {
        collapsedLineageParents: new Set(["s"]),
        compactRootListExpanded: false,
        cardFolded: false,
      });
    }
    expect(getWorktreeAgentExpansionCountForTests()).toBe(
      MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS,
    );
    // The oldest entry was evicted; a fresh read falls back to defaults.
    const evicted = renderHook(() =>
      useWorktreeAgentExpansionState("wt-0"),
    );
    expect(evicted.result.current.collapsedLineageParents.size).toBe(0);
  });
});

describe("the card's own fold (owner's design, 2026-09-21)", () => {
  test("a folded card stays folded through a reload and never folds a sibling", () => {
    fresh();
    const first = renderHook(() => useWorktreeAgentExpansionState("wt-fold-1"));
    act(() => first.result.current.toggleCardFolded());
    expect(first.result.current.cardFolded).toBe(true);
    first.unmount();
    resetWorktreeAgentExpansionMemoryForTests();
    const reloaded = renderHook(() => useWorktreeAgentExpansionState("wt-fold-1"));
    expect(reloaded.result.current.cardFolded).toBe(true);
    const sibling = renderHook(() => useWorktreeAgentExpansionState("wt-fold-2"));
    expect(sibling.result.current.cardFolded).toBe(false);
  });

  test("unfolding writes the fold away instead of leaving a stale id", () => {
    fresh();
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-fold-3"));
    act(() => hook.result.current.toggleCardFolded());
    act(() => hook.result.current.toggleCardFolded());
    expect(hook.result.current.cardFolded).toBe(false);
    resetWorktreeAgentExpansionMemoryForTests();
    const reloaded = renderHook(() => useWorktreeAgentExpansionState("wt-fold-3"));
    expect(reloaded.result.current.cardFolded).toBe(false);
  });

  test("a folded card keeps its own lineage folds: the two folds are independent", () => {
    fresh();
    const hook = renderHook(() => useWorktreeAgentExpansionState("wt-fold-4"));
    act(() => hook.result.current.toggleLineageParent("child-1"));
    act(() => hook.result.current.toggleCardFolded());
    resetWorktreeAgentExpansionMemoryForTests();
    const reloaded = renderHook(() => useWorktreeAgentExpansionState("wt-fold-4"));
    expect(reloaded.result.current.cardFolded).toBe(true);
    expect([...reloaded.result.current.collapsedLineageParents]).toEqual([
      "child-1",
    ]);
  });

  test("corrupt or hostile folded-card storage degrades to nothing folded", () => {
    fresh();
    window.localStorage.setItem("drogon:shell:folded-worktree-cards", "{not json");
    const brokenJson = renderHook(() => useWorktreeAgentExpansionState("wt-fold-5"));
    expect(brokenJson.result.current.cardFolded).toBe(false);
    resetWorktreeAgentExpansionMemoryForTests();
    // A non-string entry never folds anything, and never throws.
    window.localStorage.setItem(
      "drogon:shell:folded-worktree-cards",
      JSON.stringify([42, null, "wt-fold-6"]),
    );
    const mixed = renderHook(() => useWorktreeAgentExpansionState("wt-fold-6"));
    expect(mixed.result.current.cardFolded).toBe(true);
    resetWorktreeAgentExpansionMemoryForTests();
    const notListed = renderHook(() => useWorktreeAgentExpansionState("other"));
    expect(notListed.result.current.cardFolded).toBe(false);
  });
});
