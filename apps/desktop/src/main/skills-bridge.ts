// MIT Copyright (c) 2026 Lovecast Inc.
// Skills settings bridge: real agent-skill data for the Settings "Agent
// skills" panels, ported from the Orca reference (read-only):
//   src/preload/api/skills-bridge.ts (renderer→main channel shape)
//   src/main/skills/discovery.ts + skill-discovery-sources.ts (installed
//     detection over the home skill roots)
//   src/shared/agent-feature-install-commands.ts (install/update commands)
// Adapted: Drogon's desktop has no runtime skill-discovery daemon yet, so the
// bundled `drogon-cli` (same J3 shim resolution as settings-bridge) serves the
// guide catalog via `skills list --json`, and installed detection scans the
// reference's three fixed home roots (~/.agents, ~/.claude, ~/.codex skills).
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import path from "node:path";
import { cliCandidates } from "./settings-bridge";
import { dataDirectory } from "./native-client";

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_BUFFER = 256 * 1024;

export type SkillsBridgeTopic = {
  name: string;
  description: string;
  installed: boolean;
  /** Home roots that already hold this skill's SKILL.md. */
  rootsFound: string[];
  installCommand: string;
  updateCommand: string;
};

export type SkillsOverview = {
  available: boolean;
  reason: string | null;
  topics: SkillsBridgeTopic[];
};

export type SkillsBridgeDeps = {
  dataDir?: string;
  pathEnv?: string;
  homeDir?: string;
  isExecutable?: (filePath: string) => Promise<boolean>;
  pathExists?: (filePath: string) => Promise<boolean>;
  run?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string } | { ok: false; reason: string }>;
};

type CliRunOk = { ok: true; stdout: string };
type CliRunFail = { ok: false; reason: string };

function defaultRun(
  file: string,
  args: string[],
): Promise<CliRunOk | CliRunFail> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER, windowsHide: true },
      (error, stdout) => {
        if (error) {
          const errno = error as NodeJS.ErrnoException & { killed?: boolean };
          if (errno.code === "ENOENT") return resolve({ ok: false, reason: "not-installed" });
          if (errno.code === "ETIMEDOUT" || errno.killed === true)
            return resolve({ ok: false, reason: "timed-out" });
          return resolve({ ok: false, reason: `exit ${(typeof errno.code === "number" ? errno.code : 1)}` });
        }
        resolve({ ok: true, stdout: String(stdout ?? "") });
      },
    );
  });
}

async function defaultIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Drogon's skill repository, matching crates/drogon-cli/src/skills.rs. */
export const DROGON_SKILLS_REPOSITORY_URL = "https://github.com/clioo/drogon";

/** Reference `buildAgentFeatureSkillInstallCommand` with Drogon's repo URL:
 *  human-paste form (no -y, no --agent) keeps the skills CLI's own prompts. */
export function skillInstallCommand(topic: string): string {
  return `npx skills add ${DROGON_SKILLS_REPOSITORY_URL} --skill ${topic} --global`;
}

/** Reference `buildAgentFeatureSkillUpdateCommand` with Drogon's topic. */
export function skillUpdateCommand(topic: string): string {
  return `npx skills update ${topic} --global`;
}

/** The fixed home roots the reference scans for installed skills
 *  (skill-discovery-sources.ts, home-agents/home-claude/home-codex). */
export function skillHomeRoots(homeDir: string): string[] {
  return [
    path.join(homeDir, ".agents", "skills"),
    path.join(homeDir, ".claude", "skills"),
    path.join(homeDir, ".codex", "skills"),
  ];
}

export async function probeSkillsOverview(
  deps: SkillsBridgeDeps = {},
): Promise<SkillsOverview> {
  const dataDir = deps.dataDir ?? dataDirectory();
  const pathEnv = deps.pathEnv ?? process.env.PATH;
  const delimiter = process.platform === "win32" ? ";" : ":";
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const run = deps.run ?? defaultRun;
  const homeDir = deps.homeDir ?? homedir();

  const candidates = cliCandidates(dataDir, pathEnv, delimiter);
  let resolved: string | null = null;
  for (const candidate of candidates) {
    if (await isExecutable(candidate.commandPath)) {
      resolved = candidate.commandPath;
      break;
    }
  }
  if (!resolved) {
    return {
      available: false,
      reason:
        "drogon-cli is not installed or not on PATH (expected at <data-dir>/bin/drogon-cli).",
      topics: [],
    };
  }

  let listed: { stdout: string } | { ok: false; reason: string };
  try {
    listed = await run(resolved, ["skills", "list", "--json"]);
  } catch (error) {
    listed = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!("stdout" in listed)) {
    return {
      available: false,
      reason: `drogon-cli skills list failed: ${listed.reason}`,
      topics: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(listed.stdout);
  } catch {
    return { available: false, reason: "drogon-cli skills list returned invalid JSON.", topics: [] };
  }
  const rawTopics = (parsed as { topics?: unknown })?.topics;
  if (!Array.isArray(rawTopics)) {
    return { available: false, reason: "drogon-cli skills list has no topics array.", topics: [] };
  }
  const topics: SkillsBridgeTopic[] = [];
  for (const entry of rawTopics) {
    const name = (entry as { name?: unknown })?.name;
    const description = (entry as { description?: unknown })?.description;
    if (typeof name !== "string" || name.length === 0) continue;
    const roots = skillHomeRoots(homeDir);
    const rootsFound: string[] = [];
    for (const root of roots) {
      // SKILL.md is the reference's skill-file contract; a directory alone
      // does not prove an installed skill.
      if (await pathExists(path.join(root, name, "SKILL.md"))) {
        rootsFound.push(path.join(root, name));
      }
    }
    topics.push({
      name,
      description: typeof description === "string" ? description : "",
      installed: rootsFound.length > 0,
      rootsFound,
      installCommand: skillInstallCommand(name),
      updateCommand: skillUpdateCommand(name),
    });
  }
  return { available: true, reason: null, topics };
}

const invalid = {
  ok: false as const,
  error: {
    code: "invalid_argument",
    message: "Invalid skills overview request.",
    retryable: false,
  },
};

/**
 * Registers `drogon:skillsOverview` with the same sender/frame gate
 * main/index.ts applies to its own bridge.
 */
export function registerSkillsBridge(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("drogon:skillsOverview", async (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ...invalid };
    return { ok: true as const, result: await probeSkillsOverview() };
  });
}
