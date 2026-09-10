// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for issue #359:
   sessions with a recorded parentSessionId render as a fork lineage
   branch — a disclosure chevron on the parent row, the children inside
   the boxed .worktree-agent-lineage-children group beneath it, collapse
   on toggle — while the card summary still counts every session. */
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { Session, Workspace, Worktree } from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import { clearWorktreeAgentExpansionStateForTests } from "./worktree-card-agents-expansion-state";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
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

function renderCard(treeId: string, sessions: Session[]) {
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
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onRemove={null}
        onRename={null}
      />
    </TooltipProvider>,
  );
  return { view, selected };
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
    // card's accessible label and still cover every session.
    const surface = view.container.querySelector<HTMLElement>(
      ".shell-worktree-card",
    );
    expect(surface?.getAttribute("aria-label") ?? "").toContain(
      "All sessions idle",
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
