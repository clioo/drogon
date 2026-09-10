// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the skills settings bridge: catalog parsing, installed-root
// detection, command building, and failure degradation. Modeled on
// settings-bridge.test.ts.
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DROGON_SKILLS_REPOSITORY_URL,
  probeSkillsOverview,
  skillInstallCommand,
  skillHomeRoots,
  skillUpdateCommand,
  type SkillsBridgeDeps,
} from "./skills-bridge";

const exe = process.platform === "win32" ? ".exe" : "";
const shim = path.join("/data", "bin", `drogon-cli${exe}`);

const catalog = JSON.stringify({
  topics: [
    { name: "drogon-cli", description: "Drive Drogon through the public `drogon-cli`." },
    { name: "orchestration", description: "Use Drogon native orchestration." },
  ],
});

function deps(overrides: Partial<SkillsBridgeDeps> = {}): SkillsBridgeDeps {
  return {
    dataDir: "/data",
    pathEnv: "/usr/bin",
    homeDir: "/home/agent",
    isExecutable: async (filePath) => filePath === shim,
    pathExists: async () => false,
    run: async () => ({ stdout: catalog }),
    ...overrides,
  };
}

describe("probeSkillsOverview", () => {
  test("serves the bundled CLI catalog with install/update commands", async () => {
    const overview = await probeSkillsOverview(deps());
    expect(overview.available).toBe(true);
    expect(overview.reason).toBeNull();
    expect(overview.topics.map((topic) => topic.name)).toEqual([
      "drogon-cli",
      "orchestration",
    ]);
    for (const topic of overview.topics) {
      expect(topic.installCommand).toBe(
        `npx skills add ${DROGON_SKILLS_REPOSITORY_URL} --skill ${topic.name} --global`,
      );
      expect(topic.updateCommand).toBe(`npx skills update ${topic.name} --global`);
      expect(topic.installed).toBe(false);
      expect(topic.rootsFound).toEqual([]);
    }
  });

  test("marks a skill installed when a home root holds its SKILL.md", async () => {
    const claudeRoot = path.join("/home/agent", ".claude", "skills");
    const overview = await probeSkillsOverview(
      deps({
        pathExists: async (filePath) =>
          filePath === path.join(claudeRoot, "drogon-cli", "SKILL.md"),
      }),
    );
    const cli = overview.topics.find((topic) => topic.name === "drogon-cli");
    expect(cli?.installed).toBe(true);
    expect(cli?.rootsFound).toEqual([path.join(claudeRoot, "drogon-cli")]);
    // The other topic stays uninstalled: only real SKILL.md files count.
    const orch = overview.topics.find((topic) => topic.name === "orchestration");
    expect(orch?.installed).toBe(false);
  });

  test("scans exactly the reference's fixed home roots", () => {
    expect(skillHomeRoots("/home/agent")).toEqual([
      path.join("/home/agent", ".agents", "skills"),
      path.join("/home/agent", ".claude", "skills"),
      path.join("/home/agent", ".codex", "skills"),
    ]);
  });

  test("degrades honestly when the CLI is missing or answers badly", async () => {
    const missing = await probeSkillsOverview(
      deps({ isExecutable: async () => false }),
    );
    expect(missing.available).toBe(false);
    expect(missing.topics).toEqual([]);
    expect(missing.reason).toContain("not installed");

    const badJson = await probeSkillsOverview(
      deps({ run: async () => ({ stdout: "not json" }) }),
    );
    expect(badJson.available).toBe(false);
    expect(badJson.reason).toContain("invalid JSON");

    const noTopics = await probeSkillsOverview(
      deps({ run: async () => ({ stdout: "{}" }) }),
    );
    expect(noTopics.available).toBe(false);

    const failed = await probeSkillsOverview(
      deps({ run: async () => Promise.reject(new Error("boom")) as never }),
    );
    expect(failed.available).toBe(false);
  });

  test("skips catalog entries without a usable name", async () => {
    const overview = await probeSkillsOverview(
      deps({
        run: async () => ({
          stdout: JSON.stringify({
            topics: [{ name: "", description: "x" }, { description: "y" }, catalog ? undefined : null],
          }).replace(",null", ""),
        }),
      }),
    );
    expect(overview.topics).toEqual([]);
  });
});

describe("command builders", () => {
  test("match the reference argv contract with Drogon's repository", () => {
    expect(skillInstallCommand("drogon-cli")).toBe(
      "npx skills add https://github.com/clioo/drogon --skill drogon-cli --global",
    );
    expect(skillUpdateCommand("orchestration")).toBe(
      "npx skills update orchestration --global",
    );
  });
});
