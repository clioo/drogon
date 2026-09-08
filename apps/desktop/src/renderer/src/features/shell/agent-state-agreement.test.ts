import { describe, expect, test } from "vitest";
import type {
  AgentState,
  Session,
} from "../../../../shared/session-contract";
import { sessionDotState } from "./agent-state";
import {
  cardDotState,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import { summarizeCardSessions } from "./project-adapter";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    workspaceId: "w1",
    hostId: "h",
    incarnation: "i1",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

const STATES: AgentState[] = [
  "needs_input",
  "working",
  "exited",
  "unknown",
  "idle",
];

describe("agent-state agreement (#194)", () => {
  test("one session renders the same state in the tab badge, card dot and card text", () => {
    for (const agentState of STATES) {
      const item = session({ id: agentState, agentState });
      // Tab badge input and card dot share the single derivation.
      expect(sessionDotState(item)).toBe(agentState);
      expect(cardDotState([item])).toBe(agentState);
      // The card text names that same state for a uniform group.
      expect(summarizeCardSessions([item]).state).toBe(agentState);
      expect(summarizeCardAgentStates([item])).toContain(
        agentState === "needs_input"
          ? "needs input"
          : agentState === "unknown"
            ? "not reporting"
            : agentState,
      );
    }
  });

  test("a mixed card dots the priority group, never the freshest stamp", () => {
    // The issue's case: the freshest session is idle but an older one is
    // still working — the dot must stay working, matching the text.
    const attached = [
      session({
        id: "old-working",
        agentState: "working",
        agentStateAt: "2026-09-07T10:00:00Z",
      }),
      session({
        id: "new-idle",
        agentState: "idle",
        agentStateAt: "2026-09-07T11:30:00Z",
      }),
    ];
    const summary = summarizeCardSessions(
      attached,
      Date.parse("2026-09-07T12:00:00Z"),
    );
    expect(summary.state).toBe("working");
    expect(cardDotState(attached)).toBe("working");
    expect(summarizeCardAgentStates(attached)).toBe("1 working, 1 idle");
    // The stamp is still the freshest live report (last real change).
    expect(summary.activeRelative).toBe("30m ago");
  });

  test("all idle with ancient stamps stays self-consistent, never phantom working", () => {
    // The issue's "2 working, 1 idle 33m ago" with zero daemon activity:
    // once the states agree, an old stamp reads as idleness, not work.
    const now = Date.parse("2026-09-08T05:00:00Z");
    const attached = [
      session({
        id: "a",
        agentState: "idle",
        agentStateAt: "2026-09-08T04:26:39Z",
      }),
      session({
        id: "b",
        agentState: "idle",
        agentStateAt: "2026-09-08T04:33:36Z",
      }),
    ];
    const summary = summarizeCardSessions(attached, now);
    expect(summary.state).toBe("idle");
    expect(cardDotState(attached)).toBe("idle");
    expect(sessionDotState(attached[0])).toBe("idle");
    expect(sessionDotState(attached[1])).toBe("idle");
    expect(summarizeCardAgentStates(attached)).toBe("All sessions idle");
    expect(summary.activeRelative).toBe("26m ago");
    expect(summary.unread).toBe(false);
  });

  test("any needs_input wins the dot and raises unread", () => {
    const attached = [
      session({ id: "idle", agentState: "idle" }),
      session({ id: "wait", agentState: "needs_input" }),
    ];
    const summary = summarizeCardSessions(attached);
    expect(summary.state).toBe("needs_input");
    expect(summary.unread).toBe(true);
    expect(cardDotState(attached)).toBe("needs_input");
  });

  test("the stamp follows live reports, never a fixed mount time", () => {
    const now = Date.parse("2026-09-07T12:00:00Z");
    // No stamps anywhere: no stamp shown, not the session age.
    expect(
      summarizeCardSessions(
        [session({ id: "a", agentState: "working" })],
        now,
      ).activeRelative,
    ).toBe("");
    // An invalid stamp is ignored in favour of the valid live one.
    expect(
      summarizeCardSessions(
        [
          session({
            id: "a",
            agentState: "working",
            agentStateAt: "not-a-date",
          }),
          session({
            id: "b",
            agentState: "idle",
            agentStateAt: "2026-09-07T11:50:00Z",
          }),
        ],
        now,
      ).activeRelative,
    ).toBe("10m ago");
  });

  test("unreported states dot unknown and count as not reporting", () => {
    const item = session({ id: "quiet" });
    expect(sessionDotState(item)).toBe("unknown");
    expect(cardDotState([item])).toBe("unknown");
    expect(summarizeCardSessions([item]).state).toBe("unknown");
    expect(summarizeCardAgentStates([item])).toBe("1 session not reporting");
  });
});
