// MIT Copyright (c) 2026 Lovecast Inc.
// CDP oracle for the Settings "Agent skills" panels (goal: skill import UI
// parity with the Orca reference). Launches the real desktop in an isolated
// background fixture (temporary DROGON_DATA_DIR and DROGON_ELECTRON_PROFILE,
// DROGON_BACKGROUND_WINDOW=1, loopback-only random debugging port), drives
// the rendered Settings page over Playwright/CDP, captures screenshots, and
// tears down every process it owns.
//
// Modes: --help | --check (read-only) | (default) execute.
import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startAcceptanceProcess } from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";

const STAGE_TIMEOUT_MS = 120_000;

function repositoryRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

export function acceptanceLayout(root = repositoryRoot()) {
  const appDir = path.join(root, "apps", "desktop");
  return {
    root,
    appDir,
    builtMain: path.join(appDir, "out", "main", "index.js"),
    builtPreload: path.join(appDir, "out", "preload", "index.js"),
    builtRendererIndex: path.join(appDir, "out", "renderer", "index.html"),
    evidenceDir: path.join(root, "tests", "parity", "ports", "WP-UI-SETTINGS", "skills-panels"),
    fixtureParent: path.join(root, ".preflight", "acceptance"),
  };
}

function isMainModule() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

async function resolvePlaywright() {
  const appRequire = createRequire(path.join(repositoryRoot(), "apps", "desktop", "package.json"));
  return appRequire("playwright");
}

async function withStageTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`stage exceeded ${STAGE_TIMEOUT_MS}ms: ${label}`)), STAGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopOwned(child, label, report) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    report.cleanup.push(`${label}: ${child?.pid ? "exited" : "never-started"}`);
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (!(await Promise.race([exited.then(() => true), delay(5000).then(() => false)]))) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
    report.cleanup.push(`${label}: required force after timeout`);
  }
  report.cleanup.push(
    `${label}: ${child.exitCode !== null || child.signalCode !== null ? "exited" : "unverifiable"}`,
  );
  if (child.exitCode !== 0 && child.signalCode !== "SIGTERM") report.status = "FAILED";
}

export function buildPlan() {
  const layout = acceptanceLayout();
  return {
    runner: "scripts/probe-skills-ui.mjs",
    modes: {
      help: "this plan; read-only and spawn-free",
      check: "validate built entries; read-only and spawn-free",
      execute: "launch the real desktop with CDP and verify the rendered skills panels",
    },
    builtEntries: { main: layout.builtMain, preload: layout.builtPreload },
    evidence: { directory: layout.evidenceDir, files: ["report.json", "agent-skills.png"] },
    isolation: {
      dataDir: "mkdtemp under .preflight/acceptance (temporary DROGON_DATA_DIR)",
      electronProfile: "mkdtemp under .preflight/acceptance (temporary DROGON_ELECTRON_PROFILE)",
      backgroundWindow: "DROGON_BACKGROUND_WINDOW=1; the window is never focused or raised",
      debuggingPort: "--remote-debugging-port=0 (loopback, random port)",
    },
  };
}

async function runCheck(layout = acceptanceLayout()) {
  const { stat } = await import("node:fs/promises");
  const problems = [];
  for (const [label, file] of [
    ["built main entry", layout.builtMain],
    ["built preload entry", layout.builtPreload],
    ["built renderer entry", layout.builtRendererIndex],
  ]) {
    try {
      await stat(file);
    } catch {
      problems.push(`${label} is missing: ${file} (build the desktop first)`);
    }
  }
  return { mode: "check", ok: problems.length === 0, problems };
}

function topicTitle(name) {
  return name === "orchestration" ? "Orchestration skill" : "CLI skill";
}

