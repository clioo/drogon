import { describe, expect, test } from "vitest";
import type { AgentState, Session } from "../../../../shared/session-contract";
import {
  worktreeActivityClass,
  worktreeActivityGlyph,
  worktreeActivitySentence,
} from "./worktree-card-activity";

/**
 * A plain shell: no launched harness, nothing observed. A `working` wire
 * state on one of these is old-daemon PTY-clock output (echo/redraw), not
 * agent inference — the F1 false positive.
 */
function shellSession(
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
    observedHarnessId: null,
  };
}

/**
 * An agent launched through `harness.start` on a current daemon: hook
 * turn states (`working`/`idle`/`needs_input`) carry the hook proof, so
 * these rows model hook-reported turns — never old-daemon PTY-clock wire.
 */
function session(
  state: AgentState | undefined,
  verdict: Session["verdict"] = "live",
): Session {
  return {
    ...shellSession(state, verdict),
    id: `s-${state}-${verdict}-${Math.random()}`,
    harnessId: "pi",
    exitCode: verdict === "exited" ? 0 : null,
    ...(state === "working" || state === "idle" || state === "needs_input"
      ? { agentStateAuthority: "hook" as const }
      : {}),
  };
}

/** An agent started inside an existing shell (issue #622): only observed. */
function observedSession(state: AgentState | undefined): Session {
  return {
    ...shellSession(state),
    id: `s-${state}-observed-${Math.random()}`,
    observedHarnessId: "claude",
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

  test("agents that never reported are never claimed as inactive", () => {
    const sessions = [session(undefined)];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivitySentence([session(undefined), session(undefined)])).toBe(
      "2 AGENTS NOT REPORTING",
    );
  });

  test("a silent known agent beside an exited agent is not claimed as inactive", () => {
    const sessions = [session(undefined), session("exited", "exited")];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("a silent known agent beside a hook-proven idle agent stays not reporting", () => {
    const sessions = [session(undefined), session("idle")];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("a silent known agent beside a retained exited terminal counts only the agent", () => {
    const sessions = [session(undefined), shellSession("exited", "exited")];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("a hook-idle agent beside a fresh silent shell stays quiet without inventing agents", () => {
    const sessions = [session("idle"), shellSession(undefined)];
    expect(worktreeActivityClass(sessions)).toBe("no-active-agents");
    expect(worktreeActivitySentence(sessions)).toBe("NO ACTIVE AGENTS");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("proven turns still win over a silent known agent", () => {
    expect(worktreeActivitySentence([session(undefined), session("working")])).toBe(
      "1 AGENT WORKING",
    );
    expect(
      worktreeActivitySentence([session(undefined), session("needs_input")]),
    ).toBe("1 AGENT NEEDS INPUT");
    expect(
      worktreeActivityClass([session(undefined), session("idle"), session("working")]),
    ).toBe("working");
  });

  test("four silent fixture agents beside one proven idle read as four not reporting", () => {
    const sessions = [
      session(undefined),
      session(undefined),
      session(undefined),
      session(undefined),
      session("idle"),
    ];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("4 AGENTS NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("an unverifiable working verdict reads as not reporting, not as working", () => {
    const sessions = [session("working", "unverifiable")];
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("one live agent among quiet ones still makes the card active", () => {
    const sessions = [session("exited", "exited"), session("working")];
    expect(worktreeActivityClass(sessions)).toBe("working");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT WORKING");
  });

  test("a shell with unproven working never spins the card (owner's report)", () => {
    // Old-daemon wire derives `working` for a shell from PTY echo/redraw;
    // the turn is unproven, and a shell is not an agent — so the card
    // names its session instead of spinning or claiming an agent.
    const shell = shellSession("working");
    expect(worktreeActivityClass([shell])).toBe("terminal-session");
    expect(worktreeActivitySentence([shell])).toBe("1 TERMINAL SESSION");
    expect(worktreeActivityGlyph([shell])).toBeNull();
  });

  test("an all-shell card names its sessions, never an agent and never no session", () => {
    expect(worktreeActivitySentence([shellSession("working")])).toBe(
      "1 TERMINAL SESSION",
    );
    expect(
      worktreeActivitySentence([shellSession("working"), shellSession("idle")]),
    ).toBe("2 TERMINAL SESSIONS");
    expect(worktreeActivitySentence([shellSession(undefined)])).toBe(
      "1 TERMINAL SESSION",
    );
    expect(worktreeActivityClass([shellSession("idle")])).toBe(
      "terminal-session",
    );
    expect(worktreeActivityGlyph([shellSession("idle")])).toBeNull();
  });

  test("a busy shell beside a known working agent is excluded from the agent count", () => {
    const sessions = [
      { ...shellSession("working"), hasForegroundChild: true },
      session("working"),
    ];
    expect(worktreeActivityClass(sessions)).toBe("working");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT WORKING");
    expect(worktreeActivityGlyph(sessions)).toBe("working");
  });

  test("mixed unknown and idle sessions stay quiet without inventing agents", () => {
    // Known idle plus an unidentified shell of unknown activity: the known
    // agent is quiet, the shell is not an agent — never NOT REPORTING.
    const sessions = [session("idle"), shellSession("working")];
    expect(worktreeActivityClass(sessions)).toBe("no-active-agents");
    expect(worktreeActivitySentence(sessions)).toBe("NO ACTIVE AGENTS");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("the sentence counts proven agent turns, not the terminals that host them", () => {
    const sessions = [
      shellSession("working"),
      shellSession("idle"),
      session("working"),
    ];
    expect(worktreeActivityClass(sessions)).toBe("working");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT WORKING");
    expect(worktreeActivityGlyph(sessions)).toBe("working");
  });

  test("mixed known-not-reporting and shell sessions count known agents only", () => {
    const sessions = [observedSession("working"), shellSession("working")];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });

  test("a known observed agent that never reports stays a named agent, not hidden", () => {
    expect(worktreeActivitySentence([observedSession("working")])).toBe(
      "1 AGENT NOT REPORTING",
    );
    expect(worktreeActivityGlyph([observedSession("working")])).toBeNull();
    // A quiet clock is not proof of idleness either: an observed `idle`
    // without hook proof reads not-reporting, never a false quiet — the
    // agent stays named, not hidden and not idle.
    expect(worktreeActivitySentence([observedSession("idle")])).toBe(
      "1 AGENT NOT REPORTING",
    );
    expect(worktreeActivityGlyph([observedSession("idle")])).toBeNull();
  });

  test("an unverifiable plain shell names its session, never an agent", () => {
    const shell = shellSession("working", "unverifiable");
    expect(worktreeActivityClass([shell])).toBe("terminal-session");
    expect(worktreeActivitySentence([shell])).toBe("1 TERMINAL SESSION");
    expect(worktreeActivityGlyph([shell])).toBeNull();
  });

  test("a retained exited terminal is still a session, not no session", () => {
    const retained = shellSession("exited", "exited");
    expect(worktreeActivityClass([retained])).toBe("terminal-session");
    expect(worktreeActivitySentence([retained])).toBe("1 TERMINAL SESSION");
    expect(worktreeActivityGlyph([retained])).toBeNull();
  });

  test("a fresh shell that never reported names its session", () => {
    const sessions = [shellSession(undefined)];
    expect(worktreeActivityClass(sessions)).toBe("terminal-session");
    expect(worktreeActivitySentence(sessions)).toBe("1 TERMINAL SESSION");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });
});
