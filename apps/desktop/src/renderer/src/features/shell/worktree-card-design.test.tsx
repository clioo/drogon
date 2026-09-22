// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Card-level proof for the owner's sidebar design (2026-09-21): the left
   lane carries the workspace STATUS ring (not agent activity), the activity
   is stated in words under the title, the card's own chevron folds the agent
   list and that fold survives a reload, a root row that owns subagents reads
   MAIN, every row states its own condition, and the right-hand review marker
   is one glyph with the review's state. */
import React from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import type {
  AgentState,
  Session,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import {
  clearWorktreeAgentExpansionStateForTests,
  resetWorktreeAgentExpansionMemoryForTests,
} from "./worktree-card-agents-expansion-state";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";

afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
  delete (window as { drogon?: unknown }).drogon;
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
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
    agentState: "working",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
    ...overrides,
  };
}

const STATUSES: WorkspaceStatusDefinition[] = [
  { id: "todo", label: "Todo", color: "neutral", icon: "circle" },
  { id: "in-review", label: "In review", color: "conductor-review", icon: "conductor-review" },
  { id: "completed", label: "Done", color: "conductor-done", icon: "conductor-done" },
];

const workspaces: Workspace[] = [
  { id: "ws-1", path: "/tmp/demo", name: "demo", kind: "folder", hostId: "host-1" },
];

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "folder:/tmp/demo",
    workspaceId: "ws-1",
    path: "/tmp/demo",
    branch: "demo",
    head: "",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function renderCard({
  sessions,
  statusId = null,
  pr = null,
  worktreeOverrides = {},
}: {
  sessions: Session[];
  statusId?: string | null;
  pr?: WorktreeCardPrDisplay | null;
  worktreeOverrides?: Partial<Worktree>;
}) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <WorktreeCard
        worktree={worktree({ workspaceStatus: statusId, ...worktreeOverrides })}
        workspaces={workspaces}
        sessions={sessions}
        selected
        disabled={false}
        projectKind="folder"
        implicitFolderWorktree
        onSelect={() => {}}
        onSelectSession={() => {}}
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        statuses={STATUSES}
        pr={pr}
        onRemove={null}
        onRename={null}
      />
    </TooltipProvider>,
  );
}

describe("card activity sentence", () => {
  test.each([
    [[], "NO SESSION"],
    [[session({ agentState: "idle" })], "NO ACTIVE AGENTS"],
    [
      [session({ id: "a", agentState: "working" })],
      "1 AGENT WORKING",
    ],
    [
      [session({ id: "a", agentState: "working" }), session({ id: "b", agentState: "working" })],
      "2 AGENTS WORKING",
    ],
    [
      [session({ id: "a", agentState: "working" }), session({ id: "b", agentState: "needs_input" })],
      "1 AGENT NEEDS INPUT",
    ],
    [
      [session({ id: "a", agentState: undefined, agentStateAt: null })],
      "1 AGENT NOT REPORTING",
    ],
  ] as const)("states %s sessions as %s", (sessions, sentence) => {
    const { container } = renderCard({ sessions: [...sessions] });
    expect(
      container.querySelector(".shell-worktree-card-sentence")?.textContent,
    ).toBe(sentence);
  });

  test("the working glyph rides the lane only while an agent works or waits", () => {
    const working = renderCard({ sessions: [session({ agentState: "working" })] });
    expect(
      working.container.querySelector(
        '[data-worktree-card-status-slot] [aria-label="Working"]',
      ),
    ).not.toBeNull();
    working.unmount();
    const quiet = renderCard({ sessions: [session({ agentState: "idle" })] });
    // A quiet card states its condition in the sentence; the lane keeps only
    // the status ring, so no state glyph competes with it.
    expect(
      quiet.container.querySelector(
        '[data-worktree-card-status-slot] [aria-label="Idle"]',
      ),
    ).toBeNull();
  });
});

describe("card status ring", () => {
  test("draws the workspace status with its own icon and colour", () => {
    const { container } = renderCard({
      sessions: [session()],
      statusId: "in-review",
    });
    const ring = container.querySelector(
      '[data-worktree-card-status-slot] [role="img"]',
    ) as HTMLElement;
    expect(ring.getAttribute("aria-label")).toBe("Status In review");
    // The status' own colour tone travels with the definition (kanban
    // workspace-status.ts), so the card and the board cannot drift.
    expect(ring.className).toContain("text-[#16a34a]");
  });

  test("no status is the dashed neutral ring, never a status the owner did not set", () => {
    const { container } = renderCard({ sessions: [session()], statusId: null });
    const ring = container.querySelector(
      '[data-worktree-card-status-slot] [role="img"]',
    ) as HTMLElement;
    expect(ring.getAttribute("aria-label")).toBe("No status");
    expect(
      ring.querySelector(".border-dashed"),
      "the unset ring reads as its own state",
    ).not.toBeNull();
  });

  test("a status id this profile no longer defines degrades to no status", () => {
    const { container } = renderCard({
      sessions: [session()],
      statusId: "deleted-status",
    });
    expect(
      container
        .querySelector('[data-worktree-card-status-slot] [role="img"]')!
        .getAttribute("aria-label"),
    ).toBe("No status");
  });
});

