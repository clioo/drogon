// Issue #606. Two things App owns for the strip's subagent groups, both
// found by the adversarial review:
//
//  - what a bulk close destroys, and which tab survives it. Round 1 found
//    this running over the flat order, closing folded subagents nobody could
//    see; round 2 then found the fix had no test at its own call site, so
//    reverting App to the pre-fix call left the whole suite green.
//  - the wiring that routes the prompt back to a leader while its group is
//    folded, which only the live acceptance guarded.
//
// The planner is imported and exercised directly; the wiring it sits in is a
// 5000-line component with no mount harness here, so it is pinned by reading
// the source, the way BotsPanel.contract.test.ts pins unmounted surfaces.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planStripBulkClose } from "./App";
import {
  buildTabStripLineage,
  type TabLineageSession,
} from "./features/shell/tab-strip/tab-lineage";

const MENTU_TAB = "mentu-tab";

function sessions(...pairs: [string, string | null][]): TabLineageSession[] {
  return pairs.map(([id, parentSessionId]) => ({ id, parentSessionId }));
}

// Stored order scatters a fan-out; grouping renders [lead, kid-1, kid-2, solo]
// and folding the leader leaves [lead, solo] on screen.
const fanOut = {
  order: ["lead", "kid-1", "solo", "kid-2"],
  sessions: sessions(
    ["lead", null],
    ["kid-1", "lead"],
    ["solo", null],
    ["kid-2", "lead"],
  ),
};
const folded = buildTabStripLineage({ ...fanOut, collapsedLeaderIds: ["lead"] });
const expanded = buildTabStripLineage(fanOut);

describe("planStripBulkClose targets (#606)", () => {
  it("closes what is on screen, not what the flat order lists", () => {
    expect(
      planStripBulkClose({
        lineage: folded,
        pinnedIds: [],
        anchorId: "lead",
        mode: "to-right",
        currentId: "lead",
      }).targets,
    ).toEqual(["solo"]);
  });

  it("takes a folded group along with the leader it is folded into", () => {
    expect(
      planStripBulkClose({
        lineage: folded,
        pinnedIds: [],
        anchorId: "solo",
        mode: "others",
        currentId: "solo",
      }).targets,
    ).toEqual(["lead", "kid-1", "kid-2"]);
  });

  it("spares a pinned subagent even when a fold hides it", () => {
    expect(
      planStripBulkClose({
        lineage: folded,
        pinnedIds: ["kid-1"],
        anchorId: "solo",
        mode: "others",
        currentId: "solo",
      }).targets,
    ).toEqual(["lead", "kid-2"]);
  });
});

describe("planStripBulkClose selection (#606)", () => {
  it("leaves the selection alone when the current tab survives", () => {
    expect(
      planStripBulkClose({
        lineage: expanded,
        pinnedIds: [],
        anchorId: "lead",
        mode: "to-right",
        currentId: "lead",
      }).nextSelection,
    ).toBeNull();
  });

  it("moves the selection off a tab that is about to be closed", () => {
    const plan = planStripBulkClose({
      lineage: expanded,
      pinnedIds: [],
      anchorId: "lead",
      mode: "to-right",
      currentId: "kid-2",
    });
    expect(plan.targets).toContain("kid-2");
    // The anchor survives a to-right close, and it is the nearest survivor.
    expect(plan.nextSelection).toBe("lead");
  });

  it("never hands back a survivor that is itself doomed", () => {
    const plan = planStripBulkClose({
      lineage: expanded,
      pinnedIds: [],
      anchorId: "solo",
      mode: "others",
      currentId: "kid-1",
    });
    expect(plan.nextSelection).not.toBeNull();
    expect(plan.targets).not.toContain(plan.nextSelection);
  });

  it("never picks a survivor from behind a fold", () => {
    // `kid-1` and `kid-2` are folded away: selecting one would show a
    // terminal with no tab.
    const plan = planStripBulkClose({
      lineage: folded,
      pinnedIds: ["lead"],
      anchorId: "lead",
      mode: "others",
      currentId: "solo",
    });
    expect(plan.targets).toEqual(["solo"]);
    expect(plan.nextSelection).toBe("lead");
  });

  it("falls back to the anchor when every neighbour is doomed", () => {
    const plan = planStripBulkClose({
      lineage: buildTabStripLineage({
        order: ["a", "b"],
        sessions: sessions(["a", null], ["b", null]),
      }),
      pinnedIds: [],
      anchorId: "a",
      mode: "others",
      currentId: "b",
    });
    expect(plan.targets).toEqual(["b"]);
    // A bulk close never targets its anchor, so it is always a valid
    // survivor — and here it is the only one left.
    expect(plan.nextSelection).toBe("a");
  });

  it("keeps a non-session tab eligible as the survivor", () => {
    const plan = planStripBulkClose({
      lineage: buildTabStripLineage({
        order: ["lead", "kid", MENTU_TAB],
        sessions: sessions(["lead", null], ["kid", "lead"]),
      }),
      pinnedIds: [],
      anchorId: MENTU_TAB,
      mode: "to-left",
      currentId: "kid",
    });
    expect(plan.targets).toEqual(["lead", "kid"]);
    expect(plan.nextSelection).toBe(MENTU_TAB);
  });
});

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

