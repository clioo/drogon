// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for issue #359:
   sessions with a recorded parentSessionId render as a fork lineage
   branch — a disclosure chevron on the parent row, the children inside
   the boxed .worktree-agent-lineage-children group beneath it, collapse
   on toggle — while the card summary still counts every session. */
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import type { Session, Workspace, Worktree } from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import {
  clearWorktreeAgentExpansionStateForTests,
  resetWorktreeAgentExpansionMemoryForTests,
  seedWorktreeAgentExpansionStateForTests,
  useWorktreeAgentExpansionState,
} from "./worktree-card-agents-expansion-state";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import type { TabStripState } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    agentState: "idle",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
    parentSessionId: null,
    ...overrides,
  };
}

const workspaces: Workspace[] = [
  { id: "ws-1", path: "/tmp/demo", name: "demo", kind: "folder", hostId: "host-1" },
];

function worktree(id: string): Worktree {
  return {
    id,
    projectId: "folder:/tmp/demo",
    workspaceId: "ws-1",
    path: "/tmp/demo",
    branch: "",
    head: "",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
  };
}

function renderCard(
  treeId: string,
  sessions: Session[],
  agentActivityDisplayMode: "compact" | "full" = "full",
  tabStrip: TabStripState = EMPTY_TAB_STRIP_STATE,
) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  const selected: string[] = [];
  const view = render(
    <TooltipProvider>
      <WorktreeCard
        worktree={worktree(treeId)}
        workspaces={workspaces}
        sessions={sessions}
        selected
        disabled={false}
        projectKind="folder"
        implicitFolderWorktree
        onSelect={() => {}}
        onSelectSession={(id) => selected.push(id)}
        activeSessionId=""
        tabStrip={tabStrip}
        onRemove={null}
        onRename={null}
        agentActivityDisplayMode={agentActivityDisplayMode}
      />
    </TooltipProvider>,
  );
  return { view, selected };
}

/** Three levels: a root, its child, and the child's own child. */
function threeLevelSet(): Session[] {
  return [
    session("root-1", { createdAt: "2026-09-08T11:00:00.000Z" }),
    session("child-1", {
      parentSessionId: "root-1",
      createdAt: "2026-09-08T11:05:00.000Z",
    }),
    session("grand-1", {
      parentSessionId: "child-1",
      createdAt: "2026-09-08T11:06:00.000Z",
    }),
  ];
}

/** The bug report's shape: one Pi session whose probes spawned 3 children. */
function orchestrationSet(): Session[] {
  return [
    session("term-1", { harnessId: "pi", createdAt: "2026-09-08T11:00:00.000Z" }),
    session("term-2", { parentSessionId: "term-1", createdAt: "2026-09-08T11:05:00.000Z" }),
    session("term-3", { parentSessionId: "term-1", createdAt: "2026-09-08T11:06:00.000Z" }),
    session("term-4", { parentSessionId: "term-1", createdAt: "2026-09-08T11:07:00.000Z" }),
  ];
}

// Why: the suite runs with test isolation off (see vitest.config.ts),
// and without globals testing-library does not auto-register cleanup —
// leaked trees would make role queries match earlier cards.
afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
});

