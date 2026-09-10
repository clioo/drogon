// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Unit proof for the card summary
   projection (the fork's worktree-card-agent-summary.ts over Sessions):
   the group order the compact pill renders, the aria summary text, and
   the dot the card lane shows — one derivation, so the pill, the label
   and the lane can never disagree. */
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import {
  buildCardSummaryGroups,
  cardDotState,
  summarizeAgentsForAria,
  summarizeCardAgentStates,
  summarizeSessionIdentities,
} from "./worktree-card-agent-summary";

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
    harnessId: "claude",
    ...overrides,
  };
}

describe("buildCardSummaryGroups", () => {
  test("clusters same-state sessions in SUMMARY_STATE_ORDER", () => {
    const groups = buildCardSummaryGroups([
      session({ id: "a", agentState: "idle" }),
      session({ id: "b", agentState: "working" }),
      session({ id: "c", agentState: "working" }),
      session({ id: "d", agentState: "needs_input" }),
    ]);
    expect(groups.map((group) => group.state)).toEqual([
      "needs_input",
      "working",
      "idle",
    ]);
    expect(groups[1]?.sessions.map((item) => item.id)).toEqual(["b", "c"]);
  });

  test("empty input yields no groups", () => {
    expect(buildCardSummaryGroups([])).toEqual([]);
  });
});

describe("summarizeCardAgentStates", () => {
  test("one state names the count and state", () => {
    expect(
      summarizeCardAgentStates([
        session({ agentState: "working" }),
        session({ id: "b", agentState: "working" }),
      ]),
    ).toBe("All sessions working");
  });

  test("mixed states list counts in summary order", () => {
    expect(
      summarizeCardAgentStates([
        session({ agentState: "working" }),
        session({ id: "b", agentState: "exited" }),
      ]),
    ).toBe("1 working, 1 exited");
  });
});

describe("summarizeAgentsForAria", () => {
  test("uniform multi-agent groups replace the session subject with the pill's", () => {
    expect(
      summarizeAgentsForAria(
        [session({ agentState: "working" }), session({ id: "b", agentState: "working" })],
        "2 agents",
      ),
    ).toBe("2 agents working");
  });

  test("mixed groups read 'subject: counts'", () => {
    expect(
      summarizeAgentsForAria(
        [session({ agentState: "working" }), session({ id: "b", agentState: "exited" })],
        "2 agents",
      ),
    ).toBe("2 agents: 1 working, 1 exited");
  });
});

describe("summarizeSessionIdentities", () => {
  test("joins harness label + state per session", () => {
    expect(
      summarizeSessionIdentities(
        [session({ agentState: "working" }), session({ id: "b", harnessId: "pi", agentState: "exited" })],
        (item) => (item.harnessId === "pi" ? "Pi" : "Claude"),
      ),
    ).toBe("Claude working; Pi exited");
  });
});

describe("cardDotState", () => {
  test("the lane dot matches the first group the summary names", () => {
    expect(
      cardDotState([
        session({ agentState: "idle" }),
        session({ id: "b", agentState: "needs_input" }),
      ]),
    ).toBe("needs_input");
    expect(cardDotState([])).toBe("unknown");
  });
});
