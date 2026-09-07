import { describe, expect, it } from "vitest";
import type { Verdict } from "../../shared/session-contract";
import {
  recoveryActionFor,
  recoveryTabLabel,
  retryAffordanceDisabled,
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
