import { describe, expect, it } from "vitest";
import {
  botHandleLabel,
  botInitials,
  botSessionState,
  botSessionTitle,
  formatBotSessionStarted,
  formatElapsedClock,
  harnessProviderLabel,
} from "./bot-session-chrome";
import type { Session } from "../../../../shared/session-contract";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "pi",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("bot-session-chrome", () => {
  it("labels the harness with its real vendor", () => {
    expect(harnessProviderLabel("claude")).toBe("Claude (Anthropic)");
    expect(harnessProviderLabel("codex")).toBe("Codex (OpenAI)");
  });

  it("builds the tab/header title as '<name> · <Harness>'", () => {
    expect(botSessionTitle("Arya Stark", "claude")).toBe("Arya Stark · Claude");
  });

  it("derives up to two initials, never inventing a name", () => {
    expect(botInitials("Arya Stark")).toBe("AS");
    expect(botInitials("Watcher")).toBe("W");
    expect(botInitials("  ")).toBe("");
  });

  it("normalizes the handle with a leading @, or renders nothing", () => {
    expect(botHandleLabel("arya-stark")).toBe("@arya-stark");
    expect(botHandleLabel("@arya-stark")).toBe("@arya-stark");
    expect(botHandleLabel(null)).toBeNull();
  });

  it("formats an elapsed clock as HH:MM:SS", () => {
    expect(formatElapsedClock(0)).toBe("00:00:00");
    expect(formatElapsedClock(4 * 60_000 + 12_000)).toBe("00:04:12");
    expect(formatElapsedClock(90 * 60_000)).toBe("01:30:00");
  });

  it("pairs a relative phrase with the precise clock, live-ticking", () => {
    const started = 1_000_000;
    expect(formatBotSessionStarted(started, started + 30_000)).toBe(
      "Just now (00:00:30)",
    );
    expect(formatBotSessionStarted(started, started + 5 * 60_000)).toBe(
      "5m ago (00:05:00)",
    );
    expect(
      formatBotSessionStarted(started, started + 2 * 3_600_000 + 60_000),
    ).toBe("2h ago (02:01:00)");
  });

  it("reads the real hook-derived agent state while the session is live", () => {
    expect(botSessionState(session({ agentState: "working" }))).toBe("working");
    expect(botSessionState(session({ agentState: undefined }))).toBe("unknown");
  });

  it("reports exited once the daemon confirms it, even with a stale agentState", () => {
    // A shell-fixture (or any harness with no hook integration) never
    // emits the agent-state transition a real hook-driven CLI would on
    // exit, so agentState can lag "working" after Stop -- observed live
    // against the real app (bug-bot-a836b4ebf8be65505 acceptance probe).
    // The daemon's own confirmed verdict must always win.
    expect(
      botSessionState(session({ verdict: "exited", agentState: "working" })),
    ).toBe("exited");
  });
});
