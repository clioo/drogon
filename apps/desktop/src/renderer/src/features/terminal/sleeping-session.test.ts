// SLEEPING / RESUME (owner directive): a session the daemon holds no child
// for is asleep when its harness can reopen its own conversation, and the
// strength of that reopen is decided by what the harness reported. These are
// the pure seams the pane renders and the restart launch reads.
import { describe, expect, test } from "vitest";
import {
  harnessCanResume,
  namesOneConversation,
  restoredBannerReason,
  sleepingSessionFor,
} from "./sleeping-session";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    workspaceId: "ws-1",
    verdict: "unverifiable" as const,
    harnessId: "claude" as const,
    agentSessionId: null as string | null,
    agentSessionTranscriptPath: null as string | null,
    ...overrides,
  };
}

describe("sleepingSessionFor", () => {
  test("an unverifiable harness session is sleeping", () => {
    expect(sleepingSessionFor(session())).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      harnessId: "claude",
      agentSessionId: null,
      agentSessionTranscriptPath: null,
      resumeKind: "continue",
    });
  });

  test("a reported provider id makes the resume name that exact conversation", () => {
    expect(
      sleepingSessionFor(session({ agentSessionId: "conv-1" }))?.resumeKind,
    ).toBe("named");
  });

  test("a live or exited session is not sleeping", () => {
    // `live`: the daemon holds a running child -- nothing to resume.
    expect(sleepingSessionFor(session({ verdict: "live" }))).toBeNull();
    // `exited`: a positively observed process exit. Loss of contact is never
    // exit, and an exit is not sleep either.
    expect(sleepingSessionFor(session({ verdict: "exited" }))).toBeNull();
  });

  test("a plain shell has no conversation to resume", () => {
    expect(sleepingSessionFor(session({ harnessId: null }))).toBeNull();
  });

  test("Pi resumes by file, so an id alone cannot name its conversation", () => {
    // The reference's `getAgentResumeArgv` returns null for exactly this
    // shape: `pi --session` takes the session FILE, not the id.
    expect(
      sleepingSessionFor(
        session({ harnessId: "pi", agentSessionId: "conv-1" }),
      )?.resumeKind,
    ).toBe("continue");
    expect(
      sleepingSessionFor(
        session({
          harnessId: "pi",
          agentSessionId: "conv-1",
          agentSessionTranscriptPath: "/tmp/conv-1.jsonl",
        }),
      )?.resumeKind,
    ).toBe("named");
  });

  test("blank identity text is treated as absent, never as a locator", () => {
    expect(sleepingSessionFor(session({ agentSessionId: "   " }))).toEqual(
      expect.objectContaining({ agentSessionId: null, resumeKind: "continue" }),
    );
  });
});

describe("harnessCanResume / namesOneConversation", () => {
  test("every harness this app launches has a resume verb", () => {
    for (const harness of ["claude", "codex", "opencode", "pi", "antigravity"]) {
      expect(harnessCanResume(harness)).toBe(true);
    }
    expect(harnessCanResume(null)).toBe(false);
    expect(harnessCanResume(undefined)).toBe(false);
    // A harness outside the ported resumable set is never claimed.
    expect(harnessCanResume("aider")).toBe(false);
  });

  test("an id names one conversation for every harness except file-resuming Pi", () => {
    for (const harnessId of ["claude", "codex", "opencode", "antigravity"]) {
      expect(namesOneConversation({ harnessId, agentSessionId: "conv-1" })).toBe(
        true,
      );
    }
    expect(
      namesOneConversation({ harnessId: "pi", agentSessionId: "conv-1" }),
    ).toBe(false);
    expect(
      namesOneConversation({
        harnessId: "pi",
        agentSessionId: "conv-1",
        agentSessionTranscriptPath: "/tmp/conv-1.jsonl",
      }),
    ).toBe(true);
  });
});

describe("restoredBannerReason", () => {
  test("a declined resume says it started fresh, never a silent restore", () => {
    expect(restoredBannerReason("fresh")).toBe("resume-unavailable");
  });

  test("only a daemon-verified resume raises the restored banner", () => {
    // `resumed` is the daemon's verified claim: its persisted transcript
    // exists on disk, so the restoration is real before the banner shows.
    expect(restoredBannerReason("resumed")).toBe("restored");
    // `continued` (the CLI's own most-recent entrypoint after a degraded
    // resume) and `resume-unverified` (an id-only locator the daemon could
    // not check) must NOT claim a restoration the daemon cannot confirm --
    // the harness's own output is the only honest confirmation left.
    expect(restoredBannerReason("continued")).toBeNull();
    expect(restoredBannerReason("resume-unverified")).toBeNull();
  });

  test("a launch that was not a resume raises nothing", () => {
    // `session.list` rows carry no outcome, and a plain launch gets no
    // banner: silence is correct when nothing was claimed.
    expect(restoredBannerReason(undefined)).toBeNull();
  });
});