describe("card fold", () => {
  test("the card chevron folds the agent list and keeps the sentence", () => {
    const { container } = renderCard({
      sessions: [session({ id: "a", agentState: "working" })],
    });
    expect(
      container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
    const fold = container.querySelector(
      ".shell-worktree-card-fold",
    ) as HTMLButtonElement;
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(container.querySelector('[data-worktree-agent-row="a"]')).toBeNull();
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    // A folded card still says what its agents are doing.
    expect(
      container.querySelector(".shell-worktree-card-sentence")?.textContent,
    ).toBe("1 AGENT WORKING");
  });

  test("the fold survives a renderer reload", () => {
    const first = renderCard({
      sessions: [session({ id: "a", agentState: "working" })],
    });
    fireEvent.click(first.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      first.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    first.unmount();
    // A reload empties the module cache but keeps localStorage.
    resetWorktreeAgentExpansionMemoryForTests();
    const second = renderCard({ sessions: [session({ id: "a" })] });
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    fireEvent.click(second.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
  });

  test("folding one card leaves another card's list alone", () => {
    const first = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { id: "wt-a" },
    });
    const second = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { id: "wt-b" },
    });
    fireEvent.click(first.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      first.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
  });
});

describe("agent tree labels", () => {
  test("only a root that owns subagents reads MAIN, and every row states its condition", () => {
    const { container } = renderCard({
      sessions: [
        session({ id: "root", agentState: "working" }),
        session({ id: "child", parentSessionId: "root", agentState: "idle" }),
        session({ id: "lone", agentState: "idle" }),
      ],
    });
    const mainBadges = container.querySelectorAll(
      ".shell-worktree-agent-main-badge",
    );
    expect(mainBadges).toHaveLength(1);
    expect(
      mainBadges[0].closest("[data-worktree-agent-row]")?.getAttribute(
        "data-worktree-agent-row",
      ),
    ).toBe("root");
    // A long, truncated name must not swallow the badge: it lives beside the
    // truncating column, not inside it.
    expect(mainBadges[0].closest(".truncate")).toBeNull();
    // Each row states its own condition in words, main rows included.
    // Tree order: the lone root, then the root that owns the child, then
    // the child nested under it.
    const labels = [...container.querySelectorAll(".shell-worktree-agent-state")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Idle", "Working", "Idle"]);
    expect(
      container
        .querySelector('[data-worktree-agent-row="child"]')!
        .closest('[role="treeitem"]')!
        .getAttribute("aria-level"),
    ).toBe("2");
    expect(
      container.querySelector('[data-worktree-agent-state="working"]'),
    ).not.toBeNull();
  });

  test("a session that never reported says how long the silence has run, exactly once", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "quiet",
          agentState: undefined,
          agentStateAt: "2026-09-08T11:00:00.000Z",
        }),
      ],
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="quiet"]',
    ) as HTMLElement;
    const label = row.querySelector(".shell-worktree-agent-state-label")
      ?.textContent;
    expect(label).toMatch(/^No update in /);
    // The freshness report is the row's state text; the age column must not
    // print the same duration a second time.
    expect(row.textContent?.match(/No update in /g)?.length).toBe(1);
    expect(row.querySelector("[data-worktree-agent-age]")).toBeNull();
  });

  test("a row that knows its state keeps both the state and the age", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "working",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
        }),
      ],
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="working"]',
    ) as HTMLElement;
    expect(row.querySelector(".shell-worktree-agent-state-label")?.textContent).toBe(
      "Working",
    );
    // "Working" and when it last reported are two different facts.
    expect(
      row.querySelector("[data-worktree-agent-age]")?.textContent,
    ).toMatch(/^\d+[mhd]$/);
  });
});

describe("review marker", () => {
  test.each([
    [{ state: "merged" } as const, "merged", "Linked PR #7: Merged"],
    [{ state: "open", mergeable: "CONFLICTING" } as const, "conflicts", "Linked PR #7: Conflicts with the base branch"],
    [{ state: "draft" } as const, "draft", "Linked PR #7: Draft"],
    // "Ready" is a confirmed claim (F2): an open review with unknown
    // mergeability stays honestly open, never "Ready to merge".
    [{ state: "open" } as const, "open", "Linked PR #7: Open"],
    [{ state: "open", mergeable: "MERGEABLE" } as const, "ready", "Linked PR #7: Open"],
    [{ state: "open", mergeable: "MERGEABLE", checks: "failure" } as const, "open", "Linked PR #7 checks: Failed"],
  ])("draws %s as %s", (prFields, state, label) => {
    const { container } = renderCard({
      sessions: [session()],
      pr: { provider: "github", number: 7, title: "Fix it", ...prFields },
    });
    const icon = container.querySelector(
      "[data-worktree-card-pr-state]",
    ) as HTMLElement;
    expect(icon.getAttribute("data-worktree-card-pr-state")).toBe(state);
    expect(icon.getAttribute("aria-label")).toBe(label);
  });

  test("no linked review draws nothing rather than a placeholder", () => {
    const { container } = renderCard({ sessions: [session()], pr: null });
    expect(container.querySelector("[data-worktree-card-pr-state]")).toBeNull();
  });
});