function sliceBetween(start: string, end: string): string {
  const from = appSource.indexOf(start);
  expect(from, `App must still contain ${start}`).toBeGreaterThan(-1);
  const to = appSource.indexOf(end, from);
  expect(to, `App must still contain ${end} after ${start}`).toBeGreaterThan(
    from,
  );
  return appSource.slice(from, to);
}

describe("App wires the strip's subagent groups (#606)", () => {
  it("plans every bulk close through the fold-aware planner", () => {
    const body = sliceBetween(
      "const closeStripTabs = (",
      "for (const target of plan.targets)",
    );
    expect(body).toContain("planStripBulkClose(");
    // The two pre-fix ingredients. Either one back here means hidden tabs
    // are closable again, and the survivor can be a doomed tab.
    expect(body).not.toContain("liveStripOrder()");
    expect(body).not.toMatch(/[^A-Za-z.]bulkCloseTargets\(/);
    expect(body).toContain("lineage: stripLineage");
    expect(body).toContain("pinnedIds: tabStrip.pinned");
  });

  it("builds the lineage from the live order, sessions, folds and pins", () => {
    const body = sliceBetween("const stripLineage = buildTabStripLineage({", "});");
    expect(body).toContain("order: liveStripOrder()");
    expect(body).toContain("sessions: stripSessions");
    expect(body).toContain("collapsedLeaderIds: tabStrip.collapsedLineage");
    expect(body).toContain("pinnedIds: tabStrip.pinned");
  });

  it("routes the prompt back to the leader while a group is folded", () => {
    const body = sliceBetween(
      "const promptTargetSessionId = resolveTabPromptTarget(",
      "const toggleTabLineage",
    );
    expect(body).toContain("stripLineage");
    // Only the active session moves; the route and the browser/editor
    // selection are the user's, not ours.
    expect(body).toContain("setActive(promptTargetSessionId)");
    expect(body).not.toContain("setRoute(");
    expect(body).not.toContain("setActiveBrowserTabId(");
  });

  it("persists a fold through the workspace's tab-strip envelope", () => {
    const body = sliceBetween("const toggleTabLineage = (", "const toggleTabPin");
    expect(body).toContain("updateTabStrip(");
    expect(body).toContain("collapsedLineage: toggleCollapsedLeader(");
    // Pruning needs the live session ids, or a fold outlives its sessions.
    expect(body).toContain("stripSessions.map((item) => item.id)");
  });

  it("hands the strip its folds and its fold toggle", () => {
    const body = sliceBetween("<TabBar", "onOrderChange={changeTabOrder}");
    expect(body).toContain("collapsedLineageIds={tabStrip.collapsedLineage");
    expect(body).toContain("onToggleLineage={toggleTabLineage}");
  });
});
