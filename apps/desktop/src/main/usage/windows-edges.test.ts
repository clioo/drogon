import { describe, expect, test } from "vitest";
import {
  classifyCodexRateLimitWindows,
  mapClaudeUsageWindow,
  mapCodexRateLimitWindow,
  parseClaudeOAuthCredentialsJson,
  parseClaudeUsageResetTimestamp,
  parseCodexPtyStatus,
} from "./windows";

describe("claude reset timestamps (unit boundaries)", () => {
  test("numeric strings split seconds from milliseconds", () => {
    expect(parseClaudeUsageResetTimestamp("1780000000")).toBe(1780000000 * 1000);
    expect(parseClaudeUsageResetTimestamp("1780000000000")).toBe(1780000000000);
  });
  test("exactly 1e10 still counts as seconds (strict split)", () => {
    expect(parseClaudeUsageResetTimestamp(10_000_000_000)).toBe(10_000_000_000 * 1000);
    expect(parseClaudeUsageResetTimestamp(10_000_000_001)).toBe(10_000_000_001);
  });
  test("blank and whitespace-only inputs are null, never epoch zero", () => {
    expect(parseClaudeUsageResetTimestamp("")).toBeNull();
    expect(parseClaudeUsageResetTimestamp("   ")).toBeNull();
    expect(parseClaudeUsageResetTimestamp(undefined)).toBeNull();
    // A JSON null reset (provider quirk) stays null, never throws: the
    // reader maps windows without a guard of its own.
    const nullReset = mapClaudeUsageWindow(
      { used_percentage: 10, resets_at: null as never },
      300,
    );
    expect(nullReset?.resetsAt).toBeNull();
    expect(nullReset?.usedPercent).toBe(10);
  });
  test("a same-day reset reads as a time, a far reset as a date", () => {
    const soon = mapClaudeUsageWindow({ used_percentage: 10, resets_at: Date.now() + 60_000 }, 300);
    expect(typeof soon?.resetDescription).toBe("string");
    const far = mapClaudeUsageWindow(
      { used_percentage: 10, resets_at: "2030-01-02T03:04:05Z" },
      300,
    );
    expect(far?.resetsAt).toBe(Date.parse("2030-01-02T03:04:05Z"));
    expect(typeof far?.resetDescription).toBe("string");
  });
});

describe("claude credential parsing (boundary shapes)", () => {
  test("an expired access token still parses: expiry is not authoritative", () => {
    const raw = JSON.stringify({
      claudeAiOauth: { accessToken: "still-good", expiresAt: 1 },
    });
    expect(parseClaudeOAuthCredentialsJson(raw, "credentials-file")).toEqual({
      token: "still-good",
      hasRefreshableCredentials: false,
      source: "credentials-file",
    });
  });
  test("whitespace-only refresh tokens do not count as refreshable", () => {
    const raw = JSON.stringify({
      claudeAiOauth: { accessToken: "t", refreshToken: "  " },
    });
    const parsed = parseClaudeOAuthCredentialsJson(raw, "keychain");
    expect(parsed.token).toBe("t");
    expect(parsed.hasRefreshableCredentials).toBe(false);
  });
  test("non-string tokens and missing oauth blocks fail closed", () => {
    expect(
      parseClaudeOAuthCredentialsJson(
        JSON.stringify({ claudeAiOauth: { accessToken: 42 } }),
        "keychain",
      ),
    ).toEqual({ token: null, hasRefreshableCredentials: false, source: "keychain" });
    expect(parseClaudeOAuthCredentialsJson("{}", "credentials-file").token).toBeNull();
    // "null" parses but holds no oauth block: fail-closed token, kept source.
    expect(parseClaudeOAuthCredentialsJson("null", "credentials-file")).toEqual({
      token: null,
      hasRefreshableCredentials: false,
      source: "credentials-file",
    });
  });
});

describe("codex pty parsing (orientation and scope)", () => {
  test("model-scoped rows never count as the session window", () => {
    expect(parseCodexPtyStatus("sonnet 5h limit 80% used").session).toBeNull();
    expect(parseCodexPtyStatus("fable weekly limit 80% used").weekly).toBeNull();
  });
  test("bare percents default to used, weekly left converts too", () => {
    expect(parseCodexPtyStatus("5h limit 80%").session?.usedPercent).toBe(80);
    expect(parseCodexPtyStatus("weekly limit 70% left").weekly?.usedPercent).toBe(30);
  });
  test("percents over 100 clamp, an unparsable reset keeps its description", () => {
    const parsed = parseCodexPtyStatus("5h limit 150% used (resets soonish maybe)");
    expect(parsed.session?.usedPercent).toBe(100);
    expect(parsed.session?.resetsAt).toBeNull();
    expect(parsed.session?.resetDescription).toBe("soonish maybe");
  });
  test("each limit line keeps its own reset hint", () => {
    const parsed = parseCodexPtyStatus(
      "5h limit 10% used (resets 2030-01-02T03:04:05Z)\nweekly limit 20% used",
    );
    expect(parsed.session?.resetsAt).toBe(Date.parse("2030-01-02T03:04:05Z"));
    expect(parsed.weekly?.resetDescription).toBeNull();
  });
});

describe("codex rpc window mapping (provider quirks)", () => {
  test("zero, negative and non-numeric resets mean no reset, not epoch", () => {
    expect(mapCodexRateLimitWindow({ usedPercent: 10, resetsAt: 0 }, 300)?.resetsAt).toBeNull();
    expect(mapCodexRateLimitWindow({ usedPercent: 10, resetsAt: -5 }, 300)?.resetsAt).toBeNull();
    expect(
      mapCodexRateLimitWindow({ usedPercent: 10, resetsAt: "tomorrow" }, 300)?.resetsAt,
    ).toBeNull();
  });
  test("negative percents clamp to zero, NaN is unusable", () => {
    expect(mapCodexRateLimitWindow({ usedPercent: -4 }, 300)?.usedPercent).toBe(0);
    expect(mapCodexRateLimitWindow({ usedPercent: Number.NaN }, 300)).toBeNull();
  });
  test("unmappable windows are dropped, never force-fit", () => {
    expect(
      classifyCodexRateLimitWindows({
        primary: { usedPercent: Number.NaN, windowDurationMins: 300 },
        secondary: null,
      }),
    ).toEqual({ session: null, weekly: null });
    expect(classifyCodexRateLimitWindows(null)).toEqual({ session: null, weekly: null });
  });
  test("two session-duration windows do not invent a weekly one", () => {
    const { session, weekly } = classifyCodexRateLimitWindows({
      primary: { usedPercent: 10, windowDurationMins: 300 },
      secondary: { usedPercent: 20, windowDurationMins: 301 },
    });
    expect(session?.usedPercent).toBe(10);
    expect(weekly).toBeNull();
  });
  test("durations outside the one-minute drift stay unknown", () => {
    const { session, weekly } = classifyCodexRateLimitWindows({
      primary: { usedPercent: 10, windowDurationMins: 302 },
      secondary: { usedPercent: 20, windowDurationMins: 10078 },
    });
    // Legacy order still applies for unknown durations.
    expect(session?.usedPercent).toBe(10);
    expect(weekly?.usedPercent).toBe(20);
  });
});
