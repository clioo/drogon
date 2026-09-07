import { describe, expect, it } from "vitest";
import {
  diffAgentStates,
  formatNeedsInput,
  sessionLabelFor,
  worktreeNameFor,
  type WatchedSession,
} from "./watcher";

const session = (
  id: string,
  agentState?: string,
): WatchedSession => ({
  id,
  workspaceId: "ws-1",
  command: "/opt/claude",
  agentState,
  agentStateAt: agentState === "needs_input" ? "2026-09-07T12:00:00Z" : null,
});

describe("diffAgentStates", () => {
  it("reports entering needs_input once, then stays quiet while it holds", () => {
    const first = diffAgentStates(new Map(), [session("a", "needs_input")]);
    expect(first.transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: true },
    ]);
    const second = diffAgentStates(first.next, [session("a", "needs_input")]);
    expect(second.transitions).toEqual([]);
  });

  it("reports leaving needs_input when output resumes", () => {
    const prev = new Map([["a", "needs_input"]]);
    const { next, transitions } = diffAgentStates(prev, [session("a", "working")]);
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
    expect(next.get("a")).toBe("working");
  });

  it("reports leaving for a needs_input session that vanished", () => {
    const { transitions } = diffAgentStates(
      new Map([["a", "needs_input"]]),
      [],
    );
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
  });

  it("ignores steady non-waiting states and defaults missing state to unknown", () => {
    const { next, transitions } = diffAgentStates(
      new Map([["a", "working"]]),
      [session("a", "idle"), session("b")],
    );
    expect(transitions).toEqual([]);
    expect(next.get("a")).toBe("idle");
    expect(next.get("b")).toBe("unknown");
  });
});

describe("sessionLabelFor", () => {
  it("maps known harness executables to display names", () => {
    expect(sessionLabelFor("/usr/local/bin/claude")).toBe("Claude Code");
    expect(sessionLabelFor("pi")).toBe("Pi");
    expect(sessionLabelFor("opencode")).toBe("OpenCode");
    expect(sessionLabelFor("agy")).toBe("Antigravity");
  });

  it("falls back to the command basename, then Terminal", () => {
    expect(sessionLabelFor("/bin/sh")).toBe("sh");
    expect(sessionLabelFor("")).toBe("Terminal");
  });
});

describe("formatNeedsInput", () => {
  it("reads as '<label> needs your input in <worktree>'", () => {
    const { title, body } = formatNeedsInput(
      session("a", "needs_input"),
      "/repos/shop/wt-1",
    );
    expect(`${title} ${body}`).toBe(
      "Claude Code needs your input in wt-1",
    );
  });

  it("falls back to the workspace wording without a path", () => {
    const { body } = formatNeedsInput(session("a", "needs_input"), null);
    expect(body).toBe("in the workspace");
  });

  it("uses the last path segment for the worktree name", () => {
    expect(worktreeNameFor("/repos/shop/wt-1")).toBe("wt-1");
    expect(worktreeNameFor("C:\\repos\\wt-2")).toBe("wt-2");
  });
});
