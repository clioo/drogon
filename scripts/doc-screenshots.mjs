#!/usr/bin/env node
/**
 * Capture the documentation surfaces from an isolated packaged Drogon build.
 *
 * This is deliberately a black-box fixture: product data is seeded through
 * the CLI/RPC and all external commands are local stubs. The Electron window
 * stays hidden while Playwright connects over CDP.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

import {
  stopAcceptanceProcess,
  startAcceptanceProcess,
} from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { writeAcceptanceUsageFixture } from "./acceptance-usage-fixture.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "docs", "screenshots");
const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };
const NARROW_VIEWPORT = { width: 760, height: 1000 };
const MAX_SCREENSHOT_BYTES = 400 * 1024;

const PRS = [
  {
    number: 42,
    title: "Improve atlas navigation",
    state: "OPEN",
    url: "https://github.com/fixture-org/atlas-demo/pull/42",
    author: { login: "atlas-bot" },
    assignees: [{ login: "reviewer" }],
    reviewDecision: "APPROVED",
    statusCheckRollup: [
      { conclusion: "SUCCESS" },
      { conclusion: "SUCCESS" },
    ],
    mergeable: "MERGEABLE",
    isDraft: false,
    headRefName: "improve-navigation",
    baseRefName: "main",
    updatedAt: "2026-09-10T12:00:00Z",
    labels: [{ name: "ready", color: "0e8a16" }],
  },
  {
    number: 37,
    title: "Add release checklist",
    state: "OPEN",
    url: "https://github.com/fixture-org/atlas-demo/pull/37",
    author: { login: "docs-bot" },
    assignees: [],
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [
      { conclusion: "SUCCESS" },
      { conclusion: "FAILURE" },
      { conclusion: "PENDING" },
    ],
    mergeable: "CONFLICTING",
    isDraft: true,
    headRefName: "release-checklist",
    baseRefName: "main",
    updatedAt: "2026-09-08T09:30:00Z",
    labels: [{ name: "needs-review", color: "fbca04" }],
  },
];

const ANALYSIS = {
  summary: "The Atlas team aligned on the accessibility release.",
  decisions: [
    {
      text: "Ship the accessibility pass.",
      quote: "We will ship the accessibility pass.",
    },
  ],
  actions: [
    {
      text: "Complete the release follow-up.",
      owner: "Riley",
      due: null,
      quote: "Riley owns the follow-up.",
      confidence: "high",
    },
  ],
  openQuestions: [],
};

function parseArgs(argv) {
  const options = {
    bundle: process.env.DROGON_SCREENSHOT_BUNDLE ?? null,
    output: DEFAULT_OUTPUT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      options.bundle = argv[++index];
    } else if (arg === "--output") {
      options.output = path.resolve(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/doc-screenshots.mjs [--bundle Drogon.app] [--output docs/screenshots]",
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function findPackagedBundle(requestedBundle = null) {
  const explicit = requestedBundle?.trim() || process.env.DROGON_SCREENSHOT_BUNDLE?.trim();
  const searchRoot = path.join(REPO_ROOT, ".preflight", "build-main");
  const candidates = [];

  async function walk(directory, depth = 0) {
    if (depth > 10) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const child = path.join(directory, entry.name);
      if (
        entry.name === "Drogon.app" &&
        (await isFile(path.join(child, "Contents", "MacOS", "Drogon")))
      ) {
        candidates.push(child);
        continue;
      }
      await walk(child, depth + 1);
    }
  }

  if (explicit) return path.resolve(explicit);
  await walk(searchRoot);
  if (candidates.length === 0) {
    throw new Error(
      "No packaged Drogon.app found. Run ./scripts/build-main.sh first or pass --bundle /path/to/Drogon.app.",
    );
  }
  const ranked = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      modified: (await stat(candidate)).mtimeMs,
    })),
  );
  ranked.sort((left, right) => right.modified - left.modified);
  return ranked[0].candidate;
}

function loadPlaywright(bundle) {
  let directory = path.dirname(bundle);
  for (let index = 0; index < 10; index += 1) {
    const packageFile = path.join(directory, "package.json");
    if (existsSync(packageFile)) {
      try {
        const require = createRequire(packageFile);
        return require("playwright");
      } catch {
        // Keep walking: the packaged app's source checkout owns Playwright.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    "Playwright is not available from the packaged build checkout. Re-run the pinned build and use its source directory.",
  );
}

function baseFixtureEnvironment({ fixture, data, profile, home, bin, usageFixture, transcripts }) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("ORCA_") ||
      key.startsWith("PI_") ||
      ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENCODE_CONFIG_DIR"].includes(key)
    ) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    HOME: home,
    USER: "fixture",
    LOGNAME: "fixture",
    HOSTNAME: "drogon-doc-fixture",
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: path.join(fixture, "tmp"),
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
    DROGON_DATA_DIR: data,
    DROGON_ELECTRON_PROFILE: profile,
    DROGON_BACKGROUND_WINDOW: "1",
    DROGON_WINDOW_BOUNDS: "1440x1000+5000+5000",
    DROGON_USAGE_FIXTURE: usageFixture,
    PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
    WTD_OUTPUT_DIR: transcripts,
  };
}

async function runChecked(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) =>
      resolve(exitCode === null ? 128 : exitCode),
    );
  });
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`);
  }
  return { stdout, stderr };
}

async function createFixtureWorld(fixture) {
  const data = path.join(fixture, "data");
  const profile = path.join(fixture, "electron-profile");
  const home = path.join(fixture, "home");
  const folder = path.join(fixture, "atlas-demo");
  const bin = path.join(fixture, "bin");
  const transcripts = path.join(fixture, "Transcripts");
  const temporary = path.join(fixture, "tmp");
  await mkdir(
    path.join(transcripts, "2026-09-11"),
    { recursive: true },
  );
  await mkdir(path.join(transcripts, "2026-09-10"), { recursive: true });
  await mkdir(path.join(folder, "docs"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(temporary, { recursive: true });
  await mkdir(path.join(home, ".pi", "agent"), { recursive: true });

  await writeFile(
    path.join(transcripts, "2026-09-11", "09-30_42min.md"),
    `# Atlas planning sync
**Date:** 2026-09-11 09:30
**Duration:** 42 min

## Transcript

[00:00] zanzibar release plan
[00:12] We will ship the accessibility pass.
[00:24] Riley owns the follow-up.
`,
  );
  await writeFile(
    path.join(transcripts, "2026-09-10", "14-00_18min.md"),
    `# Design review
**Date:** 2026-09-10 14:00
**Duration:** 18 min

## Transcript

[00:00] The Atlas navigation should stay compact.
`,
  );

  await writeFile(path.join(folder, "README.md"), "Atlas Demo fixture repository.\n");
  await writeFile(
    path.join(folder, "docs", "overview.md"),
    "Documentation fixture for screenshot capture.\n",
  );
  // Evaluation evidence is product-generated during the adversarial fixture run.
  await writeFile(path.join(folder, ".gitignore"), ".drogon/evaluations/\n.mentu/\n");
  await runChecked("git", ["init", "-b", "main"], { cwd: folder });
  await runChecked("git", ["add", "."], { cwd: folder });
  await runChecked(
    "git",
    [
      "-c",
      "user.email=fixture@drogon.local",
      "-c",
      "user.name=Drogon Fixture",
      "commit",
      "-m",
      "fixture repository",
    ],
    { cwd: folder },
  );
  await runChecked(
    "git",
    ["remote", "add", "origin", "https://github.com/fixture-org/atlas-demo.git"],
    { cwd: folder },
  );

  const ghJson = JSON.stringify(PRS);
  const ghView = JSON.stringify(PRS[0]);
  await writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$*" in
  *"pr list"*) printf '%s\\n' '${ghJson}' ;;
  *"pr view"*) printf '%s\\n' '${ghView}' ;;
  *"issue list"*) printf '%s\\n' '[]' ;;
  *"api user"*) printf '%s\\n' '{"login":"fixture-user"}' ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(path.join(bin, "gh"), 0o755);

  const analysisJson = JSON.stringify(ANALYSIS);
  const localAgentScript = `#!/bin/sh
text="$*"
if printf '%s' "$text" | grep -q -- '--provider dgx-spark'; then
  printf '%s\\n' '${analysisJson}'
  exit 0
fi
eval_path=$(printf '%s\\n' "$text" | sed -n 's/.*Write \\(\\.drogon\\/evaluations\\/[^ ]*\\.json\\).*/\\1/p' | tail -1)
if [ -n "$eval_path" ]; then
  mkdir -p "$(dirname "$eval_path")"
  printf '%s\\n' '{"verdict":"pass","evidence":"Fixture verification completed."}' > "$eval_path"
