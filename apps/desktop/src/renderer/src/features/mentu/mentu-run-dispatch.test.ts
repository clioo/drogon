// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The Run Recipe delivery seam: which session is "main", what exactly is
// delivered, and the refusals. These are the behaviors the owner asked to
// be defined honestly — no session, a busy TUI, a dead TUI — so each one is
// asserted with the write NOT happening.

import { describe, expect, it, vi } from "vitest";
import type { Result, Session } from "../../../../shared/session-contract";
import {
  composeMentuRunPrompt,
  dispatchMentuRunPrompt,
  isMentuMainSessionLive,
  MENTU_RUN_PROMPT_MAX_BYTES,
  pickMentuMainSession,
  type MentuDispatchDeps,
} from "./mentu-run-dispatch";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-shell",
    workspaceId: "ws",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-07T00:00:00Z",
    agentState: "idle",
    ...overrides,
  };
}

const ok = <T,>(result: T): Result<T> => ({ ok: true, result });
const failure = (message: string): Result<never> => ({
  ok: false,
  error: { code: "internal_error", message, retryable: false },
});

function deps(
  sessions: Session[],
  write: MentuDispatchDeps["write"] = vi.fn(async () => ok({ acceptedBytes: 1 })),
): { deps: MentuDispatchDeps; write: ReturnType<typeof vi.fn> } {
  return {
    deps: {
      sessions: async () => ok({ sessions }),
      write,
    },
    write: write as unknown as ReturnType<typeof vi.fn>,
  };
}

describe("pickMentuMainSession", () => {
  it("prefers the active agent session and never picks a plain shell", () => {
    const shell = session({ id: "s-shell" });
    const agent = session({
      id: "s-agent",
      command: "claude",
      harnessId: "claude",
    });
    expect(pickMentuMainSession([shell, agent], "s-shell")?.id).toBe("s-agent");
    expect(pickMentuMainSession([shell], null)).toBeNull();
  });

  it("falls back to the newest live agent session and skips exited ones", () => {
    const older = session({
      id: "s-old",
      harnessId: "pi",
      createdAt: "2026-09-07T00:00:00Z",
    });
    const newer = session({
      id: "s-new",
      harnessId: "codex",
      createdAt: "2026-09-07T01:00:00Z",
    });
    const exited = session({
      id: "s-dead",
      harnessId: "claude",
      createdAt: "2026-09-07T02:00:00Z",
      verdict: "exited",
      agentState: "exited",
    });
    expect(pickMentuMainSession([older, newer, exited], null)?.id).toBe("s-new");
    // A live session always wins over a dead one, even the active tab.
    expect(pickMentuMainSession([older, exited], "s-dead")?.id).toBe("s-old");
    // A dead session is still RETURNED when it is all the workspace has, so
    // the dispatcher can say "it exited" instead of "you never had one".
    expect(pickMentuMainSession([exited], "s-dead")?.id).toBe("s-dead");
    expect(isMentuMainSessionLive(exited)).toBe(false);
    expect(isMentuMainSessionLive(null)).toBe(false);
    expect(isMentuMainSessionLive(older)).toBe(true);
  });
});

describe("composeMentuRunPrompt", () => {
  const input = {
    workspaceId: "ws-1",
    recipeId: "hello",
    contentHash: "a".repeat(64),
    approvalId: "appr-1",
  };

  it("is deterministic and a single line, so the PTY cannot submit it early", () => {
    const first = composeMentuRunPrompt(input);
    expect(first).toBe(composeMentuRunPrompt(input));
    expect(first).not.toContain("\n");
    expect(first).not.toContain("\r");
  });

  it("stays under the PTY canonical-line budget even with a long recipe id", () => {
    // A cooked-mode PTY (any shell standing in as a harness) buffers at most
    // MAX_CANON bytes per line; a longer prompt loses its Enter.
    const long = composeMentuRunPrompt({ ...input, recipeId: "r".repeat(120) });
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(
      MENTU_RUN_PROMPT_MAX_BYTES,
    );
  });

  it("names the exact approved bytes and the drogon-cli command the agent must run", () => {
    const prompt = composeMentuRunPrompt(input);
    expect(prompt).toContain('recipe "hello"');
    expect(prompt).toContain('workspace "ws-1"');
    expect(prompt).toContain("approval appr-1");
    expect(prompt).toContain("drogon-cli skills get --topic drogon-cli");
    expect(prompt).toContain(
      "drogon-cli mentu run --workspace ws-1 --recipe hello --approval appr-1 --follow",
    );
    expect(prompt).toContain("drogon-cli mentu cancel --run <RUN-ID>");
    expect(prompt).toContain("do not edit the recipe");
  });
});

