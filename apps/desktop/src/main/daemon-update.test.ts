// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5 decision core: every classification branch is
// covered, including the honesty rules — an unknown identity never claims
// a match or a mismatch, and a daemon that predates identity reporting is
// classified as a changed binary (it is necessarily older than a bundle
// that reports one), never silently attached.
import { describe, expect, test } from "vitest";
import {
  classifyDaemonUpdate,
  shortRevision,
  updatedNotice,
} from "./daemon-update";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

describe("classifyDaemonUpdate", () => {
  test("equal known digests are up-to-date", () => {
    expect(
      classifyDaemonUpdate({
        bundleDigest: DIGEST_A,
        daemonDigest: DIGEST_A,
      }),
    ).toEqual({ kind: "up-to-date", daemonDigest: DIGEST_A });
  });

  test("two different known digests are a changed binary, with the honest reason", () => {
    const decision = classifyDaemonUpdate({
      bundleDigest: DIGEST_A,
      daemonDigest: DIGEST_B,
    });
    expect(decision.kind).toBe("changed-binary");
    if (decision.kind === "changed-binary") {
      expect(decision.daemonDigest).toBe(DIGEST_B);
      expect(decision.reason).toMatch(/different build/);
    }
  });

  test("a daemon predating identity reporting cannot be verified and is a changed binary, never a silent attach", () => {
    const decision = classifyDaemonUpdate({
      bundleDigest: DIGEST_A,
      daemonDigest: null,
    });
    expect(decision.kind).toBe("changed-binary");
    if (decision.kind === "changed-binary") {
      expect(decision.daemonDigest).toBeNull();
      expect(decision.reason).toMatch(/does not report its binary identity/);
    }
  });

  test("an unreadable bundle digest claims nothing (identity unknown)", () => {
    const decision = classifyDaemonUpdate({
      bundleDigest: null,
      daemonDigest: DIGEST_B,
    });
    expect(decision.kind).toBe("identity-unknown");
  });

  test("an undefined daemon digest field (old daemon) behaves like null", () => {
    expect(
      classifyDaemonUpdate({
        bundleDigest: DIGEST_A,
        daemonDigest: undefined,
      }).kind,
    ).toBe("changed-binary");
  });
});

describe("update notices", () => {
  test("the notice names the revision — never a silent restart", () => {
    expect(updatedNotice("0123456789abcdef")).toBe(
      "Drogon updated to 0123456789abcdef; restarting its background service.",
    );
    expect(updatedNotice(null)).toBe(
      "Drogon updated; restarting its background service.",
    );
  });

  test("shortRevision trims to the 12-char display form", () => {
    expect(shortRevision("0123456789abcdef")).toBe("0123456789ab");
    expect(shortRevision(null)).toBeNull();
  });
});
