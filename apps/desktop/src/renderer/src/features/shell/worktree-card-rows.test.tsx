// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for R16-AN
   (fixes #229): the worktree card nests one row per session under the
   summary line, the focused row follows the active tab, and the summary
   counts come from the same rows. */
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session, Workspace, Worktree } from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { clearWorktreeAgentExpansionStateForTests } from "./worktree-card-agents-expansion-state";
import { TooltipProvider } from "../../components/ui/tooltip";

// No vi.mock here: with CI worker reuse (test.isolate false, see
// docs/reference/desktop-test-isolation.md) per-file vi.mock factories of
// the shared tooltip module can be shadowed by other files' registrations,
// which surfaced as "`Tooltip` must be used within `TooltipProvider`".
// Rendering under the real provider keeps the tooltips inert and the file
// self-sufficient.

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

const workspaces: Workspace[] = [
  { id: "ws-1", path: "/tmp/demo", name: "demo", kind: "folder", hostId: "host-1" },
];

const worktree: Worktree = {
  id: "implicit:ws-1",
  projectId: "folder:/tmp/demo",
  workspaceId: "ws-1",
  path: "/tmp/demo",
  branch: "",
  head: "",
  baseRef: null,
  createdAt: "2026-09-08T10:00:00.000Z",
};

function renderCard(sessions: Session[], activeSessionId: string) {
  // The card's context menu reads the (absent, here) shell bridge.
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <WorktreeCard
      worktree={worktree}
      workspaces={workspaces}
      sessions={sessions}
      selected
      disabled={false}
      projectKind="folder"
      implicitFolderWorktree
      onSelect={() => {}}
      onSelectSession={() => {}}
      activeSessionId={activeSessionId}
      tabStrip={EMPTY_TAB_STRIP_STATE}
      onRemove={null}
      onRename={null}
      />
    </TooltipProvider>,
  );
}

afterEach(clearWorktreeAgentExpansionStateForTests);

describe("WorktreeCard nested session rows", () => {
  test("nests one row per session with harness icon, title and time", () => {
    const { container, unmount } = renderCard(
      [
        session({
          id: "s-1",
          agentState: "working",
          harnessId: "claude",
          createdAt: "2026-09-08T11:00:00.000Z",
        }),
        session({
          id: "s-2",
          agentState: undefined,
          agentStateAt: null,
          command: "/bin/bash",
          createdAt: "2026-09-08T11:30:00.000Z",
        }),
      ],
      "s-1",
    );
    try {
      // Harness session row: the harness label is the primary title now
      // (issue #622: the row reads what the session runs, not Terminal N),
      // and the owner's design appends the row's own state. The sidebar
      // reads the owner-authorized "Claude Code" branding, so the
      // accessible name carries it too (label-in-name: it must contain the
      // visible text).
      expect(
        screen.getByRole("button", { name: "Claude Code - Working" }),
      ).toBeTruthy();
      // Fallback row for the session that never reported: tab title plus
      // the fork's freshness copy, never a bare missing row.
      expect(
        screen.getByRole("button", { name: /Terminal 2.*No update in/ }),
      ).toBeTruthy();
      // Row markers for the oracle's aria-structure comparison.
      expect(
        container.querySelector('[data-worktree-agent-row="s-1"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-worktree-agent-row="s-2"]'),
      ).toBeTruthy();
      // The inline list keeps the oracle-pinned "<card> sessions" label.
      expect(
        container.querySelector('[aria-label="demo sessions"]'),
      ).toBeTruthy();
    } finally {
      unmount();
    }
  });

  test("focused highlight follows the active tab and summary matches rows", () => {
    const { container, unmount } = renderCard(
      [
        // F1 sidebar truth (coordinator grant): launched agents, so the
        // launch record rides along — harness-less `working` wire is the
        // old-daemon false positive, never an agent turn.
        session({ id: "s-1", agentState: "working", harnessId: "pi" }),
        session({ id: "s-2", agentState: "idle", harnessId: "pi" }),
      ],
      "s-2",
    );
    try {
      expect(
        container.querySelector('[data-focused-agent-pane="true"]'),
      ).toBeTruthy();
      // The source's card draws no summary text line; the same counts ride
      // the card's accessible label (the lane dot + tooltip carry the
      // visual state).
      const surface = container.querySelector<HTMLElement>(
        ".shell-worktree-card",
      );
      expect(surface?.getAttribute("aria-label") ?? "").toContain(
        "1 working, 1 idle",
      );
    } finally {
      unmount();
    }
  });

  test("an observed-only session reads the harness with its icon; a plain shell reads Terminal N - zsh with the terminal glyph", () => {
    const { container, unmount } = renderCard(
      [
        session({
          id: "s-1",
          agentState: "working",
          harnessId: null,
          observedHarnessId: "claude",
          command: "/bin/zsh",
          createdAt: "2026-09-08T11:00:00.000Z",
        }),
        session({
          id: "s-2",
          agentState: "working",
          harnessId: null,
          command: "/bin/zsh",
          createdAt: "2026-09-08T11:30:00.000Z",
        }),
        // F1 sidebar truth (regression, explained): only a `harness.start`
        // turn is proven work. The observed and shell sessions above keep
        // their identity but state their agent silence (an idle repaint
        // without hooks proves no turn), so the lane's working spinner
        // rides on this launched session.
        session({
          id: "s-3",
          agentState: "working",
          harnessId: "pi",
          command: "pi",
          createdAt: "2026-09-08T11:45:00.000Z",
        }),
      ],
      "",
    );
    try {
      // No `Claude - zsh`, never `Claude - Claude`: the harness label is
      // the whole row text for the observed session, followed by the state
      // the owner's design puts on every row (here: the agent silence —
      // recognition is not turn evidence). Sidebar branding reads
      // "Claude Code" (owner-authorized), carried in the accessible name
      // per label-in-name.
      expect(
        screen.getByRole("button", { name: /Claude Code - No update in/ }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Terminal 2 - .*No update in/ }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Pi - Working" }),
      ).toBeTruthy();
      const observedRow = container.querySelector(
        '[data-worktree-agent-row="s-1"]',
      ) as HTMLElement;
      const shellRow = container.querySelector(
        '[data-worktree-agent-row="s-2"]',
      ) as HTMLElement;
      // The observed session draws the harness mark (no lucide terminal
      // glyph) with the harness title; the plain shell draws the terminal
      // glyph with the Shell title.
      expect(
        observedRow.querySelector('[title="Claude"] svg:not(.lucide)'),
      ).not.toBeNull();
      expect(observedRow.querySelector("svg.lucide-terminal")).toBeNull();
      expect(
        shellRow.querySelector('[title="Shell"] svg.lucide-terminal'),
      ).not.toBeNull();
      // The card lane draws the workspace status ring (no status set here:
      // the dashed neutral ring, never a status the owner did not choose).
      expect(
        container.querySelector('[role="img"][aria-label="No status"]'),
      ).not.toBeNull();
      // The live activity glyph beside it is the working spinner.
      expect(
        container.querySelector(
          '[data-worktree-card-status-slot] [aria-label="Working"]',
        ),
      ).not.toBeNull();
    } finally {
      unmount();
    }
  });

  test("renders no empty-state text when there are no sessions", () => {
    const { container, unmount } = renderCard([], "");
    try {
      // The source's card renders nothing when a worktree has no agents:
      // no placeholder line, no rows.
      expect(screen.queryByText("No sessions yet")).toBeNull();
      expect(
        container.querySelector("[data-worktree-agent-row]"),
      ).toBeNull();
    } finally {
      unmount();
    }
  });
});