fi
sentinel=$(printf '%s\\n' "$text" | grep -o 'DROGON_NODE_[A-Z0-9_]*_DONE' | tail -1)
printf '%s\\n' 'Fixture local model completed.'
[ -z "$sentinel" ] || printf '%s\\n' "$sentinel"
`;
  const simpleAgentScript = (label, writesEvaluation = false) => `#!/bin/sh
text="$*"
${writesEvaluation ? `eval_path=$(printf '%s\\n' "$text" | sed -n 's/.*Write \\(\\.drogon\\/evaluations\\/[^ ]*\\.json\\).*/\\1/p' | tail -1)
if [ -n "$eval_path" ]; then
  mkdir -p "$(dirname "$eval_path")"
  printf '%s\\n' '{"verdict":"pass","evidence":"Fixture verification completed."}' > "$eval_path"
fi
` : ""}sentinel=$(printf '%s\\n' "$text" | grep -o 'DROGON_NODE_[A-Z0-9_]*_DONE' | tail -1)
printf '%s\\n' '${label}'
[ -z "$sentinel" ] || printf '%s\\n' "$sentinel"
`;
  await writeFile(path.join(bin, "pi"), localAgentScript);
  await chmod(path.join(bin, "pi"), 0o755);
  await writeFile(path.join(bin, "claude"), simpleAgentScript("Fixture Claude completed.", true));
  await chmod(path.join(bin, "claude"), 0o755);
  await writeFile(path.join(bin, "codex"), simpleAgentScript("Fixture Codex completed.", true));
  await chmod(path.join(bin, "codex"), 0o755);
  await writeFile(path.join(bin, "opencode"), simpleAgentScript("Fixture OpenCode completed.", true));
  await chmod(path.join(bin, "opencode"), 0o755);

  const usage = await writeAcceptanceUsageFixture(fixture, Date.UTC(2026, 8, 12, 12, 0, 0));
  return {
    data,
    profile,
    home,
    folder,
    bin,
    transcripts,
    usageFixture: usage.path,
  };
}

async function runCliJson(cli, data, environment, args) {
  const result = await runChecked(
    cli,
    ["--data-dir", data, "--json", ...args],
    { env: environment },
  );
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true, `${args.join(" ")}: ${result.stdout}`);
  return response.result;
}

async function waitForText(page, text, timeout = 20_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}

async function waitForAnyText(page, texts, timeout = 20_000) {
  await Promise.any(
    texts.map((text) =>
      page.getByText(text, { exact: false }).first().waitFor({ timeout }),
    ),
  );
}

async function waitForTestId(page, testId, timeout = 20_000) {
  await page.getByTestId(testId).waitFor({ timeout });
}

async function ensureNoOwnerPath(page) {
  const text = await page.locator("body").innerText();
  assert.doesNotMatch(text, /\/Users\/carlos/u, "owner path leaked into rendered DOM");
  assert.doesNotMatch(text, /Carloss-MacBook/u, "owner hostname leaked into rendered DOM");
}

async function writeScreenshot(page, outputDir, captures, filename, note) {
  await ensureNoOwnerPath(page);
  const file = path.join(outputDir, filename);
  await page.screenshot({ path: file });
  const raw = await stat(file);
  if (raw.size > MAX_SCREENSHOT_BYTES) {
    const temporary = `${file}.resize.png`;
    await runChecked("sips", ["-Z", "1440", file, "--out", temporary]);
    await rm(file);
    await rename(temporary, file);
  }
  const final = await stat(file);
  assert.ok(final.size <= MAX_SCREENSHOT_BYTES, `${filename} is ${final.size} bytes`);
  const png = await readFile(file);
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${filename} is not a PNG`,
  );
  const expectedWidth = filename.includes("narrow") ? NARROW_VIEWPORT.width : DESKTOP_VIEWPORT.width;
  assert.equal(png.readUInt32BE(16), expectedWidth, `${filename} width`);
  assert.equal(png.readUInt32BE(20), DESKTOP_VIEWPORT.height, `${filename} height`);
  captures.push({
    filename,
    note,
    bytes: final.size,
    step: screenshotSeedingStep(filename),
  });
}

