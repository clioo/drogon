// @vitest-environment jsdom
// Gap 3 (task_926fddc5e769): the sidebar's Bot-session projection. Pure:
// it must list a Bot only when its recorded session is observed by this
// daemon, and the state must be the daemon-owned verdict (an exited verdict
// always wins over a lagging hook-derived agent state).
import { describe, expect, test } from "vitest";
import type { BotsPanelBot } from "../../../../shared/bot-contract";
import type { Session } from "../../../../shared/session-contract";
import { buildSidebarBotSessions } from "./sidebar-bot-sessions";

function bot(overrides: Partial<BotsPanelBot> = {}): BotsPanelBot {
  return {
    id: "bot-1",
    characterPreset: "arya",
    displayIdentity: { displayName: "Arya Stark", handle: "arya", title: null },
    harnessPolicy: { defaultHarness: "claude", explicitModel: null },
    instructions: "",
    memories: [],
    responsibilities: [],
    currentSession: {
      sessionId: "sess-1",
      harness: "claude",
      model: null,
      startedAt: 1,
      rotatedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-home",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildSidebarBotSessions", () => {
  test("names the row like its tab and carries the live daemon state", () => {
    const rows = buildSidebarBotSessions(
      [bot()],
      [session({ agentState: "working" })],
    );
    expect(rows).toEqual([
      {
        botId: "bot-1",
        sessionId: "sess-1",
        displayName: "Arya Stark",
        characterPreset: "arya",
        harnessId: "claude",
        state: "working",
        workspaceId: "ws-home",
        title: "Arya Stark · Claude",
      },
    ]);
  });

  test("an exited daemon verdict wins over a lagging hook agent state", () => {
    const rows = buildSidebarBotSessions(
      [bot()],
      [session({ verdict: "exited", agentState: "working" })],
    );
    expect(rows[0]!.state).toBe("exited");
  });

  test("idle and unverifiable sessions report their real state, never a guess", () => {
    expect(
      buildSidebarBotSessions([bot()], [session({ agentState: "idle" })])[0]!
        .state,
    ).toBe("idle");
    expect(
      buildSidebarBotSessions([bot()], [session({ verdict: "unverifiable" })])[0]!
        .state,
    ).toBe("unknown");
  });

  test("carries the character preset from the real Bot record", () => {
    // Defect 3: the sidebar Chats row renders the character's avatar through
    // the same component the Bots page uses, so the row must receive the
    // preset from the real record -- not a decorator or a placeholder.
    const rows = buildSidebarBotSessions(
      [bot({ characterPreset: "jon-snow" })],
      [session()],
    );
    expect(rows[0]!.characterPreset).toBe("jon-snow");
  });

  test("an unknown preset is passed through so the avatar falls back honestly", () => {
    const rows = buildSidebarBotSessions(
      [bot({ characterPreset: "none" })],
      [session()],
    );
    expect(rows[0]!.characterPreset).toBe("none");
  });

  test("skips a recorded session this daemon does not observe at all", () => {
    expect(buildSidebarBotSessions([bot()], [])).toEqual([]);
    expect(
      buildSidebarBotSessions([bot()], [session({ id: "someone-else" })]),
    ).toEqual([]);
  });

  test("skips a Bot with no recorded session", () => {
    expect(
      buildSidebarBotSessions([bot({ currentSession: null })], [session()]),
    ).toEqual([]);
  });

  test("falls back to the record's harness when the session omits one", () => {
    const rows = buildSidebarBotSessions(
      [bot()],
      [session({ harnessId: null })],
    );
    expect(rows[0]!.harnessId).toBe("claude");
    expect(rows[0]!.title).toBe("Arya Stark · Claude");
  });

  test("uses the bare display name when no harness is known at all", () => {
    const rows = buildSidebarBotSessions(
      [
        bot({
          currentSession: {
            sessionId: "sess-1",
            harness: "",
            model: null,
            startedAt: 1,
            rotatedAt: 1,
          },
        }),
      ],
      [session({ harnessId: null })],
    );
    expect(rows[0]!.harnessId).toBeNull();
    expect(rows[0]!.title).toBe("Arya Stark");
  });
});