describe("dispatchMentuRunPrompt", () => {
  const prompt = "run the recipe";

  it("writes the prompt plus one Enter once the main session is idle", async () => {
    const agent = session({ id: "s-agent", harnessId: "pi", agentState: "idle" });
    const { deps: dispatchDeps, write } = deps([agent]);
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe("s-agent");
      // `waitedMs` is wall-clock, so it is bounded rather than exact: the
      // point of the assertion is that an idle session dispatches without
      // a full wait budget elapsing.
      expect(result.waitedMs).toBeGreaterThanOrEqual(0);
      expect(result.waitedMs).toBeLessThan(1_000);
    }
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      sessionId: "s-agent",
      incarnation: "inc-1",
      text: `${prompt}\r`,
    });
  });

  it("refuses with no-session when the workspace has no agent session", async () => {
    const { deps: dispatchDeps, write } = deps([session({ id: "s-shell" })]);
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
    });
    expect(result).toEqual({ ok: false, failure: { kind: "no-session" } });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a dead main session and never types into it", async () => {
    const agent = session({
      id: "s-agent",
      harnessId: "claude",
      verdict: "exited",
      agentState: "exited",
    });
    const { deps: dispatchDeps, write } = deps([agent]);
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "session-exited", sessionId: "s-agent" },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a session waiting for input instead of answering its prompt", async () => {
    const agent = session({
      id: "s-agent",
      harnessId: "claude",
      agentState: "needs_input",
    });
    const { deps: dispatchDeps, write } = deps([agent]);
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "session-needs-input", sessionId: "s-agent" },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("waits out a mid-turn session, then delivers once it goes idle", async () => {
    let calls = 0;
    const working = session({
      id: "s-agent",
      harnessId: "claude",
      agentState: "working",
    });
    const idle = { ...working, agentState: "idle" as const };
    const write = vi.fn(async () => ok({ acceptedBytes: 1 }));
    const dispatchDeps: MentuDispatchDeps = {
      sessions: async () => {
        calls += 1;
        return ok({ sessions: [calls < 3 ? working : idle] });
      },
      write,
    };
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
      waitMs: 5_000,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("refuses a session that stays busy past the wait instead of typing blindly", async () => {
    const working = session({
      id: "s-agent",
      harnessId: "claude",
      agentState: "working",
    });
    const { deps: dispatchDeps, write } = deps([working]);
    const result = await dispatchMentuRunPrompt(dispatchDeps, {
      workspaceId: "ws",
      activeSessionId: null,
      prompt,
      waitMs: 0,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "session-busy", sessionId: "s-agent", agentState: "working" },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("reports a write refusal and a session-list failure verbatim", async () => {
    const agent = session({ id: "s-agent", harnessId: "pi" });
    const write = vi.fn(async () => failure("pty is gone"));
    const refused = await dispatchMentuRunPrompt(
      { sessions: async () => ok({ sessions: [agent] }), write },
      { workspaceId: "ws", activeSessionId: null, prompt },
    );
    expect(refused).toEqual({
      ok: false,
      failure: { kind: "write-failed", sessionId: "s-agent", message: "pty is gone" },
    });

    const listed = await dispatchMentuRunPrompt(
      {
        sessions: async () => failure("daemon unreachable"),
        write,
      },
      { workspaceId: "ws", activeSessionId: null, prompt },
    );
    expect(listed).toEqual({
      ok: false,
      failure: { kind: "list-failed", message: "daemon unreachable" },
    });
  });
});
