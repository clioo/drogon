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
  defaultTitleBySession,
  formatCompactDuration,
  formatRowHarnessLabel,
  formatShortTimeAgo,
  resolveRowHarnessId,
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

  it("defaultTitleBySession matches row numbering, for the stale-copy heal", () => {
    const defaults = defaultTitleBySession(
      [
        session({ id: "s-1", createdAt: "2026-09-08T11:00:00.000Z" }),
        session({
          id: "s-2",
          createdAt: "2026-09-08T11:30:00.000Z",
          harnessId: "claude",
        }),
        session({ id: "s-3", createdAt: "2026-09-08T11:45:00.000Z" }),
      ],
      { stripOrder: ["s-1", "s-2", "s-3"], pinnedIds: ["s-3"] },
    );
    // Pinned shell first, harness reads its label, numbering counts all.
    expect(defaults.get("s-3")).toBe("Terminal 1");
    expect(defaults.get("s-2")).toBe("Claude");
    expect(defaults.get("s-1")).toBe("Terminal 2");
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
        session({
          id: "s-1",
          agentState: "working",
          harnessId: "pi",
          agentStateAuthority: "hook",
        }),
        session({
          id: "s-2",
          agentState: "idle",
          harnessId: "pi",
          agentStateAuthority: "hook",
        }),
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

  it("groups a shell's unproven working with the not-reporting rows", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({ id: "s-1", agentState: "working", harnessId: null }),
        session({
          id: "s-2",
          agentState: "idle",
          harnessId: "pi",
          agentStateAuthority: "hook",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows.map((row) => row.state)).toEqual(["unknown", "idle"]);
    expect(
      summarizeCardAgentStates(rows.map((row) => row.session)),
    ).toBe("1 not reporting, 1 idle");
  });
});

describe("resolved harness (issue #622, B1)", () => {
  it("answers launch harness, else observed harness, else null", () => {
    expect(resolveRowHarnessId(session())).toBeNull();
    expect(
      resolveRowHarnessId(session({ observedHarnessId: "claude" })),
    ).toBe("claude");
    expect(resolveRowHarnessId(session({ harnessId: "pi" }))).toBe("pi");
    // The launch harness wins over a stale observation.
    expect(
      resolveRowHarnessId(
        session({ harnessId: "claude", observedHarnessId: "pi" }),
      ),
    ).toBe("claude");
  });

  it("labels a session running an agent by harness, shells keep Terminal N", () => {
    // Identity (title) is recognition, not a turn claim: it holds while
    // the unproven turn states the agent silence in the secondary slot.
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          agentState: "idle",
          harnessId: null,
          observedHarnessId: "claude",
          command: "/bin/zsh",
          createdAt: "2026-09-08T11:00:00.000Z",
        }),
        session({
          id: "s-2",
          agentState: "idle",
          harnessId: null,
          command: "/bin/zsh",
          createdAt: "2026-09-08T11:30:00.000Z",
        }),
      ],
      { nowMs: NOW },
    );
    // The observed session reads the harness label, not a terminal number.
    expect(rows.find((row) => row.session.id === "s-1")?.title).toBe("Claude");
    expect(rows.find((row) => row.session.id === "s-1")?.secondary).toBe(
      "No update in 1m",
    );
    // The genuine plain shell still reads exactly what its tab reads.
    expect(rows.find((row) => row.session.id === "s-2")?.title).toBe(
      "Terminal 2",
    );
    expect(rows.find((row) => row.session.id === "s-2")?.secondary).toBe(
      "No update in 1m",
    );
  });

  it("keeps a harness.start session on its harness identity", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          harnessId: "claude",
          observedHarnessId: "pi",
          command: "/bin/zsh",
          agentStateAuthority: "hook",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows[0]?.title).toBe("Claude");
    expect(rows[0]?.secondary).toBe("");
  });

  it("a custom rename still wins over the harness label", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          agentState: "idle",
          harnessId: "codex",
          agentStateAuthority: "hook",
        }),
      ],
      { nowMs: NOW, customTitles: { "s-1": "Setup" } },
    );
    expect(rows[0]?.title).toBe("Setup");
    // ...but the secondary still names the harness behind the rename.
    expect(rows[0]?.secondary).toBe("Codex");
  });

  it("never reads `Claude - zsh` or `Claude - Claude`", () => {
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: "claude",
          agentStateAuthority: "hook",
          command: "/bin/zsh",
        }),
        NOW,
        "Claude",
      ),
    ).toBe("");
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: "claude",
          agentStateAuthority: "hook",
        }),
        NOW,
        "Claude",
      ),
    ).toBe("");
  });
});

