// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Card-level proof for R16-AN
   (fixes #229): the worktree card nests one row per session under the
   summary line, the focused row follows the active tab, and the summary
   counts come from the same rows. */
import React from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session, Workspace, Worktree } from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
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
      onCreateWorktree={null}
      />
    </TooltipProvider>,
  );
}

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
      // Harness session row: tab title + harness identity.
      expect(screen.getByRole("button", { name: /Terminal 1.*Claude/ })).toBeTruthy();
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
        session({ id: "s-1", agentState: "working" }),
        session({ id: "s-2", agentState: "idle" }),
      ],
      "s-2",
    );
    try {
      expect(
        container.querySelector('[data-focused-agent-pane="true"]'),
      ).toBeTruthy();
      // Collapsed counts derived from the same rows the card nests.
      screen.getByText(/1 working, 1 idle/);
    } finally {
      unmount();
    }
  });

  test("shows the empty state with no rows when there are no sessions", () => {
    const { container, unmount } = renderCard([], "");
    try {
      screen.getByText("No sessions yet");
      expect(
        container.querySelector("[data-worktree-agent-row]"),
      ).toBeNull();
    } finally {
      unmount();
    }
  });
});
