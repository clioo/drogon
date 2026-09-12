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
    ).toEqual({
      kind: "reopen",
      sessionId: "sess-1",
      harnessId: "claude",
      resumeByIdentity: null,
    });

    expect(
      resolveBotSession({
        bot: bot(record()),
        observed: observedSession({ verdict: "exited", harnessId: "pi" }),
        hostId: "host-1",
      }),
    ).toEqual({
      kind: "reopen",
      sessionId: "sess-1",
      harnessId: "pi",
      resumeByIdentity: null,
    });
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
    ).toEqual({
      kind: "reopen",
      sessionId: "sess-1",
      harnessId: "claude",
      resumeByIdentity: null,
    });

    // Same when the host-wide session list still carries the recovered stub:
    // the recorded row is named, so the daemon can read its provider id.
    expect(
      resolveBotSession({
        bot: bot(record({ verdict: "unverifiable", workspaceId: "ws-home", incarnation: "inc-1" })),
        observed: observedSession({ verdict: "unverifiable", harnessId: "pi" }),
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "pi", resumeByIdentity: null });
    expect(
      resolveBotSession({
        bot: bot(record()),
        observed: observedSession({
          verdict: "exited",
          harnessId: "pi",
          agentSessionId: "conv-1",
        }),
        hostId: "host-1",
      }),
    ).toEqual({ kind: "reopen", sessionId: "sess-1", harnessId: "pi", resumeByIdentity: "session" });
  });

  test("an unobserved record that carries the harness conversation reopens it by identity", () => {
    // The dead end this closes: the Drogon session row is gone (an explicit
    // close deletes it) so no verdict can ever be projected, and the old
    // answer was a permanent refusal the owner could never get past. The
    // record's latched provider id turns it into a real recovery -- and the
    // duplicate-prevention instinct survives, because the worst case is the
    // SAME conversation coming back, not a second live one.
    expect(
      resolveBotSession({
        bot: bot(record({ agentSessionId: "conv-1" })),
        observed: null,
        hostId: "host-1",
      }),
    ).toEqual({
      kind: "reopen",
      sessionId: "sess-1",
      harnessId: "claude",
      resumeByIdentity: "bot-record",
    });
    // A record with no identity and NO missing-row marker keeps the honest
    // refusal: without the daemon's positive fact this could still be an
    // older daemon build holding a live session the renderer cannot see.
    expect(resolveBotSession({ bot: bot(record()), observed: null, hostId: "host-1" })).toEqual({
      kind: "unknown",
    });
  });

  test("a recorded session with no projected verdict is UNKNOWN, never a fresh dispatch", () => {
    // Without the daemon's positive missing-row fact this is genuinely
    // ambiguous (an older daemon build cannot prove liveness either). The
    // whole fix: this must not fall through to "open a new one".
    expect(
      resolveBotSession({ bot: bot(record()), observed: null, hostId: "host-1" }),
    ).toEqual({ kind: "unknown" });
  });

  test("a recorded link the daemon positively resolved to NOTHING opens fresh with an honest notice", () => {
    // Finding 6 (the owner's dead end): after the daemon restart, the Bot
    // record still names a session whose ROW is gone, so the projection
    // yields no verdict at all -- and the old answer was a refusal whose
    // "refresh and retry in a moment" advice could never succeed (the
    // lookup already ran; a refresh re-reads the same absence forever).
    // `recordedSessionMissing` is the daemon's positive fact: no live
    // child, no durable row. There is no live Drogon session a second open
    // could duplicate, so the fresh session is safe and the notice says
    // what happened.
    const resolution = resolveBotSession({
      bot: bot(record({ recordedSessionMissing: true })),
      observed: null,
      hostId: "host-1",
    });
    expect(resolution.kind).toBe("open");
    if (resolution.kind === "open" && resolution.notice) {
      expect(resolution.notice).toContain("previous session is gone");
      expect(resolution.notice).toContain("Starting a new conversation");
      // The advice-never-works rule: no "retry"/"refresh" in the notice.
      expect(resolution.notice.toLowerCase()).not.toContain("refresh");
      expect(resolution.notice.toLowerCase()).not.toContain("retry");
    }
    // Even a daemon-positive phantom must not invent a resume: the notice
    // travels on the OPEN variant, never a reopen claim.
    expect(resolution).not.toEqual(expect.objectContaining({ kind: "reopen" }));
  });

  test("a stale renderer-side copy of the phantom cannot shadow the daemon's positive missing fact", () => {
    // The acceptance run caught this: the tab-strip/host-wide poll still
    // listed the recorded session (verdict unverifiable/exited -- the old
    // daemon's last observation, or the exit a close left behind), and the
    // observed-first rule turned the phantom into a `reopen` whose notice
    // ("will reopen its most recent conversation") described an intention
    // the daemon had already positively refuted. The daemon OWNS liveness:
    // when it positively says the recorded row is gone, no local copy may
    // shadow that fact into a resume claim.
    const stale = {
      id: "sess-gone",
      workspaceId: "ws-home",
      hostId: "host-1",
      incarnation: "inc-1",
      harnessId: "claude",
    } as unknown as Session;
    for (const verdict of ["unverifiable", "exited", "live"] as const) {
      const resolution = resolveBotSession({
        bot: bot(record({ recordedSessionMissing: true })),
        observed: { ...stale, verdict },
        hostId: "host-1",
      });
      expect(resolution.kind).toBe("open");
      if (resolution.kind === "open") {
        expect(resolution.notice).toContain("previous session is gone");
      }
    }
  });

  test("a latched harness conversation beats the missing-fact: the bot-record-alone resume survives", () => {
    // The owner's 10/10 baseline caught this ordering mistake: with the
    // durable row gone (closed, or a daemon restart) and ONLY the Bot
    // record left, the record still carries the harness-reported provider
    // conversation -- the bot-record-alone recovery. The daemon-positive
    // missing fact must NOT downgrade that into a fresh start: a reopen
    // naming THAT conversation can never duplicate a live session (worst
    // case: the same conversation comes back). Precedence: latched
    // conversation id > daemon-positive missing > stale local copies.
    const resolution = resolveBotSession({
      bot: bot(
        record({
          recordedSessionMissing: true,
          agentSessionId: "conv-1",
        }),
      ),
      // Even a stale local copy of the dead row must not change the
      // answer: the named conversation is the one thing that is safe.
      observed: {
        id: "sess-gone",
        verdict: "unverifiable",
        workspaceId: "ws-home",
        hostId: "host-1",
        incarnation: "inc-1",
        harnessId: "claude",
      } as unknown as Session,
      hostId: "host-1",
    });
    expect(resolution).toEqual({
      kind: "reopen",
      sessionId: "sess-1",
      harnessId: "claude",
      resumeByIdentity: "bot-record",
    });
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
