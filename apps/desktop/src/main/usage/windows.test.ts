// Ported parsers: Orca reference src/main/rate-limits/{claude-usage-window,
// claude-oauth-credentials, codex-pty-status-parser,
// codex-rate-limit-window-classification, codex-rate-limit-window-mapper}.
import { describe, expect, test } from "vitest";
import {
  classifyCodexRateLimitWindows,
  mapClaudeUsageWindow,
  mapCodexRateLimitWindow,
  parseClaudeOAuthCredentialsJson,
  parseClaudeUsageResetTimestamp,
  parseCodexPtyStatus,
  stripPtyControlSequences,
} from "./windows";

describe("claude usage windows", () => {
  test("maps used_percentage with seconds-epoch reset", () => {
    const window = mapClaudeUsageWindow({ used_percentage: 42.4, resets_at: 1780000000 }, 300);
    expect(window).toMatchObject({
      usedPercent: 42.4,
      windowMinutes: 300,
      resetsAt: 1780000000 * 1000,
    });
    expect(typeof window?.resetDescription).toBe("string");
  });
  test("accepts utilization + millisecond resets", () => {
    const window = mapClaudeUsageWindow({ utilization: 8, resets_at: 1780000000000 }, 10080);
    expect(window?.usedPercent).toBe(8);
    expect(window?.resetsAt).toBe(1780000000000);
  });
  test("parses ISO reset strings and clamps percents", () => {
    expect(parseClaudeUsageResetTimestamp("2030-01-02T03:04:05Z")).toBe(
      Date.parse("2030-01-02T03:04:05Z"),
    );
    expect(mapClaudeUsageWindow({ used_percentage: 140 }, 300)?.usedPercent).toBe(100);
    expect(mapClaudeUsageWindow({ used_percentage: -3 }, 300)?.usedPercent).toBe(0);
  });
  test("rejects windows without a usable percent", () => {
    expect(mapClaudeUsageWindow(undefined, 300)).toBeNull();
    expect(mapClaudeUsageWindow({}, 300)).toBeNull();
    expect(mapClaudeUsageWindow({ used_percentage: Number.NaN }, 300)).toBeNull();
    expect(parseClaudeUsageResetTimestamp(Number.NaN)).toBeNull();
    expect(parseClaudeUsageResetTimestamp("not a date")).toBeNull();
  });
});

describe("claude credential parsing (read-only)", () => {
  test("extracts the access token and refresh presence", () => {
    const raw = JSON.stringify({
      claudeAiOauth: { accessToken: "sekret", refreshToken: "refresh" },
    });
    expect(parseClaudeOAuthCredentialsJson(raw, "keychain")).toEqual({
      token: "sekret",
      hasRefreshableCredentials: true,
      source: "keychain",
    });
  });
  test("fails closed on missing token or garbage", () => {
    expect(
      parseClaudeOAuthCredentialsJson(JSON.stringify({ claudeAiOauth: {} }), "keychain").token,
    ).toBeNull();
    expect(parseClaudeOAuthCredentialsJson("{{{", "credentials-file")).toEqual({
      token: null,
      hasRefreshableCredentials: false,
      source: "none",
    });
  });
});

describe("codex pty status parsing", () => {
  test("reads used percents and strips control sequences", () => {
    const output = "\x1b[2K5h limit 55% used\nweekly limit 12% used";
    expect(stripPtyControlSequences(output)).not.toContain("\x1b");
    const parsed = parseCodexPtyStatus(output);
    expect(parsed.session?.usedPercent).toBe(55);
    expect(parsed.session?.windowMinutes).toBe(300);
    expect(parsed.weekly?.usedPercent).toBe(12);
  });
  test("converts 'left' orientation to used", () => {
    const parsed = parseCodexPtyStatus("5h limit 70% left");
    expect(parsed.session?.usedPercent).toBe(30);
  });
  test("returns null windows when no limit lines exist", () => {
    expect(parseCodexPtyStatus("hello world")).toEqual({ session: null, weekly: null });
  });
});

describe("codex rpc window classification", () => {
  test("classifies by duration with one-minute drift tolerance", () => {
    const { session, weekly } = classifyCodexRateLimitWindows({
      primary: { usedPercent: 10, windowDurationMins: 299, resetsAt: 1780000000 },
      secondary: { usedPercent: 20, windowDurationMins: 10081, resetsAt: 1780000000 },
    });
    expect(session?.usedPercent).toBe(10);
    expect(weekly?.usedPercent).toBe(20);
  });
  test("falls back to primary/session legacy order on unknown durations", () => {
    const { session, weekly } = classifyCodexRateLimitWindows({
      primary: { usedPercent: 10, windowDurationMins: 999 },
      secondary: { usedPercent: 20, windowDurationMins: 888 },
    });
    expect(session?.usedPercent).toBe(10);
    expect(weekly?.usedPercent).toBe(20);
  });
  test("maps seconds resetsAt to milliseconds and clamps", () => {
    const window = mapCodexRateLimitWindow({ usedPercent: 120, resetsAt: 1780000000 }, 300);
    expect(window?.usedPercent).toBe(100);
    expect(window?.resetsAt).toBe(1780000000 * 1000);
    expect(mapCodexRateLimitWindow(null, 300)).toBeNull();
    expect(mapCodexRateLimitWindow({ usedPercent: "x" }, 300)).toBeNull();
  });
});
