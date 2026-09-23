// MIT Copyright (c) 2026 Lovecast Inc.
// Packaged acceptance for "installing never interrupts running sessions".
//
// Reproduces a real install over a running terminal, end to end, against a
// packaged Drogon.app in a BACKGROUND window with its own data directory,
// Electron profile and HOME (never the developer's running instance):
//
//   1. the packaged app starts its bundled daemon; a terminal is opened in
//      the UI and prints its shell pid;
//   2. the app quits (the detached daemon keeps the terminal), and the
//      terminal is moved into an "old build" — a re-signed copy of the
//      bundled drogond with a different digest — through the same handoff
//      under test, so the old build is what an install finds running;
//   3. the app is launched again: it sees a service from another build with
//      a live session, has it hand the PTY to the bundled build, and says
//      "Drogon updated".
//
// Passing means the same shell process kept running in the same tab, its
// scrollback came along, typed input reaches it through the new service,
// and the old service exited on its own. Every process the run starts is
// tracked and proved gone before the fixture is deleted.
//
// Usage: node scripts/accept-session-handoff.mjs --bundle <Drogon.app>
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import {
  terminalBufferText,
  waitForTerminalText,
} from "./acceptance-terminal-text.mjs";
import { bundlePaths } from "./desktop-artifacts.mjs";

/** The shell line a terminal is asked to run: prints `<label>_<nonce>_<pid>`. */
export function markerCommand(label, nonce) {
  return `printf '${label}_%s_%s\\n' ${nonce} $$`;
}

/** The shell pid a {@link markerCommand} printed, read back from `text`. */
export function markedShellPid(text, label, nonce) {
  const match = new RegExp(`${label}_${nonce}_(\\d+)`).exec(text);
  return match ? Number(match[1]) : null;
}

