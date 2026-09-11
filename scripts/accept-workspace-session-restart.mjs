// Focused CDP acceptance for the owner's "an ORDINARY workspace session
// opens blank and never starts" regression (task_c31304f08555).
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE). The plain shell
// is a SHELL FIXTURE on PATH -- never real model inference, never the
// developer's running instance.
//
// The bug: `session.list` returns every durable `sessions` row and `db.rs`
// sweeps `pending|live` -> `unverifiable` on every daemon start. A held,
// running child always reports `live`, so `unverifiable` positively means
// THIS daemon instance holds no child for that id. After a hard daemon
// restart (an app upgrade, a crash) every previously-live session is such a
// stub -- yet selecting its tab rendered a blank pane with a cursor and a
// "live"-looking sidebar row (an emerald check for a concluded turn), and
// the per-tab Retry was the only way to learn the session was gone.
//
// This probe reproduces the exact shape: start a plain terminal, SIGKILL the
// daemon (leaving the durable row `live`), relaunch it over the same data
// dir, and prove that selecting the recovered session never presents a
// blank/live-looking pane:
//   * the sidebar row must NOT carry the live/done affordance, and
//   * the pane must show the honest recovery overlay (Restart / Close), and
//   * Restart must land a usable session that renders fresh shell output.
//
// Usage: node scripts/accept-workspace-session-restart.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");

const fixture = await mkdtemp(path.join(tmpdir(), "dwsr-restart-"));
const dataDir = path.join(fixture, "data");
const projectDir = path.join(fixture, "project");
const fixtureBin = path.join(fixture, "bin");
const shellPidFile = path.join(fixture, "shell.pid");
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `workspace-session-restart-${Date.now()}`,
);
await mkdir(projectDir, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(output, { recursive: true });

// A plain-shell stand-in: prints a banner so the rendered terminal text
// proves the shell booted, records its own pid (the orphan guard -- a
// SIGKILLed daemon closes the PTY master and the child normally takes
// SIGHUP, but teardown verifies it), then sleeps so the session stays live.
const fixtureShell = [
  "#!/bin/bash",
  "echo WORKSPACE-SHELL-READY",
  'echo $$ > "$ACCEPT_SHELL_PID"',
  "trap 'exit 0' TERM INT",
  "exec sleep 3600",
].join("\n");
await writeFile(path.join(fixtureBin, "shell"), `${fixtureShell}\n`, {
  mode: 0o755,
});

const daemonBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond");
const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");

const report = {
  kind: "workspace-session-restart-cdp",
  output,
  checks: [],
  screenshots: [],
  processes: {},
};
let daemon = null;
let desktop = null;
let browser = null;
let page = null;
const ownedPids = new Set();

function ownPid(pid) {
  if (pid) ownedPids.add(pid);
}

async function allProcesses() {
  const { stdout } = await runAcceptanceProcess("ps", ["-Ao", "pid=,ppid="], { timeout: 5000 });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))
    .map(([pid, ppid]) => ({ pid, ppid }));
}

async function descendants(roots) {
  const all = await allProcesses();
  const found = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of all) {
      if (found.has(item.ppid) && !found.has(item.pid)) {
        found.add(item.pid);
        grew = true;
      }
    }
  }
  return [...found];
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOwned(child, label) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  report.processes[label] = result.verdict;
  if (result.verdict !== "exited") {
    throw new Error(`${label} did not exit cleanly: ${JSON.stringify(result)}`);
  }
}

async function waitForDaemon() {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 1000 });
      assert.equal(JSON.parse(response.stdout).ok, true);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function startDaemon() {
  const child = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: path.join(fixtureBin, "shell"),
      ACCEPT_SHELL_PID: shellPidFile,
    },
  });
  ownPid(child.pid);
  await waitForDaemon();
  return child;
}

async function launchDesktop() {
  const child = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: path.join(fixtureBin, "shell"),
      ACCEPT_SHELL_PID: shellPidFile,
    },
  });
  ownPid(child.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 20000);
    child.once("exit", () => reject(new Error(`electron exited before connecting: ${tail}`)));
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  assert.ok(page, "electron must create a rendered page");
  page.setDefaultTimeout(20000);
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  return child;
}

