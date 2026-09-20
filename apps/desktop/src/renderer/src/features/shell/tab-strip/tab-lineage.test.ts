// Issue #606: the tab strip's half of the subagent grouping — contiguous
// groups, a fold that hides a whole subtree, and the prompt coming back to
// the leader while its subagents are hidden.
import { describe, expect, it } from "vitest";
import {
  buildTabStripLineage,
  foldAwareBulkCloseTargets,
  resolveTabPromptTarget,
  toggleCollapsedLeader,
  type TabLineageSession,
} from "./tab-lineage";

function sessions(
  ...pairs: [string, string | null][]
): TabLineageSession[] {
  return pairs.map(([id, parentSessionId]) => ({ id, parentSessionId }));
}

describe("buildTabStripLineage", () => {
  it("pulls subagents to their leader, wherever the stored order left them", () => {
    const lineage = buildTabStripLineage({
      // The fan-out landed three tabs at the end of the strip, with an
      // unrelated session and a browser tab in between.
      order: ["lead", "solo", "browser-1", "kid-2", "kid-1"],
      sessions: sessions(
        ["lead", null],
        ["solo", null],
        ["kid-1", "lead"],
        ["kid-2", "lead"],
      ),
    });
    expect(lineage.order).toEqual([
      "lead",
      "kid-2",
      "kid-1",
      "solo",
      "browser-1",
    ]);
    expect(lineage.visibleOrder).toEqual(lineage.order);
    // Children keep the relative order the strip gave them, so a group
    // does not silently re-sort itself when it becomes contiguous.
    expect(lineage.childrenByLeaderId.get("lead")).toEqual(["kid-2", "kid-1"]);
    expect(lineage.depthById.get("kid-1")).toBe(1);
    expect(lineage.depthById.get("lead")).toBe(0);
    expect(lineage.depthById.get("solo")).toBe(0);
  });

  it("nests a grandchild under its own parent, not the top leader", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid", "grandkid"],
      sessions: sessions(
        ["lead", null],
        ["kid", "lead"],
        ["grandkid", "kid"],
      ),
    });
    expect(lineage.childrenByLeaderId.get("lead")).toEqual(["kid"]);
    expect(lineage.childrenByLeaderId.get("kid")).toEqual(["grandkid"]);
    expect(lineage.descendantsByLeaderId.get("lead")).toEqual([
      "kid",
      "grandkid",
    ]);
    expect(lineage.depthById.get("grandkid")).toBe(2);
  });

  it("hides every descendant of a collapsed leader, and only those", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid", "grandkid", "solo"],
      sessions: sessions(
        ["lead", null],
        ["kid", "lead"],
        ["grandkid", "kid"],
        ["solo", null],
      ),
      collapsedLeaderIds: ["lead"],
    });
    expect(lineage.visibleOrder).toEqual(["lead", "solo"]);
    expect(lineage.hiddenBy.get("kid")).toBe("lead");
    expect(lineage.hiddenBy.get("grandkid")).toBe("lead");
    expect(lineage.hiddenBy.has("solo")).toBe(false);
    expect(lineage.hiddenBy.has("lead")).toBe(false);
  });

  it("credits a nested fold to the outermost collapsed leader", () => {
    // Both are folded: unfolding `lead` must reveal `kid` — whose own fold
    // then still holds `grandkid` — rather than leaving `grandkid` owned by
    // a leader that is itself off the strip.
    const lineage = buildTabStripLineage({
      order: ["lead", "kid", "grandkid"],
      sessions: sessions(
        ["lead", null],
        ["kid", "lead"],
        ["grandkid", "kid"],
      ),
      collapsedLeaderIds: ["lead", "kid"],
    });
    expect(lineage.visibleOrder).toEqual(["lead"]);
    expect(lineage.hiddenBy.get("grandkid")).toBe("lead");
  });

  it("collapsing a leader with no children hides nothing", () => {
    const lineage = buildTabStripLineage({
      order: ["solo"],
      sessions: sessions(["solo", null]),
      collapsedLeaderIds: ["solo"],
    });
    expect(lineage.visibleOrder).toEqual(["solo"]);
    expect(lineage.hiddenBy.size).toBe(0);
  });

  it("leaves a subagent flat when its leader holds no strip tab", () => {
    // The card's dangling-parent rule: a fold could otherwise hide a tab
    // with no leader on screen to unfold it again.
    const lineage = buildTabStripLineage({
      order: ["orphan"],
      sessions: sessions(["orphan", "closed-leader"]),
      collapsedLeaderIds: ["closed-leader"],
    });
    expect(lineage.visibleOrder).toEqual(["orphan"]);
    expect(lineage.childrenByLeaderId.size).toBe(0);
  });

  it("keeps every tab visible when the lineage closes a cycle", () => {
    const lineage = buildTabStripLineage({
      order: ["a", "b"],
      sessions: sessions(["a", "b"], ["b", "a"]),
      collapsedLeaderIds: ["a", "b"],
    });
    expect(new Set(lineage.visibleOrder)).toEqual(new Set(["a", "b"]));
  });

  it("passes non-session tabs through untouched", () => {
    const lineage = buildTabStripLineage({
      order: ["browser-1", "ws::notes.md", "mentu-tab"],
      sessions: [],
    });
    expect(lineage.visibleOrder).toEqual([
      "browser-1",
      "ws::notes.md",
      "mentu-tab",
    ]);
  });

  it("never emits an id twice, even from a duplicated stored order", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid", "lead", "kid"],
      sessions: sessions(["lead", null], ["kid", "lead"]),
    });
    expect(lineage.order).toEqual(["lead", "kid"]);
  });
});

