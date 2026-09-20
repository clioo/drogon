import { describe, expect, test } from "vitest";
import { readUsageFixture, usageFixturePath } from "./fixture";

const providers = {
  claude: {
    provider: "claude",
    session: null,
    weekly: null,
    updatedAt: 1,
    error: "Claude is not signed in on this machine.",
    status: "unavailable",
  },
  codex: {
    provider: "codex",
    session: null,
    weekly: null,
    updatedAt: 1,
    error: "Codex is not signed in on this machine.",
    status: "unavailable",
  },
};

describe("usage fixture edges", () => {
  test("surrounding whitespace trims to the path", () => {
    expect(usageFixturePath({ DROGON_USAGE_FIXTURE: "  /tmp/f.json  " })).toBe("/tmp/f.json");
  });
  test("non-object JSON never parses to a fixture", async () => {
    for (const raw of ["5", "[1, 2]", "\"str\"", "null", "true"]) {
      expect(await readUsageFixture("x.json", (async () => raw) as never)).toBeNull();
    }
  });
  test("present-but-invalid memory/ports sections fall back to unmeasured", async () => {
    const fixture = await readUsageFixture(
      "partial.json",
      (async () =>
        JSON.stringify({
          ...providers,
          memory: { rssBytes: "lots", processCount: -1, unavailableReason: null },
          ports: { listening: [{ port: 0, process: "node" }], unavailableReason: null },
        })) as never,
    );
    expect(fixture?.memory).toEqual({
      rssBytes: null,
      processCount: null,
      unavailableReason: "Not in fixture.",
    });
    expect(fixture?.ports).toEqual({ listening: [], unavailableReason: "Not in fixture." });
  });
  test("a fixture missing one provider is unusable, never half-served", async () => {
    const fixture = await readUsageFixture(
      "half.json",
      (async () => JSON.stringify({ claude: providers.claude })) as never,
    );
    expect(fixture).toBeNull();
  });
});
