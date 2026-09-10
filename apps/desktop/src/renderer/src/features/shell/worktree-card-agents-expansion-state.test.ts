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

  test("the LRU bound holds and evicts the oldest entry", () => {
    fresh();
    for (let index = 0; index < MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS + 10; index += 1) {
      seedWorktreeAgentExpansionStateForTests(`wt-${index}`, {
        collapsedLineageParents: new Set(["s"]),
        compactRootListExpanded: false,
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
