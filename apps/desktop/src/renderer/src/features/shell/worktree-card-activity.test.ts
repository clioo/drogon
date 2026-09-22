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

/** An agent launched through `harness.start`. */
function session(
  state: AgentState | undefined,
  verdict: Session["verdict"] = "live",
): Session {
  return {
    ...shellSession(state, verdict),
    id: `s-${state}-${verdict}-${Math.random()}`,
    harnessId: "pi",
    exitCode: verdict === "exited" ? 0 : null,
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

  test("a shell with unproven working never spins the card (owner's report)", () => {
    // Old-daemon wire derives `working` for a shell from PTY echo/redraw;
    // the turn is unproven, so the card reads not-reporting — never
    // WORKING, and never a manufactured idle. The shell still exists
    // (never NO SESSION).
    const shell = shellSession("working");
    expect(worktreeActivityClass([shell])).toBe("not-reporting");
    expect(worktreeActivitySentence([shell])).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph([shell])).toBeNull();
  });

  test("a busy shell beside a quiet agent still reports no active agents", () => {
    const sessions = [shellSession("working"), session("idle")];
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

  test("an observed harness keeps identity but its repaint proves no turn", () => {
    // Issue #622's shape: the agent started inside a plain shell, so only
    // `observedHarnessId` names it — the row keeps the harness title (see
    // worktree-agent-rows), but an idle repaint without hooks is an
    // unproven turn, so the card never spins for it.
    expect(worktreeActivitySentence([observedSession("working")])).toBe(
      "1 AGENT NOT REPORTING",
    );
    expect(worktreeActivityGlyph([observedSession("working")])).toBeNull();
    expect(worktreeActivitySentence([observedSession("idle")])).toBe(
      "NO ACTIVE AGENTS",
    );
  });

  test("a fresh shell that never reported stays not reporting", () => {
    const sessions = [shellSession(undefined)];
    expect(worktreeActivityClass(sessions)).toBe("not-reporting");
    expect(worktreeActivitySentence(sessions)).toBe("1 AGENT NOT REPORTING");
    expect(worktreeActivityGlyph(sessions)).toBeNull();
  });
});
