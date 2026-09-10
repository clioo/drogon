// @vitest-environment jsdom
// Defect 1: the host's Open-session decision must be workspace-independent
// and must never turn "liveness not established" into "open a new session".
// This is the pure seam the App and the Bots page controller both call.
import { describe, expect, test } from "vitest";
import type { BotsPanelBot, BotsPanelSession } from "../../../../shared/bot-contract";
import type { Session } from "../../../../shared/session-contract";
import { resolveBotSession } from "./bot-session-resolution";

function record(overrides: Partial<BotsPanelSession> = {}): BotsPanelSession {
  return {
    sessionId: "sess-1",
    harness: "claude",
    model: null,
    startedAt: 1,
    rotatedAt: 1,
    ...overrides,
  };
}

function bot(currentSession: BotsPanelSession | null): BotsPanelBot {
  return {
    id: "bot-1",
    characterPreset: "jon-snow",
    displayIdentity: { displayName: "Jon Snow", handle: null, title: null },
    harnessPolicy: { defaultHarness: "claude", explicitModel: null },
    instructions: "",
    memories: [],
    responsibilities: [],
    currentSession,
    createdAt: 1,
    updatedAt: 1,
  };
}

function observedSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-home",
    hostId: "host-1",
    incarnation: "inc-observed",
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

describe("resolveBotSession", () => {
  test("opens fresh only when there is no recorded session", () => {
    expect(
      resolveBotSession({ bot: bot(null), observed: null, hostId: "host-1" }),
    ).toEqual({ kind: "open" });
  });

  test("focuses the recorded session from the daemon projection even when the current view lists no sessions", () => {
    // The exact reported bug: the Bot lives in its own home workspace, so the
    // selected workspace's session list is empty on the first click. The
    // daemon's projection on the record is enough to focus it.
    const resolution = resolveBotSession({
      bot: bot(record({ verdict: "live", workspaceId: "ws-home", incarnation: "inc-1" })),
      observed: null,
      hostId: "host-1",
    });
    expect(resolution).toEqual({
      kind: "focus",
      session: {
        sessionId: "sess-1",
        incarnation: "inc-1",
        workspaceId: "ws-home",
        hostId: "host-1",
        harnessId: "claude",
      },
    });
  });

  test("prefers the fresher observed list entry over the snapshot projection", () => {
    const resolution = resolveBotSession({
      bot: bot(record({ verdict: "live", workspaceId: "ws-home", incarnation: "inc-1" })),
      observed: observedSession({ verdict: "live", incarnation: "inc-fresh" }),
      hostId: "host-1",
    });
    expect(resolution.kind).toBe("focus");
    if (resolution.kind === "focus") {
      expect(resolution.session.incarnation).toBe("inc-fresh");
    }
  });

  test("a closed session reopens with a resume, from the projection or the list", () => {
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "exited", workspaceId: "ws-home", incarnation: "inc-1" })),
        observed: null,
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "claude" });

    expect(
      resolveBotSession({
        bot: bot(record()),
        observed: observedSession({ verdict: "exited", harnessId: "pi" }),
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "pi" });
  });

  test("an unverifiable recorded session is not focusable: the daemon holds no child for it", () => {
    // Regression (P0/P1): a session recovered after a daemon restart or an
    // app upgrade lists as `unverifiable`. That verdict positively means
    // THIS daemon instance has no running child for the id -- a held child
    // is always `live` -- so focusing it produced the owner's blank
    // terminal (no output, and Stop had nothing to kill). The honest
    // response is to reopen it with the harness's resume mechanism.
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "unverifiable", workspaceId: "ws-home", incarnation: "inc-1" })),
        observed: null,
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "claude" });

    // Same when the host-wide session list still carries the recovered stub.
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "unverifiable", workspaceId: "ws-home", incarnation: "inc-1" })),
        observed: observedSession({ verdict: "unverifiable", harnessId: "pi" }),
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "pi" });
  });

  test("a recorded session with no projected verdict is UNKNOWN, never a fresh dispatch", () => {
    // An older daemon build (or a snapshot that has not loaded) cannot prove
    // liveness. The whole fix: this must not fall through to "open a new one".
    expect(
      resolveBotSession({ bot: bot(record()), observed: null, hostId: "host-1" }),
    ).toEqual({ kind: "unknown" });
  });

  test("a live verdict missing the facts needed to focus is UNKNOWN", () => {
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "live", workspaceId: "ws-home" })),
        observed: null,
        hostId: "host-1",
      }),
    ).toEqual({ kind: "unknown" });
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "live", incarnation: "inc-1" })),
        observed: null,
        hostId: "host-1",
      }),
    ).toEqual({ kind: "unknown" });
  });

  test("falls back to the record's harness when the observed session omits one", () => {
    const resolution = resolveBotSession({
      bot: bot(record({ harness: "opencode" })),
      observed: observedSession({ harnessId: null }),
      hostId: "host-1",
    });
    expect(resolution.kind).toBe("focus");
    if (resolution.kind === "focus") {
      expect(resolution.session.harnessId).toBe("opencode");
    }
  });
});
