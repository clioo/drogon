import { describe, expect, test } from "vitest";
import { readClaudeUsage } from "./claude";

describe("claude usage reader (token precedence and provider quirks)", () => {
  test("a keychain hit never consults the credentials file", async () => {
    let fileReads = 0;
    const seen: string[] = [];
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("keychain-token"),
      readCredentialsFileToken: () => {
        fileReads += 1;
        return Promise.resolve("file-token");
      },
      fetchJson: (token) => {
        seen.push(token);
        return Promise.resolve({ five_hour: { used_percentage: 1 } });
      },
    });
    expect(fileReads).toBe(0);
    expect(seen).toEqual(["keychain-token"]);
    expect(result.status).toBe("ok");
  });
  test("a keychain miss falls back to the credentials file", async () => {
    const seen: string[] = [];
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve(null),
      readCredentialsFileToken: () => Promise.resolve("file-token"),
      fetchJson: (token) => {
        seen.push(token);
        return Promise.resolve({ five_hour: { used_percentage: 2 } });
      },
    });
    expect(seen).toEqual(["file-token"]);
    expect(result.session?.usedPercent).toBe(2);
  });
  test("a non-Error fetch rejection still reports honestly", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("tok"),
      fetchJson: () => Promise.reject("plain string failure"),
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/plain string failure/);
  });
  test("windows without usable percents are an error, not zeros", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: () => Promise.resolve("tok"),
      fetchJson: () =>
        Promise.resolve({ five_hour: {}, seven_day: { used_percentage: Number.NaN } }),
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/no usable usage windows/);
  });
});

describe("claude fable-weekly tier resolution", () => {
  const keychain = () => Promise.resolve("tok");
  test("legacy fable_weekly key answers when no scoped limits exist", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: keychain,
      fetchJson: () =>
        Promise.resolve({
          five_hour: { used_percentage: 5 },
          fable_weekly: { used_percentage: 11, resets_at: 1780000000 },
        }),
    });
    expect(result.fableWeekly?.usedPercent).toBe(11);
    expect(result.fableWeekly?.windowMinutes).toBe(10080);
  });
  test("fable_seven_day and seven_day_fable aliases answer in order", async () => {
    for (const [alias, percent] of [
      ["fable_seven_day", 21],
      ["seven_day_fable", 22],
    ] as const) {
      const result = await readClaudeUsage({
        readKeychainToken: keychain,
        fetchJson: () => Promise.resolve({ [alias]: { used_percentage: percent } }),
      });
      expect(result.fableWeekly?.usedPercent).toBe(percent);
    }
  });
  test("scoped display names match case-insensitively with whitespace", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: keychain,
      fetchJson: () =>
        Promise.resolve({
          limits: [
            {
              kind: "weekly_scoped",
              percent: 9,
              scope: { model: { display_name: "  FABLE " } },
            },
          ],
        }),
    });
    expect(result.status).toBe("ok");
    expect(result.fableWeekly?.usedPercent).toBe(9);
  });
  test("a scoped non-fable model never becomes the fable share", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: keychain,
      fetchJson: () =>
        Promise.resolve({
          limits: [
            {
              kind: "weekly_scoped",
              percent: 77,
              scope: { model: { display_name: "Sonnet" } },
            },
          ],
        }),
    });
    expect(result.status).toBe("error");
    expect(result.fableWeekly).toBeNull();
  });
  test("a scoped row without a finite percent falls through to legacy keys", async () => {
    const result = await readClaudeUsage({
      readKeychainToken: keychain,
      fetchJson: () =>
        Promise.resolve({
          limits: [{ kind: "weekly_scoped", scope: { model: { display_name: "Fable" } } }],
          fable_weekly: { used_percentage: 13 },
        }),
    });
    expect(result.status).toBe("ok");
    expect(result.fableWeekly?.usedPercent).toBe(13);
  });
});