describe("group integrity (adversarial review of #613)", () => {
  it("re-attaches a child dragged out of its group, by design", () => {
    // A drag writes the flat order; grouping owns adjacency, so a child
    // dropped outside its group comes back beside its leader rather than
    // leaving the group scattered across the strip. Pinned here so the
    // behaviour is a decision on record, not an accident.
    const dragged = buildTabStripLineage({
      order: ["lead", "solo", "kid"],
      sessions: sessions(["lead", null], ["solo", null], ["kid", "lead"]),
    });
    expect(dragged.order).toEqual(["lead", "kid", "solo"]);
  });

  it("frees a folded group when its leader loses its tab", () => {
    // Closing the leader must not strand its subagents behind a fold with
    // nothing left to unfold them: they become visible roots.
    const orphaned = buildTabStripLineage({
      order: ["kid-1", "kid-2", "solo"],
      sessions: sessions(
        ["kid-1", "lead"],
        ["kid-2", "lead"],
        ["solo", null],
      ),
      collapsedLeaderIds: ["lead"],
    });
    expect(orphaned.visibleOrder).toEqual(["kid-1", "kid-2", "solo"]);
    expect(orphaned.hiddenBy.size).toBe(0);
  });
});

describe("pinned groups (adversarial review of #613)", () => {
  // The caller partitions pins over the FLAT order, before grouping. Without
  // a second, group-granular partition a pinned leader's unpinned subagents
  // end up seated inside the pinned run.
  it("carries a pinned leader's whole group to the front", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "solo", "kid"],
      sessions: sessions(["lead", null], ["solo", null], ["kid", "lead"]),
      pinnedIds: ["lead"],
    });
    expect(lineage.order).toEqual(["lead", "kid", "solo"]);
    expect(lineage.rootBySessionId.get("kid")).toBe("lead");
    expect(lineage.rootBySessionId.get("solo")).toBe("solo");
  });

  it("never seats an unpinned group inside the pinned run", () => {
    const lineage = buildTabStripLineage({
      // `solo` is pinned, the leader is not: the leader's group must stay
      // behind it as one block, not straddle the boundary.
      order: ["lead", "kid-1", "solo", "kid-2"],
      sessions: sessions(
        ["lead", null],
        ["kid-1", "lead"],
        ["solo", null],
        ["kid-2", "lead"],
      ),
      pinnedIds: ["solo"],
    });
    expect(lineage.order).toEqual(["solo", "lead", "kid-1", "kid-2"]);
  });

  it("pins a browser or editor tab like the singleton it is", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid", "browser-1"],
      sessions: sessions(["lead", null], ["kid", "lead"]),
      pinnedIds: ["browser-1"],
    });
    expect(lineage.order).toEqual(["browser-1", "lead", "kid"]);
  });
});