describe("WorktreeCard subagent nesting box (issue #359)", () => {
  test("children render inside a boxed group under the parent row", () => {
    const { view } = renderCard("wt-nest-1", orchestrationSet());
    const rows = view.container.querySelector(".shell-worktree-card-rows");
    expect(rows).not.toBeNull();
    const group = rows!.querySelector(".worktree-agent-lineage-children");
    expect(group, "children must render in the lineage box").not.toBeNull();
    const childRows = group!.querySelectorAll("[data-worktree-agent-row]");
    expect([...childRows].map((el) => el.getAttribute("data-worktree-agent-row"))).toEqual([
      "term-2",
      "term-3",
      "term-4",
    ]);
    // The parent row is the only root and carries the fork's parent class.
    const parentRow = rows!.querySelector("[data-worktree-agent-row='term-1']");
    expect(parentRow!.className).toContain("worktree-agent-lineage-parent-row");
    expect(parentRow!.className).not.toContain("worktree-agent-lineage-child-row");
    // Child rows carry the child class; the parent is not inside the box.
    for (const id of ["term-2", "term-3", "term-4"]) {
      const childRow = group!.querySelector(`[data-worktree-agent-row='${id}']`);
      expect(childRow!.className).toContain("worktree-agent-lineage-child-row");
    }
    expect(group!.querySelector("[data-worktree-agent-row='term-1']")).toBeNull();
  });

  test("the parent row shows the fork's disclosure, expanded by default", () => {
    const { view } = renderCard("wt-nest-2", orchestrationSet());
    const disclosure = view.getByRole("button", {
      name: "Hide 3 child agents",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  });

  test("collapsing hides the box and flips the disclosure to Show with a count", () => {
    const { view } = renderCard("wt-nest-3", orchestrationSet());
    const disclosure = view.getByRole("button", { name: "Hide 3 child agents" });
    fireEvent.click(disclosure);
    expect(
      view.container.querySelector(".worktree-agent-lineage-children"),
      "collapsed children must leave the DOM",
    ).toBeNull();
    const show = view.getByRole("button", { name: "Show 3 child agents" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    // The fork's +N badge sits on the collapsed parent row.
    const parentRow = view.container.querySelector(
      "[data-worktree-agent-row='term-1']",
    )!;
    expect(within(parentRow as HTMLElement).getByText("+3")).not.toBeNull();
  });

  test("the accessible summary counts children even while collapsed", () => {
    const { view } = renderCard("wt-nest-4", orchestrationSet());
    fireEvent.click(view.getByRole("button", { name: "Hide 3 child agents" }));
    // The source draws no summary text line; the same counts ride the
    // card's accessible label and still cover every session. None of the
    // fixture rows carries hook proof, so the collapsed card honestly
    // reports the whole silent set instead of a quiet it cannot prove.
    const surface = view.container.querySelector<HTMLElement>(
      ".shell-worktree-card",
    );
    expect(surface?.getAttribute("aria-label") ?? "").toContain(
      "All sessions not reporting",
    );
  });

  test("a session whose parent is not in the card renders flat", () => {
    const { view } = renderCard("wt-nest-5", [
      session("term-1", { harnessId: "pi" }),
      session("term-2", { parentSessionId: "another-worktrees-session" }),
    ]);
    expect(view.container.querySelector(".worktree-agent-lineage-children")).toBeNull();
    const rows = view.container.querySelectorAll("[data-worktree-agent-row]");
    expect(rows.length).toBe(2);
  });

  test("activating a child row selects its own session", () => {
    const { view, selected } = renderCard("wt-nest-6", orchestrationSet());
    const group = view.container.querySelector(".worktree-agent-lineage-children")!;
    const childRow = group.querySelector(
      "[data-worktree-agent-row='term-3']",
    ) as HTMLElement;
    fireEvent.click(childRow);
    expect(selected).toEqual(["term-3"]);
  });

  test("a 3-level tree renders treeitems with levels and expanded state, and no group roles", () => {
    const { view } = renderCard("wt-deep-1", threeLevelSet());
    const rows = view.container.querySelector(".shell-worktree-card-rows");
    expect(rows?.getAttribute("role")).toBe("tree");
    // The flat-tree contract carries the whole hierarchy: every level reads
    // as a treeitem at its 1-based level with a stable 0-based depth marker
    // for the end-to-end assertion, and the children containers are
    // presentational wrappers — never a group role.
    for (const [id, level, depth] of [
      ["root-1", "1", "0"],
      ["child-1", "2", "1"],
      ["grand-1", "3", "2"],
    ] as const) {
      const node = rows!.querySelector(
        `[data-worktree-agent-row='${id}']`,
      )!.closest('[role="treeitem"]')!;
      expect(node.getAttribute("aria-level")).toBe(level);
      expect(node.getAttribute("data-lineage-depth")).toBe(depth);
    }
    expect(
      rows!.querySelectorAll('[role="group"]').length,
      "children containers must stay presentational",
    ).toBe(0);
    // Expanded state rides each parent treeitem: depth 1 and depth 2 start
    // expanded, the depth 3 leaf carries no aria-expanded at all.
    const rootNode = rows!.querySelector(
      `[data-worktree-agent-row='root-1']`,
    )!.closest('[role="treeitem"]')!;
    expect(rootNode.getAttribute("aria-expanded")).toBe("true");
    const childNode = rows!.querySelector(
      `[data-worktree-agent-row='child-1']`,
    )!.closest('[role="treeitem"]')!;
    expect(childNode.getAttribute("aria-expanded")).toBe("true");
    const grandNode = rows!.querySelector(
      `[data-worktree-agent-row='grand-1']`,
    )!.closest('[role="treeitem"]')!;
    expect(grandNode.getAttribute("aria-expanded")).toBeNull();
    // Depth >= 1 rows all carry the lineage child chrome, not only depth 1.
    const childRow = rows!.querySelector(
      `[data-worktree-agent-row='child-1']`,
    )!;
    const grandRow = rows!.querySelector(
      `[data-worktree-agent-row='grand-1']`,
    )!;
    expect(childRow.className).toContain("worktree-agent-lineage-child-row");
    expect(grandRow.className).toContain("worktree-agent-lineage-child-row");
    expect(
      rows!.querySelector(`[data-worktree-agent-row='root-1']`)!.className,
    ).not.toContain("worktree-agent-lineage-child-row");
  });

  test("collapsing depth 1 hides depths 2 and 3", () => {
    const { view } = renderCard("wt-deep-2", threeLevelSet());
    const rows = view.container.querySelector(".shell-worktree-card-rows")!;
    const rootNode = rows
      .querySelector(`[data-worktree-agent-row='root-1']`)!
      .closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(
      within(rootNode).getByRole("button", { name: "Hide 1 child agent" }),
    );
    expect(
      rows.querySelector("[data-worktree-agent-row='child-1']"),
      "depth 2 must leave the DOM",
    ).toBeNull();
    expect(
      rows.querySelector("[data-worktree-agent-row='grand-1']"),
      "depth 3 must leave the DOM",
    ).toBeNull();
    expect(
      rows.querySelector("[data-worktree-agent-row='root-1']"),
      "depth 1 stays",
    ).not.toBeNull();
    expect(rootNode.getAttribute("aria-expanded")).toBe("false");
  });

  test("collapsing depth 2 leaves depth 1 visible", () => {
    const { view } = renderCard("wt-deep-3", threeLevelSet());
    const rows = view.container.querySelector(".shell-worktree-card-rows")!;
    const childNode = rows
      .querySelector(`[data-worktree-agent-row='child-1']`)!
      .closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(
      within(childNode).getByRole("button", { name: "Hide 1 child agent" }),
    );
    expect(
      rows.querySelector("[data-worktree-agent-row='grand-1']"),
      "depth 3 must leave the DOM",
    ).toBeNull();
    expect(
      rows.querySelector("[data-worktree-agent-row='child-1']"),
      "depth 2 stays",
    ).not.toBeNull();
    expect(
      rows.querySelector("[data-worktree-agent-row='root-1']"),
      "depth 1 stays",
    ).not.toBeNull();
  });

  test("a collapsed depth-2 parent stays collapsed across a simulated reload", () => {
    const first = renderCard("wt-deep-4", threeLevelSet());
    const rows = first.view.container.querySelector(
      ".shell-worktree-card-rows",
    )!;
    const childNode = rows
      .querySelector(`[data-worktree-agent-row='child-1']`)!
      .closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(
      within(childNode).getByRole("button", { name: "Hide 1 child agent" }),
    );
    first.view.unmount();
    // A reload empties the module map but keeps the persisted fold.
    resetWorktreeAgentExpansionMemoryForTests();
    const second = renderCard("wt-deep-4", threeLevelSet());
    const rows2 = second.view.container.querySelector(
      ".shell-worktree-card-rows",
    )!;
    expect(
      rows2.querySelector("[data-worktree-agent-row='grand-1']"),
      "depth 3 stays hidden after reload",
    ).toBeNull();
    expect(
      rows2.querySelector("[data-worktree-agent-row='child-1']"),
      "depth 2 stays visible after reload",
    ).not.toBeNull();
    second.view.unmount();
  });

  test("the next toggle prunes dead collapsed ids but keeps a fold whose children merely exited", () => {
    seedWorktreeAgentExpansionStateForTests("wt-prune-1", {
      collapsedLineageParents: new Set(["gone-1"]),
      compactRootListExpanded: false,
      cardFolded: false,
    });
    const { view } = renderCard("wt-prune-1", orchestrationSet());
    // Collapse the live parent: the dead id is pruned, the live fold lands.
    fireEvent.click(view.getByRole("button", { name: "Hide 3 child agents" }));
    const probe = renderHook(() => useWorktreeAgentExpansionState("wt-prune-1"));
    expect(probe.result.current.collapsedLineageParents.has("gone-1")).toBe(
      false,
    );
    expect(probe.result.current.collapsedLineageParents.has("term-1")).toBe(
      true,
    );
    probe.unmount();
    view.unmount();
  });

  test("compact mode names observed sessions in the pill and prunes through the pill tree", () => {
    seedWorktreeAgentExpansionStateForTests("wt-prune-2", {
      collapsedLineageParents: new Set(["gone-9"]),
      compactRootListExpanded: false,
      cardFolded: false,
    });
    const { view } = renderCard(
      "wt-prune-2",
      [
        session("o-1", {
          observedHarnessId: "claude",
          createdAt: "2026-09-08T11:00:00.000Z",
        }),
        session("o-2", {
          parentSessionId: "o-1",
          createdAt: "2026-09-08T11:05:00.000Z",
        }),
        // The pill only takes over a long fan-out now (owner's design,
        // 2026-09-21), so the fixture carries enough roots to reach it.
        ...Array.from({ length: 5 }, (_, index) =>
          session(`s-${index + 2}`, {
            createdAt: `2026-09-08T11:${30 + index}:00.000Z`,
          }),
        ),
      ],
      "compact",
    );
    // The pill names the observed session's harness (the shared resolver),
    // not Shell — with the honest not-reporting state, since an observed
    // quiet clock without hook proof is no one's idle to claim.
    const pill = view.getByRole("button", { name: /Expand 6 agents/ });
    expect(pill.getAttribute("aria-label")).toContain("Claude not reporting");
    fireEvent.click(pill);
    const rows = view.container.querySelector(".shell-worktree-card-rows")!;
    const parentNode = rows
      .querySelector(`[data-worktree-agent-row='o-1']`)!
      .closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(
      within(parentNode).getByRole("button", { name: "Hide 1 child agent" }),
    );
    const probe = renderHook(() => useWorktreeAgentExpansionState("wt-prune-2"));
    expect(probe.result.current.collapsedLineageParents.has("gone-9")).toBe(
      false,
    );
    expect(probe.result.current.collapsedLineageParents.has("o-1")).toBe(true);
    probe.unmount();
    view.unmount();
  });

  test("rows inside the expanded compact pill heal frozen prefill copies", () => {
    // The compact expansion renders rows through its own verbatim-title
    // path: a frozen prefill copy ("Claude", a rename dialog saved
    // unchanged) must heal to the concise provider fold there too, not
    // just in full rows.
    const { view } = renderCard(
      "wt-pill-heal-1",
      [
        session("frozen-1", {
          harnessId: "claude",
          agentState: "idle",
          agentStateAuthority: "hook",
          agentPromptPreview: "Fix the sidebar card order for real",
          createdAt: "2026-09-08T11:00:00.000Z",
        }),
        ...Array.from({ length: 5 }, (_, index) =>
          session(`s-${index + 2}`, {
            createdAt: `2026-09-08T11:${30 + index}:00.000Z`,
          }),
        ),
      ],
      "compact",
      { ...EMPTY_TAB_STRIP_STATE, titles: { "frozen-1": "Claude" } },
    );
    fireEvent.click(view.getByRole("button", { name: /Expand 6 agents/ }));
    const row = view.container.querySelector(
      '[data-worktree-agent-row="frozen-1"]',
    ) as HTMLElement;
    const primary = row.querySelector(
      "[data-worktree-agent-primary]",
    ) as HTMLElement;
    expect(primary?.textContent).toBe("Claude Code");
    view.unmount();
  });

  test("a collapsed parent whose children merely exited keeps its fold", () => {
    const first = renderCard("wt-exit-1", orchestrationSet());
    fireEvent.click(first.view.getByRole("button", { name: "Hide 3 child agents" }));
    first.view.unmount();
    // The children exit but stay listed; the fold must survive the new list.
    const exited = orchestrationSet().map((item) =>
      item.id === "term-1"
        ? item
        : { ...item, verdict: "exited" as const, exitCode: 0 },
    );
    const second = renderCard("wt-exit-1", exited);
    expect(
      second.view.container.querySelector(".worktree-agent-lineage-children"),
      "exited children must not unfold the parent",
    ).toBeNull();
    const probe = renderHook(() => useWorktreeAgentExpansionState("wt-exit-1"));
    expect(probe.result.current.collapsedLineageParents.has("term-1")).toBe(
      true,
    );
    probe.unmount();
    second.view.unmount();
  });

  test("leaf root rows keep the disclosure gutter when a sibling has children", () => {
    const { view } = renderCard("wt-nest-7", [
      session("term-1", { harnessId: "pi" }),
      session("term-2", { parentSessionId: "term-1" }),
      session("solo", { createdAt: "2026-09-08T11:08:00.000Z" }),
    ]);
    const rows = view.container.querySelector(".shell-worktree-card-rows")!;
    const solo = rows.querySelector("[data-worktree-agent-row='solo']") as HTMLElement;
    expect(solo.querySelector("span.size-4"), "leaf root reserves the gutter").not.toBeNull();
  });
});
