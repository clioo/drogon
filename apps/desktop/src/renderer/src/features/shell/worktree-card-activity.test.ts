import { describe, expect, test } from "vitest";
import type { AgentState, Session } from "../../../../shared/session-contract";
import {
  worktreeActivityClass,
  worktreeActivityGlyph,
  worktreeActivitySentence,
} from "./worktree-card-activity";

function session(
  state: AgentState | undefined,
  verdict: Session["verdict"] = "live",
): Session {
  return {
    id: `s-${state}-${verdict}-${Math.random()}`,
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict,
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    agentState: state,
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
  };
}

describe("worktree card activity", () => {
  test("an empty card has no session at all", () => {
    expect(worktreeActivityClass([])).toBe("no-session");
    expect(worktreeActivitySentence([])).toBe("NO SESSION");
    expect(worktreeActivityGlyph([])).toBeNull();
  });

  test("a waiting agent outranks work in progress", () => {
    const sessions = [session("working"), session("needs_input")];
    expect(worktreeActivityClass(sessions)).toBe("needs-input");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NEEDS INPUT");
    expect(worktreeActivityGlyph(sessions)).toBe("needs-input");
  });

  test("working agents are counted, singular and plural", () => {
    expect(worktreeActivitySentence([session("working")])).toBe(
      "1 AGENT WORKING",
    );
    expect(worktreeActivitySentence([session("working"), session("working")])).toBe(
      "2 AGENTS WORKING",
    );
    expect(worktreeActivityGlyph([session("working")])).toBe("working");
    expect(worktreeActivitySentence([session("working"), session("needs_input")])).toBe(
      "1 AGENT NEEDS INPUT",
    );
  });

  test("idle and exited sessions leave the card with no active agents", () => {
    const sessions = [session("idle"), session("exited", "exited")];
    expect(worktreeActivityClass(sessions)).toBe("no-active-agents");
    expect(worktreeActivitySentence(sessions)).toBe("NO ACTIVE AGENTS");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("sessions that never reported are never claimed as inactive", () => {
    const sessions = [session(undefined)];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivitySentence([session(undefined), session(undefined)])).toBe(
      "2 AGENTS NOT REPORTING",
    );
  });

  test("an unverifiable working verdict reads as not reporting, not as working", () => {
    // `sessionDotState` owns this rule: a refused hold means the recorded
    // working state is history, so the card must not spin for it.
    const sessions = [session("working", "unverifiable")];
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("one live agent among quiet ones still makes the card active", () => {
    const sessions = [session("exited", "exited"), session("working")];
    expect(worktreeActivityClass(sessions)).toBe("working");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT WORKING");
  });
});
