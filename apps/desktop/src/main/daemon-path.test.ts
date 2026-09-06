import { describe, expect, test } from "vitest";
import { buildDaemonPath } from "./daemon-path";

describe("daemon spawn PATH", () => {
  test("preserves every existing entry, in order, at the front", () => {
    const result = buildDaemonPath(
      "/custom/bin:/another/bin",
      "darwin",
      "/Users/x",
    );
    const entries = result.split(":");
    expect(entries.slice(0, 2)).toEqual(["/custom/bin", "/another/bin"]);
  });
  test("appends the documented host fallbacks when absent", () => {
    const result = buildDaemonPath("/usr/bin", "darwin", "/Users/x");
    for (const fallback of [
      "/Users/x/.local/bin",
      "/Users/x/.opencode/bin",
      "/Users/x/.bun/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]) {
      expect(result.split(":")).toContain(fallback);
    }
  });
  test("never duplicates a fallback already present in the existing PATH", () => {
    const result = buildDaemonPath(
      "/opt/homebrew/bin:/usr/local/bin",
      "darwin",
      "/Users/x",
    );
    const entries = result.split(":");
    expect(
      entries.filter((entry) => entry === "/opt/homebrew/bin"),
    ).toHaveLength(1);
    expect(entries.filter((entry) => entry === "/usr/local/bin")).toHaveLength(
      1,
    );
  });
  test("an absent PATH still yields the fallback set", () => {
    const result = buildDaemonPath(undefined, "linux", "/home/x");
    expect(result.split(":")).toContain("/home/x/.local/bin");
  });
  test("Windows adds no POSIX fallbacks and uses semicolon separation", () => {
    const result = buildDaemonPath(
      "C:\\Windows\\System32",
      "win32",
      "C:\\Users\\x",
    );
    expect(result).toBe("C:\\Windows\\System32");
  });
});
