import { describe, expect, test } from "vitest";
import { readUsageFixture, usageFixturePath } from "./fixture";

const valid = JSON.stringify({
  claude: {
    provider: "claude",
    session: { usedPercent: 55, windowMinutes: 300, resetsAt: 1, resetDescription: null },
    weekly: { usedPercent: 30, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    fableWeekly: null,
    updatedAt: 1,
    error: null,
    status: "ok",
  },
  codex: {
    provider: "codex",
    session: null,
    weekly: null,
    updatedAt: 1,
    error: "Codex helper exited before reporting usage.",
    status: "error",
  },
  memory: { rssBytes: 1024, processCount: 2, unavailableReason: null },
  ports: { listening: [{ port: 3000, process: "node" }], unavailableReason: null },
});

describe("DROGON_USAGE_FIXTURE seam", () => {
  test("no env var means probe for real", () => {
    expect(usageFixturePath({})).toBeNull();
    expect(usageFixturePath({ DROGON_USAGE_FIXTURE: "  " })).toBeNull();
    expect(usageFixturePath({ DROGON_USAGE_FIXTURE: "/tmp/f.json" })).toBe("/tmp/f.json");
  });
  test("a valid fixture file parses through the shared schemas", async () => {
    const fixture = await readUsageFixture("fixture.json", (() => valid) as never);
    expect(fixture?.claude.status).toBe("ok");
    expect(fixture?.codex.status).toBe("error");
    expect(fixture?.memory.rssBytes).toBe(1024);
    expect(fixture?.ports.listening).toEqual([{ port: 3000, process: "node" }]);
  });
  test("a missing file or broken shape disables the fixture (fail open)", async () => {
    expect(await readUsageFixture("missing.json", (() => {
      throw new Error("ENOENT");
    }) as never)).toBeNull();
    expect(
      await readUsageFixture("broken.json", (() => "{\"claude\": 4}") as never),
    ).toBeNull();
    expect(
      await readUsageFixture("half.json", (() => JSON.stringify({ claude: { nope: 1 } })) as never),
    ).toBeNull();
    expect(await readUsageFixture(null, (() => valid) as never)).toBeNull();
  });
  test("memory/ports sections default to honest unmeasured values", async () => {
    const fixture = await readUsageFixture(
      "providers-only.json",
      (() =>
        JSON.stringify({
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
        })) as never,
    );
    expect(fixture?.memory).toEqual({
      rssBytes: null,
      processCount: null,
      unavailableReason: "Not in fixture.",
    });
    expect(fixture?.ports).toEqual({
      listening: [],
      unavailableReason: "Not in fixture.",
    });
  });
});