describe("row copy", () => {
  it("names harness sessions by harness and shells by command", () => {
    expect(
      resolveRowSecondary(
        session({
          agentState: "working",
          harnessId: "pi",
          agentStateAuthority: "hook",
        }),
        NOW,
      ),
    ).toBe("Pi");
    // A quiet shell states the agent silence, never a guessed command
    // activity: the command still names the row's title and tab.
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: null,
          command: "/usr/local/bin/fish",
        }),
        NOW,
      ),
    ).toBe("No update in 1m");
    // ...while a shell with a terminal truth of its own (exited) still
    // names its command after the dash.
    expect(
      resolveRowSecondary(
        session({
          agentState: "exited",
          harnessId: null,
          command: "/usr/local/bin/fish",
        }),
        NOW,
        "Terminal 1",
      ),
    ).toBe("fish");
    expect(formatRowHarnessLabel(null)).toBe("Shell");
    expect(formatRowHarnessLabel("claude")).toBe("Claude");
    expect(formatRowHarnessLabel("opencode")).toBe("OpenCode");
    expect(formatRowHarnessLabel("antigravity")).toBe("Antigravity");
    expect(formatRowHarnessLabel("codex")).toBe("Codex");
  });

  it("shows the session's message preview after the dash, like the fork's last-message slot", () => {
    // The reference draws the agent's last assistant line / tool preview
    // (worktree-card-compact-agent-row.tsx). Drogon's session contract
    // carries no last-message field, so the row shows the daemon's bounded
    // first-known prompt preview — real message text, never invented.
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: "claude",
          agentStateAuthority: "hook",
          agentPromptPreview: "Refactor the sidebar card order",
        }),
        NOW,
        "Terminal 1",
      ),
    ).toBe("Refactor the sidebar card order");
    // A row whose title is already derived from that same prompt keeps the
    // identity text instead of repeating the title after the dash.
    expect(
      resolveRowSecondary(
        session({
          agentState: "idle",
          harnessId: "claude",
          agentStateAuthority: "hook",
          agentPromptPreview: "Refactor the sidebar card order",
        }),
        NOW,
        "Refactor the sidebar card order",
      ),
    ).toBe("Claude");
    // The freshness report still wins while the agent is not reporting.
    expect(
      resolveRowSecondary(
        session({
          agentState: "unknown",
          harnessId: "claude",
          agentPromptPreview: "Refactor the sidebar card order",
          agentStateAt: null,
          createdAt: "2026-09-08T11:26:00.000Z",
        }),
        NOW,
        "Terminal 1",
      ),
    ).toBe("No update in 34m");
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

describe("shell truthfulness (owner's report, F1)", () => {
  it("a shell's unproven working reads not-reporting, never Working nor Idle", () => {
    // Old-daemon wire: echo/redraw bytes inside the activity window derive
    // `working` for a harness-less shell. The turn is unproven, so the row
    // keeps its tab-exact terminal title but states the agent silence —
    // never a Working claim, never a manufactured Idle.
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          agentState: "working",
          harnessId: null,
          observedHarnessId: null,
          command: "/bin/zsh",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("unknown");
    expect(rows[0].title).toBe("Terminal 1");
    expect(rows[0].secondary).toBe("No update in 1m");
    expect(rows[0].stateLabel).toBe("No update in 1m");
    expect(rows[0].relativeTime).toBe("1m");
  });

  it("an observed harness keeps its identity with an unknown turn", () => {
    // Issue #622 plus the repaint guardrail: the row still reads Pi with
    // the harness mark (recognized, not hidden), but an idle repaint
    // without hooks proves no turn, so the state is the agent silence.
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          agentState: "working",
          harnessId: null,
          observedHarnessId: "pi",
          command: "/bin/zsh",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows[0].state).toBe("unknown");
    expect(rows[0].title).toBe("Pi");
    expect(rows[0].secondary).toBe("No update in 1m");
    expect(rows[0].stateLabel).toBe("No update in 1m");
  });

  it("a launched harness keeps its working row beside quiet shells", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          createdAt: "2026-09-08T11:00:00.000Z",
          agentState: "working",
          harnessId: null,
          observedHarnessId: null,
          command: "/bin/zsh",
        }),
        session({
          id: "s-2",
          createdAt: "2026-09-08T11:30:00.000Z",
          agentState: "working",
          harnessId: "pi",
          agentStateAuthority: "hook",
        }),
      ],
      { nowMs: NOW },
    );
    // Only a proven agent turn reads working; the shell states its silence.
    expect(rows.map((row) => row.state)).toEqual(["unknown", "working"]);
    expect(rows.map((row) => row.title)).toEqual(["Terminal 1", "Pi"]);
    expect(rows.map((row) => row.stateLabel)).toEqual([
      "No update in 1m",
      "Working",
    ]);
  });

  it("a fresh shell keeps its not-reporting fallback row", () => {
    const rows = buildWorktreeAgentRows(
      [
        session({
          id: "s-1",
          agentState: undefined,
          agentStateAt: null,
          harnessId: null,
          observedHarnessId: null,
          command: "/bin/zsh",
        }),
      ],
      { nowMs: NOW },
    );
    expect(rows[0].state).toBe("unknown");
    expect(rows[0].title).toBe("Terminal 1");
    expect(rows[0].secondary).toBe("No update in 1h");
    expect(rows[0].stateLabel).toBe("No update in 1h");
  });
});
