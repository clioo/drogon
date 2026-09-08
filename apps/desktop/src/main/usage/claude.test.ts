import { describe, expect, test } from "vitest";
import { CLAUDE_OAUTH_REQUEST_HEADERS, readClaudeUsage } from "./claude";

describe("claude usage reader (fail closed)", () => {
  test("OAuth request headers stay literal with the fork (UA-gated endpoint)", () => {
    // The fork's claude-oauth-usage-request.ts sends `claude-code/2.1.0`;
    // anything else gets HTTP 429 from the usage endpoint.
    expect(CLAUDE_OAUTH_REQUEST_HEADERS["User-Agent"]).toBe("claude-code/2.1.0");
    expect(CLAUDE_OAUTH_REQUEST_HEADERS["anthropic-beta"]).toBe("oauth-2025-04-20");
  });
  test("no token anywhere resolves unavailable, never throws", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve(null),
      readCredentialsFileToken: () => Promise.resolve(null),
    });
    expect(result).toMatchObject({ provider: "claude", status: "unavailable" });
    expect(result.session).toBeNull();
    expect(result.error).toMatch(/not signed in/i);
  });
  test("a fetch failure resolves error, keeping the shape", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("tok"),
      fetchJson: () => Promise.reject(new Error("net down")),
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/unreachable/);
  });
  test("maps session, weekly and the Fable tier share", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("tok"),
      fetchJson: () =>
        Promise.resolve({
          five_hour: { used_percentage: 55, resets_at: 1780000000 },
          seven_day: { utilization: 30, resets_at: 1780000000 },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 8,
              resets_at: 1780000000,
              scope: { model: { display_name: "Fable" } },
            },
          ],
        }),
    });
    expect(result.status).toBe("ok");
    expect(result.session?.usedPercent).toBe(55);
    expect(result.weekly?.usedPercent).toBe(30);
    expect(result.fableWeekly?.usedPercent).toBe(8);
  });
  test("an empty payload is an error, not fake zeros", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("tok"),
      fetchJson: () => Promise.resolve({}),
    });
    expect(result.status).toBe("error");
    expect(result.session).toBeNull();
  });
});
