import { describe, expect, test } from "vitest";
import {
  formatAheadBehindLabel,
  hasWorktreeCardMetaBadges,
} from "./WorktreeCardMetaBadges";
import {
  getPrChipAccessibleLabel,
  getPrChipLabel,
} from "./worktree-card-pr-display";
import {
  formatWorktreeCardSummaryLine,
  summarizeCardAgentStates,
} from "./worktree-card-agent-summary";
import type { Session } from "../../../../shared/session-contract";

function session(id: string, agentState: Session["agentState"]): Session {
  return {
    id,
    workspaceId: "ws1",
    hostId: "h",
    incarnation: "i",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "",
    agentState,
  };
}

describe("card meta badges projection", () => {
  test("badges hide when nothing is known", () => {
    expect(
      hasWorktreeCardMetaBadges({
        issueNumber: null,
        pr: null,
        ahead: 0,
        behind: 0,
      }),
    ).toBe(false);
    expect(
      hasWorktreeCardMetaBadges({
        issueNumber: 7,
        pr: null,
        ahead: null,
        behind: null,
      }),
    ).toBe(true);
  });

  test("summary line keeps the agent summary and time on one line", () => {
    // The summary already carries the session count, so the line never
    // repeats it and never splits the timestamp onto its own row.
    expect(
      formatWorktreeCardSummaryLine("1 session working", "just now"),
    ).toBe("1 session working · just now");
    expect(
      formatWorktreeCardSummaryLine("1 needs input, 1 working", ""),
    ).toBe("1 needs input, 1 working");
    expect(formatWorktreeCardSummaryLine("", "just now")).toBe("");
  });

  test("ahead/behind label mirrors git.status counts", () => {
    expect(formatAheadBehindLabel(2, 1)).toBe("ahead 2, behind 1");
    expect(formatAheadBehindLabel(0, 3)).toBe("behind 3");
    expect(formatAheadBehindLabel(0, 0)).toBeNull();
    expect(formatAheadBehindLabel(null, null)).toBeNull();
  });

  test("PR chip labels the known review", () => {
    expect(getPrChipLabel({ provider: "github", number: 123, title: "T" })).toBe(
      "PR #123",
    );
    expect(
      getPrChipLabel({ provider: "gitlab", number: 9, title: "T" }),
    ).toBe("MR #9");
    expect(
      getPrChipAccessibleLabel({
        provider: "github",
        number: 123,
        title: "T",
        state: "merged",
      }),
    ).toBe("Linked PR #123: Merged");
    expect(
      getPrChipAccessibleLabel({
        provider: "github",
        number: 123,
        title: "T",
        checks: "failure",
      }),
    ).toBe("Linked PR #123 checks: Failed");
  });

  test("agent summary groups card sessions by state", () => {
    expect(summarizeCardAgentStates([])).toBe("");
    expect(summarizeCardAgentStates([session("a", "working")])).toBe(
      "1 session working",
    );
    expect(
      summarizeCardAgentStates([
        session("a", "working"),
        session("b", "working"),
      ]),
    ).toBe("All sessions working");
    expect(
      summarizeCardAgentStates([
        session("a", "working"),
        session("b", "idle"),
        session("c", "needs_input"),
      ]),
    ).toBe("1 needs input, 1 working, 1 idle");
  });

  test("agent summary renders unknown as not reporting and covers exited", () => {
    expect(summarizeCardAgentStates([session("a", "unknown")])).toBe(
      "1 session not reporting",
    );
    expect(summarizeCardAgentStates([session("a", undefined)])).toBe(
      "1 session not reporting",
    );
    expect(summarizeCardAgentStates([session("a", "exited")])).toBe(
      "1 session exited",
    );
    expect(
      summarizeCardAgentStates([
        session("a", "idle"),
        session("b", "unknown"),
      ]),
    ).toBe("1 idle, 1 not reporting");
  });
});