async function openSettings(page) {
  const button = page.getByRole("button", { name: "Settings", exact: true }).first();
  await button.click();
  await page.locator(".settings-view-shell").waitFor({ timeout: 20_000 });
}

async function selectSettingsTheme(page, label) {
  await page
    .locator(".settings-view-shell aside")
    .getByRole("button", { name: "Appearance", exact: true })
    .click();
  await page.getByRole("radio", { name: label, exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function setTheme(page, label) {
  await openSettings(page);
  await selectSettingsTheme(page, label);
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.locator(".settings-view-shell").waitFor({ state: "detached", timeout: 20_000 });
  const expectDark = label === "Dark";
  await page.waitForFunction(
    (shouldBeDark) => document.documentElement.classList.contains("dark") === shouldBeDark,
    expectDark,
    { timeout: 20_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 650));
}

async function goWorkspace(page) {
  const terminal = page.getByRole("tab", { name: /^Terminal 1/u }).first();
  if ((await terminal.count()) > 0) {
    await terminal.click();
  } else {
    // Activity pages intentionally hide the session tab strip. The Sessions
    // nav restores it without changing workspace selection.
    const sessions = page.getByRole("button", { name: "Sessions", exact: true }).first();
    if ((await sessions.count()) > 0) {
      await sessions.click();
    } else {
      const workspace = page.getByRole("button", { name: "Select docs-preview", exact: true }).first();
      await workspace.click();
    }
    await page.getByRole("tab", { name: /^Terminal 1/u }).first().click();
  }
  await page.locator(".session-header").waitFor({ timeout: 20_000 });
}

async function goPage(page, name, testId) {
  const navigation = page.getByRole("button", { name, exact: true }).first();
  await navigation.click();
  await waitForTestId(page, testId);
  // Full-page mounts share the keep-alive shell; wait through the route
  // transition before capturing computed theme/background styles.
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function openGraphTab(page) {
  const existing = page.getByTestId("recipe-tab");
  if (await existing.count()) {
    await existing.last().click();
    await waitForTestId(page, "orchestrator-canvas");
    return;
  }
  await goWorkspace(page);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await waitForTestId(page, "orchestrator-canvas");
}

async function seedProject(cli, data, environment, folder) {
  const project = await runCliJson(cli, data, environment, [
    "project",
    "add",
    folder,
    "--name",
    "Atlas Demo",
  ]);
  const worktree = await runCliJson(cli, data, environment, [
    "worktree",
    "create",
    "--project",
    project.id,
    "--name",
    "docs-preview",
    "--base",
    "main",
  ]);
  return { project, worktree };
}

async function seedGraph(cli, data, environment, workspaceId) {
  const policy = {
    approvedRuntimes: [
      { harness: "pi", model: "fixture-model" },
      { harness: "claude", model: "fixture-model" },
      { harness: "codex", model: "fixture-model" },
    ],
    fallbackRuntime: { harness: "opencode", model: "fixture-fallback" },
    adversarial: { enabled: false, maxIterations: 2 },
    delegate: false,
  };
  const main = {
    id: "main",
    title: "Main agent",
    harness: "claude",
    model: "fixture-main",
    prompt: "Review Atlas release readiness and prepare a merge-ready summary.",
    dependsOn: [],
    enabled: true,
  };
  await runCliJson(cli, data, environment, [
    "rpc",
    "graph.write_policy",
    "--params",
    JSON.stringify({ workspaceId, policy, main }),
  ]);
  return policy;
}

async function runAdversarialFixture(cli, data, environment, workspaceId) {
  const policy = {
    approvedRuntimes: [
      { harness: "pi", model: "fixture-model" },
      { harness: "claude", model: "fixture-model" },
      { harness: "codex", model: "fixture-model" },
    ],
    fallbackRuntime: { harness: "opencode", model: "fixture-fallback" },
    adversarial: { enabled: true, maxIterations: 2 },
    delegate: false,
  };
  await runCliJson(cli, data, environment, [
    "rpc",
    "graph.write_policy",
    "--params",
    JSON.stringify({
      workspaceId,
      policy,
      main: {
        id: "main",
        title: "Main agent",
        harness: "claude",
        model: "fixture-main",
        prompt: "Review Atlas release readiness and prepare a merge-ready summary.",
        dependsOn: [],
        enabled: true,
      },
    }),
  ]);
  await runCliJson(cli, data, environment, [
    "rpc",
    "graph.orchestrator_start",
    "--params",
    JSON.stringify({
      workspaceId,
      main: {
        id: "orchestrator-main",
        title: "Main agent",
        harness: "claude",
        model: "fixture-main",
        prompt: "Review Atlas release readiness and prepare a merge-ready summary.",
        dependsOn: [],
        enabled: true,
      },
    }),
  ]);
  let latest = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    latest = await runCliJson(cli, data, environment, [
      "rpc",
      "graph.orchestrator_status",
      "--params",
      JSON.stringify({ workspaceId }),
    ]);
    if (latest.run?.status === "passed") break;
    if (["failed", "exhausted", "unverifiable"].includes(latest.run?.status)) break;
  }
  assert.equal(latest?.run?.status, "passed", JSON.stringify(latest));
  return latest.run;
}

async function seedAutomations(cli, data, environment, workspaceId) {
  const create = async (name, prompt) =>
    runCliJson(cli, data, environment, [
      "rpc",
      "automation.create",
      "--params",
      JSON.stringify({
        name,
        cron: "0 4 29 2 *",
        timezone: "UTC",
        workspaceId,
        harness: "claude",
        model: "fixture-automation",
        prompt,
        enabled: true,
        graceMinutes: 15,
      }),
    ]);
  const first = await create(
    "Release readiness digest",
    "Summarize the Atlas release queue and call out blockers.",
  );
  const second = await create(
    "Documentation quality pulse",
    "Review the fixture documentation and report one useful improvement.",
  );
  for (const automation of [first, second]) {
    await runCliJson(cli, data, environment, [
      "rpc",
      "automation.run_now",
      "--params",
      JSON.stringify({ id: automation.id }),
    ]);
  }
  let completed = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const history = await Promise.all(
      [first, second].map((automation) =>
        runCliJson(cli, data, environment, [
          "rpc",
          "automation.history",
          "--params",
          JSON.stringify({ automationId: automation.id, limit: 5 }),
        ]),
      ),
    );
    if (history.every((entry) => entry.runs?.[0]?.status === "completed")) {
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  assert.equal(completed, true, "fixture automation runs did not complete");
  return { first, second };
}

async function seedBots(page, cli, data, environment, project, workspaceId) {
  const create = async (name, instructions) => {
    await page.getByRole("button", { name: "New Bot", exact: true }).click();
    const form = page.getByRole("form", { name: "Create a Bot" });
    await form.getByLabel("Name (optional)").fill(name);
    await form.locator("textarea").first().fill(instructions);
    await form.getByRole("button", { name: "Create Bot", exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 900));
  };

  await goPage(page, "Bots", "bots-panel");
  await create("Lumen", "Own release readiness and keep the team aligned.");
  try {
    await page.getByText("Lumen", { exact: true }).waitFor({ timeout: 20_000 });
  } catch (error) {
    console.error("Bots after Lumen create:", await page.locator("body").innerText());
    throw error;
  }
  await page.locator('[data-testid^="add-responsibility-"]').first().click();
  const responsibility = page.getByTestId("responsibility-form");
  await responsibility.getByLabel("Name").fill("Release watch");
  await responsibility.getByLabel("Cron expression (UTC)").fill("0 4 29 2 *");
  await responsibility.getByLabel("Prompt").fill("Review the release queue and summarize blockers.");
  await responsibility.getByRole("button", { name: "Save responsibility", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 650));

  await create("Nova", "Keep documentation follow-through visible to the team.");
  await create("Sable", "Track quality signals and surface actionable improvements.");

  const snapshot = await runCliJson(cli, data, environment, [
    "rpc",
    "bot.snapshot",
    "--params",
    JSON.stringify({ hostId: project.hostId, workspaceId: "", locale: "en-US" }),
  ]);
  const lumen = snapshot.bots.find((bot) => bot.displayIdentity.displayName === "Lumen");
  assert.ok(lumen, "Lumen bot was not created");
  await runCliJson(cli, data, environment, [
    "bot",
    "watch-pr",
    "--bot",
    lumen.id,
    "--workspace",
    workspaceId,
    "--repo",
    "fixture-org/atlas-demo",
    "--filter",
    "opened",
    "--harness",
    "claude",
    "--skill",
    "review-playbook",
    "--api-base",
    "http://127.0.0.1:9",
    "--manual",
    "--responsibility-name",
    "Review pull requests",
    "--instructions",
    "Review new pull requests and summarize checks.",
    "--approve",
  ]);
  await page.getByRole("button", { name: "Refresh Bots", exact: true }).click();
  await waitForText(page, "fixture-org/atlas-demo");
  return snapshot;
}

async function captureMeetings(page, outputDir, captures, acceptAction) {
  await goPage(page, "Meetings", "meetings-page-host");
  const host = page.getByTestId("meetings-page-host");
  const search = host.getByLabel("Search transcripts");
  await search.fill("accessibility");
  await host.getByRole("combobox", { name: "Meeting date", exact: true }).click();
  await page.getByRole("option", { name: "Last 30 days", exact: true }).click();
  await page.keyboard.press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitForText(page, "Atlas planning sync");
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `meetings-filtered-${captures.theme}.png`,
    "Meetings transcript list with accessibility search and Last 30 days filter applied.",
  );

  await host.getByRole("button", { name: "Open transcript Atlas planning sync", exact: true }).click();
  await waitForText(page, "Suggest actions with the local model");
  await page.getByRole("button", { name: "Suggest actions with the local model", exact: true }).click();
  await page.getByRole("heading", { name: "Suggested from this transcript", exact: true }).waitFor({ timeout: 20_000 });
  await waitForText(page, "Complete the release follow-up.");
  if (acceptAction) {
    await page.getByRole("button", { name: "Add to my actions", exact: true }).click();
    await waitForText(page, "Added to my actions: Complete the release follow-up.");
  }
  await page.getByRole("heading", { name: "Suggested from this transcript", exact: true }).scrollIntoViewIfNeeded();
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `meeting-actions-${captures.theme}.png`,
    "Atlas planning sync open with verified decision and extracted action item.",
  );
}

async function captureAutomations(page, outputDir, captures) {
  await goPage(page, "Automations", "automations-panel");
  await waitForText(page, "Release readiness digest");
  const row = page
    .locator('[data-testid^="automation-row-"]')
    .filter({ hasText: "Release readiness digest" })
    .first();
  await row.getByRole("button", { name: /Automation actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit automation" }).waitFor({ timeout: 20_000 });
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `automations-editor-${captures.theme}.png`,
    "Automation editor showing Release readiness digest, UTC timezone, dormant Feb-29 cron schedule and enabled state.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await waitForText(page, "Successful · 24h");
  await waitForText(page, "Release readiness digest");
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `automations-runs-${captures.theme}.png`,
    "Automation Runs dashboard with two recorded fixture runs.",
  );
}

async function captureTasks(page, outputDir, captures) {
  await goPage(page, "Tasks", "tasks-page-host");
  const host = page.getByTestId("tasks-page-host");
  await host.getByRole("button", { name: "PRs", exact: true }).click();
  await waitForText(page, "Improve atlas navigation");
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `tasks-prs-${captures.theme}.png`,
    "Tasks GitHub PR mode with review, checks and merge cells populated from fixture-org/atlas-demo.",
  );
}

async function captureSettings(page, outputDir, captures, theme) {
  await openSettings(page);
  await selectSettingsTheme(page, theme === "light" ? "Light" : "Dark");
  captures.theme = theme;
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `settings-appearance-${theme}.png`,
    "Settings Appearance pane showing the active theme control.",
  );
  await page
    .locator(".settings-view-shell aside")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await waitForText(page, "Installed");
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `settings-agents-${theme}.png`,
    "Settings Agents pane showing detected fixture harnesses and run-locally controls.",
  );
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.locator(".settings-view-shell").waitFor({ state: "detached", timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function captureWorkspace(page, outputDir, captures, theme) {
  await goWorkspace(page);
  await writeScreenshot(
    page,
    outputDir,
    captures,
    `workspace-${theme}.png`,
    `Workspace backbone at 1440px with Atlas Demo/docs-preview, a live terminal tab, Explorer and fixture usage status bar (${theme}).`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) return;
  const bundle = await findPackagedBundle(options.bundle);
  const { chromium } = loadPlaywright(bundle);
  const cli = path.join(bundle, "Contents", "Resources", "bin", "drogon-cli");
  assert.ok(await isFile(cli), `packaged CLI missing: ${cli}`);
  const appBinary = path.join(bundle, "Contents", "MacOS", "Drogon");
  assert.ok(await isFile(appBinary), `packaged executable missing: ${appBinary}`);
  await mkdir(options.output, { recursive: true });

  // /tmp avoids exposing the invoking checkout in any rendered workspace path.
  const fixture = await mkdtemp("/tmp/drogon-doc-screenshots-");
  const world = await createFixtureWorld(fixture);
  const environment = baseFixtureEnvironment({
    fixture,
    ...world,
  });
  const daemon = packagedFixtureDaemon(appBinary, cli, world.data);
  const app = startAcceptanceProcess(appBinary, ["--remote-debugging-port=0"], {
    env: environment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let browser = null;
  let page = null;
  const captures = [];
  let cleanupError = null;

  try {
    let devtoolsOutput = "";
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for DevTools: ${devtoolsOutput.slice(-4000)}`)),
        30_000,
      );
      app.stderr.on("data", (chunk) => {
        devtoolsOutput = `${devtoolsOutput}${chunk.toString()}`.slice(-12_000);
        const match = devtoolsOutput.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/u);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      app.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`Packaged app exited before CDP (${code ?? signal})`));
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    for (let attempt = 0; attempt < 300 && !page; attempt += 1) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("file:"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(page, "packaged renderer page did not appear");
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    page.setDefaultTimeout(20_000);
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 30_000 });

    // The daemon is started by the packaged app, so all CLI/RPC seeding comes
    // after the authenticated service is ready.
    const project = await seedProject(cli, world.data, environment, world.folder);
    const workspaceId = project.worktree.workspaceId;
    await seedGraph(cli, world.data, environment, workspaceId);
    // Refresh the renderer so the sidebar selects the newly created worktree;
    // bot creation intentionally refuses an absent workspace scope.
    await page.reload();
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.getByRole("tab", { name: /^Terminal 1/u }).waitFor({ timeout: 20_000 });
    await seedBots(page, cli, world.data, environment, project.project, workspaceId);
    await seedAutomations(cli, world.data, environment, workspaceId);
    await goWorkspace(page);
    const terminalInput = page.locator(".xterm-helper-textarea").last();
    await terminalInput.focus();
    await page.keyboard.type(
      "export PS1='fixture@atlas % '; export PROMPT='fixture@atlas % '; clear; printf 'DROGON_DOCS_FIXTURE_READY\\n'",
    );
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Light pass: capture the list/editor states before enabling the run loop.
    await setTheme(page, "Light");
    captures.theme = "light";
    await captureWorkspace(page, options.output, captures, "light");
    await page.setViewportSize(NARROW_VIEWPORT);
    await goWorkspace(page);
    await writeScreenshot(
      page,
      options.output,
      captures,
      "workspace-narrow-light.png",
      "Workspace backbone at 760px light layout with the fixture terminal and responsive shell.",
    );
    await page.setViewportSize(DESKTOP_VIEWPORT);

    await openGraphTab(page);
    try {
      await waitForAnyText(page, [
        "No optional subagents enabled",
        "Direct mode · main agent works without subagents",
      ]);
    } catch (error) {
      console.error("Work Graph after initial open:", await page.locator("body").innerText());
      throw error;
    }
    await writeScreenshot(
      page,
      options.output,
      captures,
      "orchestrator-off-light.png",
      "Work Graph Orchestrator with Main agent, Ready to run, three approved fixture runtimes, fallback and optional modes off (Direct mode in the current build).",
    );
    await goPage(page, "Bots", "bots-panel");
    await waitForText(page, "fixture-org/atlas-demo");
    captures.theme = "light";
    await writeScreenshot(
      page,
      options.output,
      captures,
      "bots-expanded-light.png",
      "Bots page with Lumen expanded, Nova and Sable cards, Release watch automation and a fixture-org/atlas-demo monitor.",
    );
    await captureMeetings(page, options.output, captures, true);
    await captureAutomations(page, options.output, captures);
    await captureTasks(page, options.output, captures);
    await captureSettings(page, options.output, captures, "light");

    // Dark pass for the static surfaces, then execute the real bounded loop.
    await goWorkspace(page);
    await setTheme(page, "Dark");
    captures.theme = "dark";
    await captureWorkspace(page, options.output, captures, "dark");
    await openGraphTab(page);
    await waitForAnyText(page, [
      "No optional subagents enabled",
      "Direct mode · main agent works without subagents",
    ]);
    await writeScreenshot(
      page,
      options.output,
      captures,
      "orchestrator-off-dark.png",
      "Dark Work Graph Orchestrator with Main agent, Ready to run, approved runtimes and fallback while adversarial testing is off (Direct mode in the current build).",
    );

    // Enable the optional mode through the real panel, then let the daemon own
    // a complete shell-fixture run so the terminal can honestly say Ready to merge.
    await page.getByTestId("adversarial-toggle").click();
    await waitForText(page, "Saved automatically");
    await setTheme(page, "Light");
    await openGraphTab(page);
    await waitForText(page, "Adversarial loop");
    const run = await runAdversarialFixture(cli, world.data, environment, workspaceId);
    assert.equal(run.status, "passed");
    await page.reload();
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
    await openGraphTab(page);
    await waitForText(page, "Ready to merge");
    await page
      .getByTestId("subagent-policy-panel")
      .getByText("Maximum iterations", { exact: true })
      .scrollIntoViewIfNeeded();
    await waitForText(page, "Maximum iterations");
    captures.theme = "light";
    await writeScreenshot(
      page,
      options.output,
      captures,
      "orchestrator-adversarial-light.png",
      "Light Work Graph with dashed Adversarial loop (Adversarial test to Code review), Repeat up to 2×, Maximum iterations stepper and Ready to merge.",
    );

    await openSettings(page);
    await selectSettingsTheme(page, "Dark");
    captures.theme = "dark";
    await writeScreenshot(
      page,
      options.output,
      captures,
      "settings-appearance-dark.png",
      "Settings Appearance pane showing Dark theme selected.",
    );
    await page
      .locator(".settings-view-shell aside")
      .getByRole("button", { name: "Agents", exact: true })
      .click();
    await waitForText(page, "Installed");
    await writeScreenshot(
      page,
      options.output,
      captures,
      "settings-agents-dark.png",
      "Dark Settings Agents pane showing detected fixture harnesses and run-locally controls.",
    );
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.locator(".settings-view-shell").waitFor({ state: "detached", timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await openGraphTab(page);
    await waitForText(page, "Ready to merge");
    await page
      .getByTestId("subagent-policy-panel")
      .getByText("Maximum iterations", { exact: true })
      .scrollIntoViewIfNeeded();
    await waitForText(page, "Maximum iterations");
    captures.theme = "dark";
    await writeScreenshot(
      page,
      options.output,
      captures,
      "orchestrator-adversarial-dark.png",
      "Dark Work Graph with dashed Adversarial loop, Repeat up to 2×, Maximum iterations stepper and the passed Ready to merge terminal.",
    );

    await goPage(page, "Bots", "bots-panel");
    await waitForText(page, "fixture-org/atlas-demo");
    await writeScreenshot(
      page,
      options.output,
      captures,
      "bots-expanded-dark.png",
      "Dark Bots page with Lumen expanded, Nova and Sable cards, Release watch automation and fixture-org/atlas-demo monitor.",
    );
    await captureMeetings(page, options.output, captures, false);
    await captureAutomations(page, options.output, captures);
    await captureTasks(page, options.output, captures);

    const manifest = renderManifest(captures);
    await writeFile(path.join(options.output, "MANIFEST.md"), manifest);
    console.log(`Captured ${captures.length} images in ${options.output}`);
    for (const capture of captures) console.log(`${capture.filename} ${capture.bytes} bytes`);
  } catch (error) {
    cleanupError = error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        cleanupError = cleanupError ?? error;
      }
    }
    // The daemon owns the PTY session and must be quiesced before Electron is
    // stopped. Its authenticated identity/exit observer fences cleanup.
    try {
      await daemon.capture();
      await daemon.stop();
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }
    const appExit = await stopAcceptanceProcess(app, { graceMs: 8_000, forceMs: 3_000 });
    if (appExit.verdict !== "exited") {
      cleanupError = cleanupError ?? new Error(`Packaged app cleanup was ${appExit.verdict}`);
    }
    try {
      await rm(fixture, { recursive: true, force: true });
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }
  }
  if (cleanupError) throw cleanupError;
}

function screenshotSeedingStep(filename) {
  if (filename.startsWith("workspace-narrow-")) {
    return "createFixtureWorld() → seedProject() → `worktree create --name docs-preview` → UI New terminal → terminal fixture command → Playwright setViewportSize(760, 1000).";
  }
  if (filename.startsWith("workspace-")) {
    return "createFixtureWorld() → `project add --name Atlas Demo` → `worktree create --name docs-preview --base main` → UI New terminal → terminal fixture command.";
  }
  if (filename.startsWith("orchestrator-off-")) {
    return "seedGraph() → CLI RPC `graph.write_policy` with `adversarial.enabled=false`, three approved fixture runtimes and an OpenCode fallback → UI opens Work Graph.";
  }
  if (filename.startsWith("orchestrator-adversarial-")) {
    return "seedGraph() → UI adversarial toggle → CLI RPC `graph.write_policy` with `adversarial.enabled=true` → `graph.orchestrator_start` → poll `graph.orchestrator_status` until `passed`.";
  }
  if (filename.startsWith("bots-")) {
    return "seedBots() → UI creates Lumen, Nova and Sable → UI adds dormant Release watch responsibility → CLI `bot watch-pr --repo fixture-org/atlas-demo --manual` creates `github_pr.v1` monitor.";
  }
  if (filename.startsWith("meetings-filtered-")) {
    return "createFixtureWorld() writes two Markdown transcripts → UI Meetings search `accessibility` → UI Meeting date `Last 30 days`.";
  }
  if (filename.startsWith("meeting-actions-")) {
    return "createFixtureWorld() writes Atlas planning sync → UI opens transcript → UI invokes `meeting.analyze` via Suggest actions → light capture explicitly clicks Add to my actions (dark reopens the verified analysis).";
  }
  if (filename.startsWith("automations-editor-")) {
    return "seedAutomations() → CLI RPC `automation.create` for two enabled automations with dormant `0 4 29 2 *` cron → UI edits Release readiness digest.";
  }
  if (filename.startsWith("automations-runs-")) {
    return "seedAutomations() → CLI RPC `automation.run_now` for both automations → poll `automation.history` until both runs are `completed` → UI opens Runs.";
  }
  if (filename.startsWith("tasks-")) {
    return "createFixtureWorld() adds origin `fixture-org/atlas-demo` → fake `gh` serves PR #42/#37 JSON → UI Tasks selects PRs mode.";
  }
  if (filename.startsWith("settings-")) {
    return "createFixtureWorld() installs local fake `pi`, `claude`, `codex` and `opencode` binaries → UI selects Settings → Appearance/Agents; theme is selected explicitly for the filename.";
  }
  return "Disposable fixture setup in createFixtureWorld().";
}

function renderManifest(captures) {
  const lines = [
    "# Drogon documentation screenshots",
    "",
    "Generated by `node scripts/doc-screenshots.mjs` against the packaged `origin/main` build.",
    "All content comes from the disposable Atlas Demo fixture; the Electron window is background-only and usage values come from the offline fixture.",
    "",
    "| File | Surface and visible state | Seeding step |",
    "| --- | --- | --- |",
  ];
  for (const capture of captures) {
    lines.push(`| \`${capture.filename}\` | ${capture.note} | ${capture.step ?? screenshotSeedingStep(capture.filename)} |`);
  }
  lines.push(
    "",
    "## Not captured",
    "",
    "The authoring-canvas surface is not present in the packaged build: `WorkGraphPane.tsx` mounts only the daemon-owned `OrchestratorCanvas`; the repository contains the pure designer model/probe but no renderer route or entry point for a node inspector. No placeholder image was fabricated.",
    "",
    "## Reproduce",
    "",
    "```sh",
    "./scripts/build-main.sh && /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/doc-screenshots.mjs",
    "```",
  );
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

export {
  MAX_SCREENSHOT_BYTES,
  NARROW_VIEWPORT,
  DESKTOP_VIEWPORT,
  parseArgs,
  renderManifest,
};
