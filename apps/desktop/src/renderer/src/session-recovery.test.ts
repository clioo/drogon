import { describe, expect, it } from "vitest";
import type { Session, Verdict } from "../../shared/session-contract";
import {
  assertCloseReplyFor,
  isRecoverableAfterReconnect,
  recoveryActionFor,
  recoveryTabLabel,
  retryAffordanceDisabled,
  retryOfferKey,
  retryStillUnverifiable,
  showRecoveryOverlay,
} from "./session-recovery";

describe("recoveryActionFor", () => {
  it("maps live to no recovery action", () => {
    expect(recoveryActionFor("live", { exitExpected: false })).toEqual({
      kind: "none",
    });
    expect(recoveryActionFor("live", { exitExpected: true })).toEqual({
      kind: "none",
    });
  });
  it("maps unverifiable to retry-connection", () => {
    expect(recoveryActionFor("unverifiable", { exitExpected: false })).toEqual(
      { kind: "retry-connection" },
    );
    expect(recoveryActionFor("unverifiable", { exitExpected: true })).toEqual({
      kind: "retry-connection",
    });
  });
  it("maps an unexpectedly-exited session to reveal-output+offer-new", () => {
    expect(recoveryActionFor("exited", { exitExpected: false })).toEqual({
      kind: "reveal-output+offer-new",
    });
  });
  it("maps a user-requested exit to no recovery action", () => {
    expect(recoveryActionFor("exited", { exitExpected: true })).toEqual({
      kind: "none",
    });
  });
  it("never invents an auto-respawn action for any verdict", () => {
    const verdicts: Verdict[] = ["live", "unverifiable", "exited"];
    for (const verdict of verdicts)
      expect(recoveryActionFor(verdict, { exitExpected: false }).kind).not.toBe(
        "respawn",
      );
  });
});

describe("recoveryTabLabel", () => {
  const base = { label: "Pi", verdict: "unverifiable" as Verdict };
  it("keeps the base label plus the exact session identity when unverifiable", () => {
    const label = recoveryTabLabel({
      ...base,
      id: "sess-123",
      incarnation: "inc-9",
    });
    expect(label).toContain("Pi");
    expect(label).toContain("sess-123");
    expect(label).toContain("inc-9");
  });
  it("stays stable for the same session, so a refresh never swaps identity", () => {
    const first = recoveryTabLabel({
      ...base,
      id: "sess-123",
      incarnation: "inc-9",
    });
    const second = recoveryTabLabel({
      ...base,
      id: "sess-123",
      incarnation: "inc-9",
    });
    expect(first).toBe(second);
    expect(
      recoveryTabLabel({ ...base, id: "other", incarnation: "inc-9" }),
    ).not.toBe(first);
  });
  it("leaves live and exited labels unchanged", () => {
    expect(
      recoveryTabLabel({ ...base, verdict: "live", id: "s", incarnation: "i" }),
    ).toBe("Pi");
    expect(
      recoveryTabLabel({
        ...base,
        verdict: "exited",
        id: "s",
        incarnation: "i",
      }),
    ).toBe("Pi");
  });
});

describe("retryAffordanceDisabled", () => {
  it("is disabled while a refresh is already in flight", () => {
    expect(retryAffordanceDisabled({ refreshInFlight: true })).toBe(true);
  });
  it("is enabled when no refresh is in flight", () => {
    expect(retryAffordanceDisabled({ refreshInFlight: false })).toBe(false);
  });
});

describe("isRecoverableAfterReconnect", () => {
  it("re-attaches live and unverifiable sessions when the daemon returns", () => {
    expect(isRecoverableAfterReconnect("live")).toBe(true);
    expect(isRecoverableAfterReconnect("unverifiable")).toBe(true);
  });
  it("never re-attaches a positively-exited session", () => {
    // Loss of contact is unverifiable, never exited; a confirmed exit stays
    // final, so the daemon banner must not cover its exit overlay.
    expect(isRecoverableAfterReconnect("exited")).toBe(false);
  });
});

describe("retryOfferKey", () => {
  it("keys on id and incarnation so a superseded incarnation never matches", () => {
    const key = retryOfferKey({ id: "s1", incarnation: "inc-1" });
    expect(key).toBe("s1:inc-1");
    expect(retryOfferKey({ id: "s1", incarnation: "inc-2" })).not.toBe(key);
    expect(retryOfferKey({ id: "s2", incarnation: "inc-1" })).not.toBe(key);
  });
});