async function shot(name) {
  await page.screenshot({ path: path.join(output, name), animations: "disabled" });
  report.screenshots.push(name);
}

async function sessions(workspaceId) {
  return page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
}

async function waitForSession(workspaceId, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      last = await sessions(workspaceId);
      const found = last.find(predicate);
      if (found) return found;
    } catch {
      // Reconnect polls are expected to fail while the old daemon is down.
    }
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
    await delay(100);
  }
}

async function waitForStatusNot(previousServiceInstanceId) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 1000 });
      const envelope = JSON.parse(response.stdout);
      if (envelope.ok && envelope.result.serviceInstanceId !== previousServiceInstanceId)
        return envelope.result;
    } catch {
      // Not up yet.
    }
    if (Date.now() >= deadline) throw new Error("replacement daemon never became healthy");
    await delay(100);
  }
}

async function cliStatus() {
  const response = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 2000 });
  return JSON.parse(response.stdout).result;
}

async function createWorkspaceWithTerminal() {
  await page.getByRole("button", { name: "Workspace options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(projectDir);
  await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
  await page.getByRole("button", { name: "Select project", exact: true }).waitFor();
  const workspace = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0];
  });
  assert.ok(workspace?.id, "the folder project must register an implicit workspace");
  await page.getByRole("button", { name: "New tab", exact: true }).last().click();
  await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
  await page.locator("#active-session-panel .xterm-helper-textarea").waitFor();
  await waitForTerminalText(page, "WORKSPACE-SHELL-READY");
  const live = await waitForSession(workspace.id, (item) => item.verdict === "live", "a live plain-shell session");
  return { workspace, session: live };
}