async function execute(layout = acceptanceLayout()) {
  const report = {
    runner: "scripts/probe-skills-ui.mjs",
    status: "FAILED",
    startedAt: new Date().toISOString(),
    checks: [],
    cleanup: [],
    desktopPids: [],
  };
  const playwright = await resolvePlaywright();
  const electronBinary = createRequire(path.join(layout.appDir, "package.json"))("electron");
  const fixture = await mkdtemp(path.join(layout.fixtureParent, "skills-ui-"));
  const dataDir = path.join(fixture, "data");
  const profileDir = path.join(fixture, "electron");
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  // Install the freshly built CLI as the J3 shim (`<data-dir>/bin/drogon-cli`),
  // exactly the layout the settings-bridge resolution expects, so the skills
  // catalog probe runs the real binary built from this tree.
  const { execFileSync } = await import("node:child_process");
  execFileSync("cargo", ["build", "-p", "drogon-cli"], { cwd: layout.root, stdio: "pipe" });
  const binDir = path.join(dataDir, "bin");
  await mkdir(binDir, { recursive: true });
  const cliBinary = path.join(binDir, process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
  await copyFile(path.join(layout.root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli"), cliBinary);
  if (process.platform !== "win32") await chmod(cliBinary, 0o755);
  let desktop = null;
  let browser = null;
  try {
    desktop = startAcceptanceProcess(
      electronBinary,
      [layout.appDir, "--remote-debugging-port=0"],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          DROGON_DATA_DIR: dataDir,
          DROGON_ELECTRON_PROFILE: profileDir,
          DROGON_BACKGROUND_WINDOW: "1",
          ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
        },
      },
    );
    if (desktop.pid) report.desktopPids.push(desktop.pid);
    const endpoint = await withStageTimeout(
      new Promise((resolve, reject) => {
        let tail = "";
        const timeout = setTimeout(
          () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
          30000,
        );
        desktop.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        desktop.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error(`Electron exited before connection: ${tail}`));
        });
        desktop.stderr.on("data", (bytes) => {
          tail = (tail + bytes.toString()).slice(-8192);
          const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        });
      }),
      "electron launch",
    );
    browser = await playwright.chromium.connectOverCDP(endpoint);
    let page = null;
    for (let i = 0; i < 200 && !page; i += 1) {
      page = browser.contexts()[0]?.pages()[0] ?? null;
      if (!page) await delay(50);
    }
    assert.ok(page, "Electron must create a rendered page");
    page.setDefaultTimeout(20000);
    await emulatePageFocus(page);
    // Readiness: the workspace toolbar renders once the app shell is up.
    await page
      .getByRole("button", { name: "Reveal active workspace", exact: true })
      .waitFor();

    // Open Settings (Meta+, on darwin) and land on the General section that
    // hosts the CLI card and the Agent skills panels.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await page.getByText("Agent skills", { exact: true }).waitFor();
    report.checks.push("settings page opens and shows the Agent skills block");

    // The oracle reads the same real overview the panels consume, then
    // asserts each panel shows the command matching its live installed state.
    const overview = await page.evaluate(() => window.drogon.skills.overview());
    assert.equal(overview.ok, true, "skills overview must answer ok");
    const topics = overview.result?.topics ?? [];
    assert.equal(topics.length, 2, "both bundled skills must be listed");
    for (const topic of topics) {
      const expected = topic.installed ? topic.updateCommand : topic.installCommand;
      const pill = topic.installed ? "Installed" : "Not installed";
      try {
        await page.getByText(expected, { exact: true }).waitFor();
        await page
          .getByRole("heading", { name: topicTitle(topic.name), exact: true })
          .waitFor();
        assert.ok(
          await page.getByText(pill, { exact: true }).first().isVisible(),
        );
      } catch (error) {
        const debug = path.join(layout.evidenceDir, "debug.html");
        await mkdir(layout.evidenceDir, { recursive: true });
        await writeFile(debug, await page.content());
        throw error;
      }
      report.checks.push(
        `${topic.name}: ${pill.toLowerCase()}, shows \`${expected}\``,
      );
    }

    await mkdir(layout.evidenceDir, { recursive: true });
    const screenshot = path.join(layout.evidenceDir, "agent-skills.png");
    await page.screenshot({ path: screenshot });
    report.checks.push(`screenshot captured: ${screenshot}`);
    report.status = "PASSED";
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      report.cleanup.push("cdp: browser disconnected");
    }
    await stopOwned(desktop, "electron", report);
  }
  await writeFile(path.join(layout.evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const layout = acceptanceLayout();
  if (process.argv.includes("--help")) {
    console.log(JSON.stringify(buildPlan(), null, 2));
    return;
  }
  if (process.argv.includes("--check")) {
    const result = await runCheck(layout);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  await mkdir(layout.fixtureParent, { recursive: true });
  await mkdir(layout.evidenceDir, { recursive: true });
  const report = await execute(layout);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASSED") process.exitCode = 1;
}

if (isMainModule()) {
  await main();
}