describe("resolveTabPromptTarget", () => {
  it("hands the prompt to the leader while the subagent is folded away", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid"],
      sessions: sessions(["lead", null], ["kid", "lead"]),
      collapsedLeaderIds: ["lead"],
    });
    expect(resolveTabPromptTarget("kid", lineage)).toBe("lead");
  });

  it("leaves a visible subagent holding its own prompt", () => {
    const lineage = buildTabStripLineage({
      order: ["lead", "kid"],
      sessions: sessions(["lead", null], ["kid", "lead"]),
    });
    expect(resolveTabPromptTarget("kid", lineage)).toBe("kid");
    expect(resolveTabPromptTarget("lead", lineage)).toBe("lead");
    expect(resolveTabPromptTarget("", lineage)).toBe("");
  });
});

describe("toggleCollapsedLeader", () => {
  const known = new Set(["lead", "other"]);

  it("folds and unfolds the same leader", () => {
    expect(toggleCollapsedLeader([], "lead", known)).toEqual(["lead"]);
    expect(toggleCollapsedLeader(["lead"], "lead", known)).toEqual([]);
  });

  it("drops folds for sessions that no longer exist", () => {
    expect(toggleCollapsedLeader(["gone", "other"], "lead", known)).toEqual([
      "other",
      "lead",
    ]);
  });

  it("prunes nothing before the session list is known", () => {
    expect(toggleCollapsedLeader(["gone"], "lead", new Set())).toEqual([
      "gone",
      "lead",
    ]);
  });

  it("does not persist a fold for a leader the strip does not know", () => {
    expect(toggleCollapsedLeader([], "ghost", known)).toEqual([]);
  });
});

describe("foldAwareBulkCloseTargets (adversarial review of #613)", () => {
  // Stored order scatters the group; grouping renders [lead, kid-1, kid-2,
  // solo] and the fold leaves [lead, solo] on screen.
  const scattered = {
    order: ["lead", "kid-1", "solo", "kid-2"],
    sessions: sessions(
      ["lead", null],
      ["kid-1", "lead"],
      ["solo", null],
      ["kid-2", "lead"],
    ),
  };
  const folded = buildTabStripLineage({
    ...scattered,
    collapsedLeaderIds: ["lead"],
  });
  const open = buildTabStripLineage(scattered);

  it("closes to the right of what is on screen, not of the stored order", () => {
    // Over the flat stored order this would be [kid-1, solo, kid-2] — two of
    // them folded away and one of them not even to the right any more.
    expect(
      foldAwareBulkCloseTargets({
        lineage: folded,
        pinnedIds: [],
        anchorId: "lead",
        mode: "to-right",
      }),
    ).toEqual(["solo"]);
  });

  it("never stops a folded subagent belonging to some other tab", () => {
    expect(
      foldAwareBulkCloseTargets({
        lineage: folded,
        pinnedIds: [],
        anchorId: "solo",
        mode: "others",
      }),
      // `lead` goes, and its folded group goes with it — but nothing else
      // reaches into a fold the user cannot see.
    ).toEqual(["lead", "kid-1", "kid-2"]);
  });

  it("takes a folded group along when its leader is closed", () => {
    expect(
      foldAwareBulkCloseTargets({
        lineage: folded,
        pinnedIds: [],
        anchorId: "solo",
        mode: "to-left",
      }),
    ).toEqual(["lead", "kid-1", "kid-2"]);
  });

  it("closes an expanded group one visible tab at a time", () => {
    expect(
      foldAwareBulkCloseTargets({
        lineage: open,
        pinnedIds: [],
        anchorId: "lead",
        mode: "to-right",
      }),
    ).toEqual(["kid-1", "kid-2", "solo"]);
  });

  it("still refuses to close a pinned tab", () => {
    expect(
      foldAwareBulkCloseTargets({
        lineage: open,
        pinnedIds: ["kid-1"],
        anchorId: "lead",
        mode: "to-right",
      }),
    ).toEqual(["kid-2", "solo"]);
  });
});