try {
  daemon = await startDaemon();
  desktop = await launchDesktop();
  const { workspace, session } = await createWorkspaceWithTerminal();
  report.firstSession = session.id;
  report.checks.push("plain-workspace-terminal-boots-live");

  const before = await cliStatus();

  // ---- the exact owner trigger: a hard daemon restart over the data dir ----
  // SIGKILL leaves the durable row `live` (no graceful stop), so the next
  // daemon start sweeps it to `unverifiable` -- "this daemon holds no child".
  daemon.kill("SIGKILL");
  const killed = await stopAcceptanceProcess(daemon).catch(() => ({ verdict: "exited" }));
  daemon = null;
  assert.equal(killed.verdict, "exited", "the SIGKILLed daemon must be observed gone");
  daemon = await startDaemon();
  await waitForStatusNot(before.serviceInstanceId);

  const stub = await waitForSession(
    workspace.id,
    (item) => item.id === session.id && item.verdict === "unverifiable",
    "the recovered unverifiable stub",
  );
  report.recoveredVerdict = stub.verdict;
  report.checks.push("daemon-restart-sweeps-live-row-to-unverifiable");

  // Let the renderer settle on the recovered verdict before reading the
  // sidebar/tab chrome: the tab's accessible name carries the verdict, and
  // the pane's local transport projection can briefly keep the stale agent
  // state. Waiting here keeps the assertion about the RENDERED state, not a
  // race against the first post-restart list.
  await page.waitForFunction(
    (id) => {
      const tab = document.querySelector(`[data-tab-id="${CSS.escape(id)}"]`);
      return (tab?.getAttribute("aria-label") ?? "").includes("unverifiable");
    },
    session.id,
    { timeout: 20000 },
  );

  // The sidebar row for that session must not claim a live/done agent.
  const row = page.locator(`[data-worktree-agent-row="${session.id}"]`).first();
  await row.waitFor();
  const rowIconGreen = await row.evaluate((el) =>
    el.querySelector(".text-emerald-500") !== null,
  );
  const rowSpinner = await row.evaluate((el) =>
    el.querySelector("[data-agent-spinner]") !== null,
  );
  report.sidebarRow = {
    green: rowIconGreen,
    spinner: rowSpinner,
    ariaLabel: await row.getAttribute("aria-label"),
  };
  assert.equal(rowIconGreen, false, "an unverifiable session must not show the live/done green check");
  assert.equal(rowSpinner, false, "an unverifiable session must not show the working spinner");

  // ---- selecting the recovered session must be honest, never a blank pane ----
  await row.click();
  const panel = page.locator("#active-session-panel");
  await panel.waitFor();
  // Judge "usable" from the daemon's own verdict, never from terminal text:
  // a dead pane keeps its whole scrollback (including the boot banner), so
  // DOM text alone would let a blank-but-populated pane pass. The honest
  // states are the recovery overlay, or a genuinely live session.
  const alert = panel
    .getByRole("alert")
    .filter({ hasText: "Could not reconnect to terminal" });
  const liveSession = () =>
    sessions(workspace.id).then(
      (listed) => listed.find((item) => item.verdict === "live") ?? null,
      () => null,
    );
  const deadline = Date.now() + 15000;
  let overlayVisible = false;
  let live = null;
  for (;;) {
    overlayVisible = await alert.isVisible().catch(() => false);
    live = overlayVisible ? null : await liveSession();
    if (overlayVisible || live) break;
    if (Date.now() >= deadline) break;
    await delay(150);
  }
  report.afterSelect = { overlayVisible, liveSession: live?.id ?? null };
  await shot("recovered-session-selected.png");
  assert.ok(
    overlayVisible || live,
    "selecting a recovered unverifiable session must show the honest recovery overlay or a genuinely live session, never a blank pane",
  );
  report.checks.push("recovered-session-never-blank");

  if (overlayVisible) {
    // The overlay's own Restart must land a usable session that renders fresh
    // shell output (the "offers to start a new one" half of the contract).
    await alert.getByRole("button", { name: "Restart", exact: true }).click();
    const replacement = await waitForSession(
      workspace.id,
      (item) => item.verdict === "live" && item.id !== session.id,
      "the restarted live session",
    );
    assert.notEqual(replacement.id, session.id, "Restart must replace the dead stub, not revive it");
    await waitForTerminalText(page, "WORKSPACE-SHELL-READY");
    report.restartedSession = replacement.id;
    report.checks.push("restart-offers-a-usable-session");
    await page.evaluate(async (item) => {
      await window.drogon.stop({ sessionId: item.id, incarnation: item.incarnation });
    }, replacement);
  } else {
    await page.evaluate(async (item) => {
      await window.drogon.stop({ sessionId: item.id, incarnation: item.incarnation });
    }, live);
  }

  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close().catch(() => {});
    const tracked = [...ownedPids].filter((pid) => alive(pid));
    const victims = tracked.length > 0 ? await descendants(tracked) : [];
    // The SIGKILLed daemon normally orphans its PTY child; capture it before
    // the parent dies so teardown can verify it is gone.
    try {
      const pidText = await readFile(shellPidFile, "utf8");
      const orphan = Number.parseInt(pidText.trim(), 10);
      if (Number.isInteger(orphan) && orphan > 0) {
        victims.push(orphan);
        const gone = Date.now() + 5000;
        while (alive(orphan) && Date.now() < gone) {
          try {
            process.kill(orphan, "TERM");
          } catch {
            // already gone
          }
          await delay(100);
        }
        if (alive(orphan)) {
          try {
            process.kill(orphan, "KILL");
          } catch {
            // already gone
          }
        }
      }
    } catch {
      // No shell pid recorded: nothing to reclaim beyond the tracked tree.
    }
    await stopOwned(desktop, "desktop");
    await stopOwned(daemon, "daemon");
    await delay(500);
    const survivors = [...new Set(victims)].filter((pid) => alive(pid));
    report.processes.survivors = survivors;
    if (survivors.length > 0) {
      process.exitCode = 1;
      await writeFile(
        path.join(output, "survivors.json"),
        `${JSON.stringify({ victims, survivors }, null, 2)}\n`,
      );
    }
    await rm(fixture, { recursive: true, force: true });
  } catch (cleanupError) {
    process.exitCode = 1;
    report.cleanupError =
      cleanupError instanceof Error ? (cleanupError.stack ?? cleanupError.message) : String(cleanupError);
  }
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
