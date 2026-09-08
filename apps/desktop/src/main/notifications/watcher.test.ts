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

  it("stays quiet while non-waiting states hold and defaults missing state to unknown", () => {
    const { next, transitions } = diffAgentStates(
      new Map([
        ["a", "idle"],
        ["b", "unknown"],
      ]),
      [session("a", "idle"), session("b")],
    );
    expect(transitions).toEqual([]);
    expect(next.get("a")).toBe("idle");
    expect(next.get("b")).toBe("unknown");
  });

  it("forwards activity transitions without notifying (idle shell leaves working)", () => {
    const { transitions } = diffAgentStates(
      new Map([["a", "working"]]),
      [session("a", "idle")],
    );
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
  });

  it("forwards a command starting in an idle shell (idle back to working)", () => {
    const { transitions } = diffAgentStates(
      new Map([["a", "idle"]]),
      [session("a", "working")],
    );
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
  });

  it("forwards a first report replacing unknown (plain shell prints its prompt)", () => {
    const { transitions } = diffAgentStates(
      new Map([["a", "unknown"]]),
      [session("a", "working")],
    );
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
  });

  it("forwards a session reaching exited without notifying", () => {
    const { transitions } = diffAgentStates(new Map([["a", "working"]]), [
      { ...session("a", "working"), agentState: "exited", agentStateAt: null },
    ]);
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
  });

  it("treats a first sighting as the baseline unless it is already waiting", () => {
    const { transitions } = diffAgentStates(new Map(), [
      session("a", "working"),
      session("b"),
    ]);
    expect(transitions).toEqual([]);
  });

  it("#272: with emitFirstSightings a new session is forwarded without notifying", () => {
    const first = diffAgentStates(new Map(), [session("a", "working")], {
      emitFirstSightings: true,
    });
    // Primed but genuinely new sessions forward so the selected
    // workspace's strip refetches (#272); the event never notifies.
    expect(first.transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: false },
    ]);
    const second = diffAgentStates(
      first.next,
      [session("a", "working"), session("b", "idle")],
      { emitFirstSightings: true },
    );
    expect(second.transitions).toEqual([
      { session: expect.objectContaining({ id: "b" }), entered: false },
    ]);
  });

  it("#272: emitFirstSightings still notifies a session that arrives already waiting", () => {
    const { transitions } = diffAgentStates(
      new Map(),
      [session("a", "needs_input")],
      { emitFirstSightings: true },
    );
    expect(transitions).toEqual([
      { session: expect.objectContaining({ id: "a" }), entered: true },
    ]);
  });
});

describe("sessionLabelFor", () => {
  it("prefers the harnessId display name over the process basename", () => {
    // The R15-C wart: a Pi session launched through a bundle path must not
    // read as "cli.js needs your input".
    expect(sessionLabelFor("/bundle/cli.js", "pi")).toBe("Pi");
    expect(sessionLabelFor("/bundle/cli.js", "claude")).toBe("Claude Code");
    expect(sessionLabelFor("/bundle/cli.js", "opencode")).toBe("OpenCode");
    expect(sessionLabelFor("/bundle/cli.js", "antigravity")).toBe(
      "Antigravity",
    );
  });

  it("maps known harness executables to display names", () => {
    expect(sessionLabelFor("/usr/local/bin/claude")).toBe("Claude Code");
    expect(sessionLabelFor("pi")).toBe("Pi");
    expect(sessionLabelFor("opencode")).toBe("OpenCode");
    expect(sessionLabelFor("agy")).toBe("Antigravity");
  });

  it("falls back to the command basename, then Terminal", () => {
    expect(sessionLabelFor("/bin/sh")).toBe("sh");
    expect(sessionLabelFor("")).toBe("Terminal");
    expect(sessionLabelFor("/bundle/cli.js", "unknown-harness")).toBe(
      "cli.js",
    );
    expect(sessionLabelFor("/bundle/cli.js", null)).toBe("cli.js");
  });
});

describe("formatNeedsInput", () => {
  it("reads as the fork's '<workspace> - <label> needs input'", () => {
    const { title, body } = formatNeedsInput(
      session("a", "needs_input"),
      "wt-1",
    );
    expect(title).toBe("wt-1 - Claude Code needs input");
    expect(body).toBe("Claude Code needs input.");
  });

  it("labels by harnessId even when the command is a bundle path", () => {
    const { title, body } = formatNeedsInput(
      {
        id: "a",
        workspaceId: "ws-1",
        command: "/bundle/cli.js",
        harnessId: "pi",
        agentState: "needs_input",
        agentStateAt: "2026-09-07T12:00:00Z",
      },
      "wt-1",
    );
    expect(title).toBe("wt-1 - Pi needs input");
    expect(body).toBe("Pi needs input.");
  });

  it("falls back to the workspace wording without a name", () => {
    const { title, body } = formatNeedsInput(
      session("a", "needs_input"),
      null,
    );
    expect(title).toBe("workspace - Claude Code needs input");
    expect(body).toBe("Claude Code needs input.");
  });

  it("uses the last path segment for the worktree name", () => {
    expect(worktreeNameFor("/repos/shop/wt-1")).toBe("wt-1");
    expect(worktreeNameFor("C:\\repos\\wt-2")).toBe("wt-2");
  });
});