export function parseArgs(argv) {
  const index = argv.indexOf("--bundle");
  assert.ok(index >= 0 && argv[index + 1], "usage: accept-session-handoff.mjs --bundle <Drogon.app>");
  return { bundle: path.resolve(argv[index + 1]) };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitGone(pid, ms) {
  const deadline = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
  return true;
}

async function run({ bundle }) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const packaged = bundlePaths(bundle);
  // A short fixture path: the data dir holds unix sockets (~104-byte cap).
  const fixture = await mkdtemp(path.join(tmpdir(), "dsh-"));
  const dataDir = path.join(fixture, "data");
  const projectDir = path.join(fixture, "project");
  const home = path.join(fixture, "home");
  const oldBuild = path.join(fixture, "old-build");
  const output = path.join(root, ".preflight", "acceptance", `session-handoff-${Date.now()}`);
  for (const dir of [projectDir, home, oldBuild, output]) await mkdir(dir, { recursive: true });

  const report = { kind: "session-handoff-packaged", bundle, output, checks: [], processes: {} };
  const owned = new Map(); // pid -> label
  const env = {
    ...process.env,
    HOME: home,
    SHELL: "/bin/sh",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    DROGON_DATA_DIR: dataDir,
    DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
    DROGON_BACKGROUND_WINDOW: "1",
    DROGON_USAGE_FORCE_UNAVAILABLE: "claude,codex",
  };
  delete env.DROGON_MENTU_RUNTIME;
  let desktop = null;
  let browser = null;
  let page = null;

  const cli = async (method, params = {}) => {
    const { stdout } = await runAcceptanceProcess(
      packaged.cli,
      ["--data-dir", dataDir, "--json", "rpc", method, "--params", JSON.stringify(params)],
      { timeout: 15000, env },
    );
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.ok, true, `${method}: ${JSON.stringify(envelope)}`);
    return envelope.result;
  };
  const status = async (predicate = () => true, ms = 30000, label = "a service") => {
    const deadline = Date.now() + ms;
    let last = "no reply";
    for (;;) {
      try {
        const answer = await cli("status");
        if (predicate(answer)) return answer;
        last = JSON.stringify({ pid: answer.processId, digest: answer.daemonArtifactSha256 });
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}: ${last}`);
      await delay(150);
    }
  };
  const launchDesktop = async () => {
    const child = startAcceptanceProcess(packaged.executable, ["--remote-debugging-port=0"], {
      stdio: ["ignore", "ignore", "pipe"],
      env,
    });
    owned.set(child.pid, "desktop");
    const appLog = path.join(output, `desktop-${child.pid}.log`);
    child.stderr.on("data", (bytes) => {
      appendFile(appLog, bytes).catch(() => {});
    });
    const endpoint = await new Promise((resolve, reject) => {
      let tail = "";
      const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 30000);
      child.once("exit", () => reject(new Error(`the app exited before connecting: ${tail}`)));
      child.stderr.on("data", (bytes) => {
        tail = (tail + bytes.toString()).slice(-8192);
        const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(endpoint);
    for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
    page = browser.contexts()[0].pages()[0];
    assert.ok(page, "the app must render a page");
    await emulatePageFocus(page);
    page.setDefaultTimeout(30000);
    desktop = child;
    return page;
  };
  const quitDesktop = async (label) => {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    if (!desktop) return;
    const result = await stopAcceptanceProcess(desktop);
    report.processes[label] = result.verdict;
    assert.equal(result.verdict, "exited", `${label} must exit`);
    desktop = null;
  };

  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  let session = null;
  let shellPid = null;
  try {
    // ---------------------------------------------------- 1. a live terminal
    await launchDesktop();
    const bundledDigest = sha256(await readFile(packaged.daemon));
    const first = await status((s) => s.daemonArtifactSha256 === bundledDigest, 30000, "the bundled daemon");
    owned.set(first.processId, "bundled daemon (first)");

    await page.getByRole("button", { name: "Workspace options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
    const addDialog = page.getByRole("dialog", { name: "Add Project" });
    await addDialog.getByLabel("Folder or repository path").fill(projectDir);
    await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
    await page.getByRole("button", { name: "New tab", exact: true }).last().click();
    await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
    const textarea = page.locator("#active-session-panel .xterm-helper-textarea");
    await textarea.waitFor();
    await textarea.focus();
    await page.keyboard.type(markerCommand("HANDOFF_BEFORE", nonce));
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, `HANDOFF_BEFORE_${nonce}_`);
    shellPid = markedShellPid(await terminalBufferText(page), "HANDOFF_BEFORE", nonce);
    assert.ok(shellPid && alive(shellPid), "the terminal's shell must be running");
    owned.set(shellPid, "terminal shell");
    session = (await cli("session.list")).sessions.find((item) => item.verdict === "live");
    assert.ok(session, "the UI terminal must be a live session");
    report.session = { id: session.id, incarnation: session.incarnation, shellPid };
    report.checks.push("packaged-ui-terminal-is-live");

    // ------------------------ 2. the terminal now runs in an "old build"
    await quitDesktop("desktop (first)");
    const oldDaemon = path.join(oldBuild, "drogond");
    await copyFile(packaged.daemon, oldDaemon);
    await copyFile(packaged.cli, path.join(oldBuild, "drogon-cli"));
    await runAcceptanceProcess("codesign", ["--remove-signature", oldDaemon], { timeout: 60000 });
    await runAcceptanceProcess("codesign", ["--sign", "-", oldDaemon], { timeout: 60000 });
    const oldDigest = sha256(await readFile(oldDaemon));
    assert.notEqual(oldDigest, bundledDigest, "the old build must have a different digest");
    const offered = await cli("runtime.handoff", {
      hostId: first.hostId,
      serviceInstanceId: first.serviceInstanceId,
    });
    assert.equal(offered.accepted, true);
    const old = startAcceptanceProcess(oldDaemon, ["--data-dir", dataDir, "--adopt-handoff"], {
      detached: true,
      stdio: "ignore",
      env,
    });
    old.unref();
    owned.set(old.pid, "old-build daemon");
    const oldStatus = await status((s) => s.processId === old.pid, 30000, "the old build to take over");
    assert.equal(oldStatus.daemonArtifactSha256, oldDigest);
    assert.ok(await waitGone(first.processId, 30000), "the first daemon must exit after handing over");
    const inOld = (await cli("session.list")).sessions.find((item) => item.id === session.id);
    assert.equal(inOld?.verdict, "live", "the terminal must be running in the old build");
    assert.ok(alive(shellPid), "the shell must survive the first handoff");
    report.checks.push("terminal-moves-into-the-old-build-without-stopping");

    // ------------------ 3. relaunch: the install finds the old build running
    await launchDesktop();
    await page.getByText("Drogon updated", { exact: true }).waitFor({ timeout: 90000 });
    const updated = await status(
      (s) => s.daemonArtifactSha256 === bundledDigest,
      60000,
      "the bundled build to serve after the install",
    );
    owned.set(updated.processId, "bundled daemon (after install)");
    assert.notEqual(updated.serviceInstanceId, oldStatus.serviceInstanceId);
    assert.ok(await waitGone(old.pid, 30000), "the old build must exit on its own");
    report.checks.push("install-replaces-the-old-build-and-says-drogon-updated");

    const survived = (await cli("session.list")).sessions.find((item) => item.id === session.id);
    assert.equal(survived?.verdict, "live", "the terminal must still be running");
    assert.equal(survived.incarnation, session.incarnation, "it must be the same session incarnation");
    assert.ok(alive(shellPid), "the same shell process must still be running");
    report.checks.push("install-keeps-the-session-and-its-shell-process");

    // Open the session from its sidebar row, the way a user returns to it.
    await page.locator(`[data-worktree-agent-row="${session.id}"]`).first().click();
    await waitForTerminalText(page, `HANDOFF_BEFORE_${nonce}_${shellPid}`);
    report.checks.push("install-keeps-the-terminal-scrollback-in-its-tab");
    const input = page.locator("#active-session-panel .xterm-helper-textarea");
    await input.focus();
    await page.keyboard.type(markerCommand("HANDOFF_AFTER", nonce));
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, `HANDOFF_AFTER_${nonce}_${shellPid}`);
    await page.screenshot({ path: path.join(output, "terminal-after-install.png"), animations: "disabled" });
    report.checks.push("typed-input-reaches-the-same-shell-through-the-new-service");

    const log = await readFile(path.join(dataDir, "logs", "drogond.log"), "utf8");
    report.handoffLog = log.split("\n").filter((line) => line.includes("handoff:"));
    assert.equal(report.handoffLog.filter((line) => line.includes("successor is serving; exiting")).length, 2);
    report.status = "PASSED";
  } catch (error) {
    report.status = "FAILED";
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    // Stop what this run owns: the session, the app, then the daemon
    // through its own quiescent shutdown; signal only what is still ours.
    try {
      if (session) {
        const row = (await cli("session.list")).sessions.find((item) => item.id === session.id);
        if (row?.verdict === "live")
          await cli("session.stop", { sessionId: row.id, incarnation: row.incarnation });
      }
    } catch (error) {
      report.cleanupError = String(error);
    }
    await quitDesktop("desktop (last)").catch((error) => {
      report.cleanupError = String(error);
    });
    try {
      const current = await cli("status");
      owned.set(current.processId, owned.get(current.processId) ?? "daemon");
      await cli("runtime.shutdown", {
        hostId: current.hostId,
        serviceInstanceId: current.serviceInstanceId,
      });
    } catch {
      // No daemon answering: nothing to shut down gracefully.
    }
    for (const [pid, label] of owned) {
      if (!(await waitGone(pid, 10000))) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
      report.processes[`${label} (${pid})`] = (await waitGone(pid, 5000)) ? "exited" : "unverifiable";
    }
    await copyFile(path.join(dataDir, "logs", "drogond.log"), path.join(output, "drogond.log")).catch(() => {});
    const survivors = Object.entries(report.processes).filter(([, verdict]) => verdict !== "exited");
    if (survivors.length === 0) await rm(fixture, { recursive: true, force: true });
    else {
      report.status = "FAILED";
      report.survivors = survivors;
      process.exitCode = 1;
    }
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, checks: report.checks, report: path.join(output, "report.json"), error: report.error }));
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === entry) await run(parseArgs(process.argv.slice(2)));
