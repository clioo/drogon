/* MIT Copyright (c) 2026 Lovecast Inc. Row derivation for the worktree
   card's nested session list (R16-AN, fixes #229): one row per session in
   row order, tab-exact titles, fork-verbatim freshness copy, focused
   highlight, and summary counts from the same rows. */
import { describe, expect, it } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import {
  agentNoUpdateLabel,
  buildWorktreeAgentRows,
  compareWorktreeAgentRows,
  formatCompactDuration,
  formatRowHarnessLabel,
  formatShortTimeAgo,
  resolveRowSecondary,
  rowEvidenceMs,
} from "./worktree-agent-rows";
import { summarizeCardAgentStates } from "./worktree-card-agent-summary";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");

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

describe("buildWorktreeAgentRows", () => {
  it("yields one row per session, even one that never reported (fallback row)", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({ id: "s-1", agentState: "working", harnessId: "claude" }),
        session({
          id: "s-2",
          agentState: undefined,
          agentStateAt: null,
          command: "/bin/bash",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows.map((row) => row.session.id)).toEqual(["s-1", "s-2"]);
    const fallback = rows[1];
    expect(fallback.state).toBe("unknown");
    expect(fallback.title).toBe("Terminal 2");
    expect(fallback.secondary).toBe("No update in 1h");
    expect(fallback.focused).toBe(false);
  });

  it("orders by creation time, then session id", () => {
    const late = session({ id: "s-b", createdAt: "2026-09-08T11:30:00.000Z" });
    const early = session({ id: "s-a", createdAt: "2026-09-08T11:00:00.000Z" });
    expect([late, early].sort(compareWorktreeAgentRows).map((s) => s.id)).toEqual([
      "s-a",
      "s-b",
    ]);
    const tied = [
      session({ id: "s-2", createdAt: "2026-09-08T11:00:00.000Z" }),
      session({ id: "s-1", createdAt: "2026-09-08T11:00:00.000Z" }),
    ].sort(compareWorktreeAgentRows);
    expect(tied.map((s) => s.id)).toEqual(["s-1", "s-2"]);
  });

  it("resolves titles exactly like the tab strip (rename wins, strip position, recovery suffix)", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({ id: "s-1", createdAt: "2026-09-08T11:00:00.000Z" }),
        session({ id: "s-2", createdAt: "2026-09-08T11:30:00.000Z" }),
      ],
      {
        nowMs: NOW,
        stripOrder: ["s-2", "s-1"],
        customTitles: { "s-1": "Setup" },
      },
    );
    // s-2 is first in strip order (Terminal 1); s-1 keeps its rename.
    expect(rows.find((row) => row.session.id === "s-2")?.title).toBe(
      "Terminal 1",
    );
    expect(rows.find((row) => row.session.id === "s-1")?.title).toBe("Setup");
  });

  it("numbers pinned tabs first, like the strip", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({ id: "s-1", createdAt: "2026-09-08T11:00:00.000Z" }),
        session({ id: "s-2", createdAt: "2026-09-08T11:30:00.000Z" }),
      ],
      { nowMs: NOW, stripOrder: ["s-1", "s-2"], pinnedIds: ["s-2"] },
    );
    expect(rows.find((row) => row.session.id === "s-2")?.title).toBe(
      "Terminal 1",
    );
  });

  it("marks the unverifiable verdict with the recovery suffix, like its tab", () => {
    const rows = buildWorktreeAgentRows(
      [session({ id: "s-9", verdict: "unverifiable", incarnation: "7" })],
      { nowMs: NOW },
    );
    expect(rows[0].title).toBe("Terminal 1 · s-9:7");
  });

  it("flags the active tab's row for the focused highlight", () => {
    const rows = buildWorktreeAgentRows(
      [session({ id: "s-1" }), session({ id: "s-2" })],
      { nowMs: NOW, activeSessionId: "s-2" },
    );
    expect(rows.map((row) => row.focused)).toEqual([false, true]);
  });

  it("derives the collapsed summary counts from the same rows", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({ id: "s-1", agentState: "working" }),
        session({ id: "s-2", agentState: "idle" }),
      ],
      { nowMs: NOW },
    );
    expect(
      summarizeCardAgentStates(rows.map((row) => row.session)),
    ).toBe("1 working, 1 idle");
    const lone = buildWorktreeAgentRows(
      [session({ id: "s-3", agentState: undefined, agentStateAt: null })],
      { nowMs: NOW },
    );
    // The fork's bucket label for non-reporting rows, kept verbatim.
    expect(summarizeCardAgentStates(lone.map((row) => row.session))).toBe(
      "1 session not reporting",
    );
  });
});

describe("row copy", () => {
  it("names harness sessions by harness and shells by command", () => {
    expect(
      resolveRowSecondary(
        session({ agentState: "working", harnessId: "pi" }),
        NOW,
      ),
    ).toBe("Pi");
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: null,
          command: "/usr/local/bin/fish",
        }),
        NOW,
      ),
    ).toBe("fish");
    expect(formatRowHarnessLabel(null)).toBe("Shell");
    expect(formatRowHarnessLabel("claude")).toBe("Claude");
    expect(formatRowHarnessLabel("opencode")).toBe("OpenCode");
    expect(formatRowHarnessLabel("antigravity")).toBe("Antigravity");
    expect(formatRowHarnessLabel("codex")).toBe("Codex");
  });

  it("reports silence with the fork's freshness copy", () => {
    expect(agentNoUpdateLabel(NOW - 34 * 60_000, NOW)).toBe(
      "No update in 34m",
    );
    // Evidence falls back to creation when the session never reported.
    expect(
      rowEvidenceMs(
        session({
          agentStateAt: null,
          createdAt: "2026-09-08T10:00:00.000Z",
        }),
      ),
    ).toBe(Date.parse("2026-09-08T10:00:00.000Z"));
  });

  it("formats compact durations and ages like the fork", () => {
    expect(formatCompactDuration(0)).toBe("0m");
    expect(formatCompactDuration(22 * 60_000)).toBe("22m");
    expect(formatCompactDuration(3 * 3_600_000)).toBe("3h");
    expect(formatCompactDuration(2 * 86_400_000)).toBe("2d");
    expect(formatShortTimeAgo(NOW - 10_000, NOW)).toBe("now");
    expect(formatShortTimeAgo(NOW - 22 * 60_000, NOW)).toBe("22m");
    expect(formatShortTimeAgo(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(formatShortTimeAgo(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });
});