describe("retryStillUnverifiable", () => {
  const stub = { id: "s1", incarnation: "inc-1", verdict: "unverifiable" as Verdict };
  it("keeps only pending sessions the fresh list still reports unverifiable", () => {
    const pending = new Set([retryOfferKey(stub)]);
    expect(retryStillUnverifiable(pending, [stub])).toEqual(["s1:inc-1"]);
  });
  it("never offers a session that came back live", () => {
    const pending = new Set([retryOfferKey(stub)]);
    expect(
      retryStillUnverifiable(pending, [{ ...stub, verdict: "live" }]),
    ).toEqual([]);
  });
  it("never offers sessions the pending click did not target", () => {
    const pending = new Set([retryOfferKey(stub)]);
    const other = { id: "s9", incarnation: "inc-9", verdict: "unverifiable" as Verdict };
    expect(retryStillUnverifiable(pending, [other])).toEqual([]);
  });
  it("never offers an exited session, even when pending", () => {
    const pending = new Set([retryOfferKey(stub)]);
    expect(
      retryStillUnverifiable(pending, [{ ...stub, verdict: "exited" }]),
    ).toEqual([]);
  });
});

describe("showRecoveryOverlay", () => {
  it("shows only for an unverifiable session after a confirmed-failed retry, while connected", () => {
    expect(
      showRecoveryOverlay({
        verdict: "unverifiable",
        recoveryNonce: 1,
        dismissedNonce: 0,
        connected: true,
      }),
    ).toBe(true);
  });
  it("hides after the user dismissed this offer", () => {
    expect(
      showRecoveryOverlay({
        verdict: "unverifiable",
        recoveryNonce: 1,
        dismissedNonce: 1,
        connected: true,
      }),
    ).toBe(false);
  });
  it("re-arms only on a NEW retry click (a higher nonce)", () => {
    expect(
      showRecoveryOverlay({
        verdict: "unverifiable",
        recoveryNonce: 2,
        dismissedNonce: 1,
        connected: true,
      }),
    ).toBe(true);
  });
  it("never shows for live or exited sessions", () => {
    for (const verdict of ["live", "exited"] as const)
      expect(
        showRecoveryOverlay({
          verdict,
          recoveryNonce: 3,
          dismissedNonce: 0,
          connected: true,
        }),
      ).toBe(false);
  });
  it("never shows while the daemon connection is down — the reconnect banner owns that state", () => {
    expect(
      showRecoveryOverlay({
        verdict: "unverifiable",
        recoveryNonce: 1,
        dismissedNonce: 0,
        connected: false,
      }),
    ).toBe(false);
  });
});

describe("assertCloseReplyFor (tab close path, issue #228)", () => {
  const target: Session = {
    id: "s1",
    workspaceId: "w1",
    hostId: "h1",
    incarnation: "inc-1",
    command: "/bin/sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "unverifiable",
    exitCode: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const replyFor = (overrides: Partial<Session>): Session => ({
    ...target,
    ...overrides,
  });

  it("accepts the close of an exited session with its observed code", () => {
    expect(
      assertCloseReplyFor(
        replyFor({ verdict: "exited", exitCode: 0 }),
        target,
      ).verdict,
    ).toBe("exited");
  });

  it("accepts the close of a forgotten post-restart stub, keeping its honest unverifiable verdict", () => {
    // The regression this task fixes: the old path threw \"Session exit is
    // not confirmed\" here, which is exactly why stub tabs could never be
    // closed. An explicit close is the user's decision, not the liveness
    // oracle's — the reply is accepted for any honest verdict.
    const accepted = assertCloseReplyFor(
      replyFor({ verdict: "unverifiable" }),
      target,
    );
    expect(accepted.verdict).toBe("unverifiable");
  });

  it("rejects a reply for a different session id", () => {
    expect(() =>
      assertCloseReplyFor(replyFor({ id: "s2" }), target),
    ).toThrow(/not for this session/);
  });

  it("rejects a reply for a stale incarnation", () => {
    expect(() =>
      assertCloseReplyFor(replyFor({ incarnation: "inc-old" }), target),
    ).toThrow(/not for this session/);
  });

  it("rejects a reply from a different host", () => {
    expect(() =>
      assertCloseReplyFor(replyFor({ hostId: "h2" }), target),
    ).toThrow(/not for this session/);
  });
});
