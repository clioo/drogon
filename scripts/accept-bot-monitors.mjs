// A Bot creates its OWN monitor and its OWN automation, and both really act —
// end to end on the real desktop over CDP, in a background window with a
// private data dir and Electron profile.
//
// The owner asks the Bot, in the Bot's own session, to run a `drogon-cli bot`
// command; the Bot runs it, so the audit actor is the Bot, not the user. Then
// this script changes the file the monitor watches and waits for the real
// daemon pipeline — the scheduler's monitor tick, the monitor event, and the
// delegation drain that dispatches the bound responsibility — to do the thing
// the Bot was asked to arrange. The same for a scheduled automation.
//
// Every agent inside this test (the Bot's session, its dispatched
// responsibility, its automation run) is the free local model
// `pi (dgx-spark) qwen3.8-flash-next-nvidia-nvfp4`, so the suite costs nothing.
//
// Run: node scripts/accept-bot-monitors.mjs
// Env: BOT_MONITORS_MODEL overrides the model; BOT_MONITORS_OUT the report dir.
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { runAcceptanceProcess as exec, startAcceptanceProcess as start, stopAcceptanceProcess as stop } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { startForegroundObservation, verifyForegroundObservation } from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const cli = path.join(root, "target/debug/drogon-cli");
const daemonBinary = path.join(root, "target/debug/drogond");
// The free local model: these agents must cost nothing to run.
const MODEL = process.env.BOT_MONITORS_MODEL ?? "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4";
// A monitor and an automation both ride the daemon's 15 s scheduler tick, but
// each is gated by its own one-minute cron, so a fire needs minutes, not
// seconds; the dispatched agent then has to run.
const REACTION_TIMEOUT_MS = 8 * 60 * 1000;
// Short prefix on purpose: the daemon socket lives here and macOS caps unix
// socket paths at 104 bytes.
const fixture = await mkdtemp(path.join(tmpdir(), "bm-"));
const dataDir = path.join(fixture, "data");
const project = path.join(fixture, "project");
const output = process.env.BOT_MONITORS_OUT ?? path.join(root, ".preflight/acceptance", `bot-monitors-${Date.now()}`);
const report = { status: "FAILED", model: MODEL, fixture, output, checks: [], screenshots: [], processes: [] };
let desktop, daemon, browser, observer, daemonOwner, page, botId, workspaceId, homePath, botSession;
const owned = new Map();

async function processRows() {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="]);
  return stdout.trim().split("\n").map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
    return m && { pid: Number(m[1]), parent: Number(m[2]), identity: `${m[3]} ${m[4]}` };
  }).filter(Boolean);
}
async function captureChildren() {
  const rows = await processRows();
  const parents = new Set([desktop?.pid, daemon?.pid, ...owned.keys()].filter(Boolean));
  let added;
  do {
    added = false;
    for (const row of rows) if (parents.has(row.parent) && !parents.has(row.pid)) {
      parents.add(row.pid); owned.set(row.pid, row.identity); added = true;
    }
  } while (added);
}
async function cliJson(args, options = {}) {
  let stdout = "", stderr = "";
  try { ({ stdout, stderr } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], { timeout: 60000, ...options })); }
  catch (error) { stdout = error.stdout ?? ""; stderr = error.stderr ?? ""; }
  let value;
  try { value = JSON.parse(stdout); }
  catch { throw new Error(`drogon-cli ${args.join(" ")}: ${(stdout + stderr).slice(0, 600)}`); }
  assert.equal(value.ok, true, `drogon-cli ${args.slice(0, 2).join(" ")}: ${JSON.stringify(value.error)}`);
  return value.result;
}
const rpc = (method, params) => cliJson(["--request-id", crypto.randomUUID(), "rpc", method, "--params", JSON.stringify(params)]);
async function until(check, label, timeout = 60000, every = 500) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await delay(every);
  }
  throw new Error(`Timed out: ${label}${last === undefined ? "" : ` (last=${JSON.stringify(last).slice(0, 300)})`}`);
}
const exists = (file) => access(file).then(() => true, () => false);
async function shot(name) {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}
const botScope = () => ["--bot", botId, "--workspace", workspaceId];
const botState = () => cliJson(["bot", "list", ...botScope()]);
/** The Bot's own session, as the daemon reports it. */
async function sessionForBot() {
  const listed = await cliJson(["terminal", "list"]);
  return listed.sessions.find((s) => s.id === botSession?.id) ?? null;
}
/** Asks the Bot, in its own session, to run one command — once its harness
 *  reports it is idle, so the turn is not written into a busy TUI. The
 *  command itself lives in a one-line script the owner leaves in the Bot's
 *  folder, so what the model must reproduce is a filename, not a long
 *  quoted command; running it is still the Bot's own act, under its own
 *  scope, and the daemon records the Bot as the actor. */
async function askBot(text) {
  await until(async () => {
    const session = await sessionForBot();
    return session && session.verdict === "live" && session.agentState !== "busy" ? session : null;
  }, "the Bot's session is idle enough to receive a turn", 3 * 60 * 1000, 2000);
  return page.evaluate(async ({ sessionId, incarnation, payload }) => {
    const response = await window.drogon.write({ sessionId, incarnation, text: payload });
    if (!response.ok) throw new Error(response.error.message);
    return response.result.acceptedBytes;
  }, { sessionId: botSession.id, incarnation: botSession.incarnation, payload: `${text}\r` });
}
/** Everything the Bot's own terminal is showing right now. */
async function botSessionText() {
  return page.evaluate(() => {
    const registry = window.__drogonTerminals;
    if (!registry || registry.size === 0)
      return document.querySelector(".xterm-screen")?.textContent ?? "";
    const lines = [];
    for (const terminal of registry.values()) {
      const buffer = terminal.buffer.active;
      for (let row = 0; row < buffer.length; row += 1)
        lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  });
}
/** Leaves one command in the Bot's folder and asks the Bot to run it. */
async function askBotToRun(name, command) {
  await writeFile(path.join(homePath, name), `#!/bin/sh\nset -e\n${command}\n`);
  await askBot(`Run this and tell me exactly what it printed: sh ${name}`);
}
async function goToBotsPage() {
  await page.locator(".shell-sidebar").getByRole("button", { name: "Bots", exact: true }).first().click();
  await page.getByTestId("bots-panel").waitFor();
}
/** The Bot's card is collapsed by default; its session, monitors and
 *  automations live behind the expander. */
async function expandBotCard() {
  await goToBotsPage();
  await page.getByTestId(`bot-${botId}`).waitFor({ timeout: 20000 });
  if (!(await page.getByTestId(`open-session-${botId}`).count())) {
    await page.getByTestId(`bot-expand-${botId}`).click();
  }
  await page.getByTestId(`open-session-${botId}`).waitFor({ timeout: 20000 });
}

try {
  await mkdir(output, { recursive: true });
  await mkdir(project, { recursive: true });
  const nodeBin = path.dirname(process.execPath);
  // Real HOME: `pi` reads the owner's local-model configuration. The app's own
  // state stays in the private data dir and Electron profile.
  const env = { ...process.env, PATH: `/opt/homebrew/bin:${nodeBin}:${process.env.PATH}` };
  for (const key of ["DROGON_WORKSPACE_ID", "DROGON_SESSION_ID", "DROGON_DATA_DIR", "DROGON_TERMINAL"]) delete env[key];
  const git = (args) => exec("git", ["-c", "user.name=Drogon Bots", "-c", "user.email=bots@example.invalid", ...args], { env });
  await git(["init", "-q", "-b", "main", project]);
  await writeFile(path.join(project, "README.md"), "# bot monitor acceptance\n");
  await git(["-C", project, "add", "-A"]);
  await git(["-C", project, "commit", "-q", "-m", "init"]);

  if (process.platform === "darwin") observer = await startForegroundObservation(output);
  daemon = start(daemonBinary, ["--data-dir", dataDir], { env, stdio: ["ignore", "pipe", "pipe"] });
  let daemonLog = "";
  for (const stream of [daemon.stdout, daemon.stderr]) stream.on("data", (chunk) => { daemonLog = (daemonLog + chunk).slice(-40000); });
  await until(async () => { try { return await cliJson(["status"]); } catch { return false; } }, "daemon readiness", 30000);
  daemonOwner = packagedFixtureDaemon(daemonBinary, cli, dataDir);
  await daemonOwner.capture();
  report.daemonIdentity = daemonOwner.identity();
  const status = await cliJson(["status"]);
  const workspace = await cliJson(["workspace", "add", project, "--name", "bot-project"]);
  workspaceId = workspace.id;

  desktop = start(electron, [appDir, "--remote-debugging-port=0"], { env: { ...env, DROGON_DATA_DIR: dataDir, DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"), DROGON_BACKGROUND_WINDOW: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  report.desktopPid = desktop.pid;
  let stderrText = "";
  desktop.stderr.on("data", (chunk) => { stderrText = (stderrText + chunk).slice(-16000); });
  const endpoint = await until(() => stderrText.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1], "CDP endpoint", 30000);
  browser = await chromium.connectOverCDP(endpoint);
  page = await until(() => browser.contexts()[0]?.pages()[0], "renderer");
  page.setDefaultTimeout(30000);
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  report.consoleErrors = consoleErrors;
  await emulatePageFocus(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  report.checks.push("app-launched-in-background-window");

  // --- The Bot, created through the app's own bridge, runs on the free local model. ---
  const created = await page.evaluate(async ({ hostId, workspace, model }) => {
    const result = await window.drogon.botCreate({
      hostId, workspaceId: workspace, requestId: crypto.randomUUID(), locale: "en-US",
      body: {
        characterPreset: "none",
        displayIdentity: { displayName: "Monitor Bot", handle: "monitor-bot", title: "Watcher" },
        harnessPolicy: { defaultHarness: "pi", explicitModel: model },
        instructions: "When the owner gives you a command line, run it exactly as written and report what it printed. Never invent flags.",
        memories: [],
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }, { hostId: status.hostId, workspace: workspaceId, model: MODEL });
  botId = created.id;
  report.botId = botId;
  assert.equal(created.harnessPolicy.explicitModel, MODEL, "the Bot runs on the free local model");
  await goToBotsPage();
  await page.getByTestId(`bot-${botId}`).waitFor();
  report.checks.push("bot-created-on-the-free-local-model");

  // The Bot's own working folder, and the Project registration the delegation
  // drain requires before it will dispatch into it (it refuses otherwise, and
  // says exactly this).
  const provisioned = await cliJson(["bot", "provision", ...botScope()]);
  homePath = provisioned.home?.path ?? provisioned.path;
  report.homePath = homePath;
  assert.ok(homePath && (await exists(homePath)), `the Bot has a provisioned home: ${homePath}`);
  await cliJson(["project", "add", homePath, "--name", "bot-home"]);
  await mkdir(path.join(homePath, "watched"), { recursive: true });
  await writeFile(path.join(homePath, "watched/state.txt"), "initial\n");
  report.checks.push("bot-home-provisioned-and-registered");

  // --- Ask the Bot, in its own session, to create its own monitor. ---
  await expandBotCard();
  await page.getByTestId(`open-session-${botId}`).click();
  await page.getByTestId("bot-session-header").waitFor({ timeout: 30000 });
  botSession = await until(async () => {
    const listed = await cliJson(["terminal", "list"]);
    return listed.sessions.find((s) => s.harnessId === "pi" && s.verdict === "live") ?? null;
  }, "the Bot's session is live", 60000, 1000);
  report.botSessionId = botSession.id;
  await shot("bot-session");
  await askBotToRun("create-monitor.sh", [
    "drogon-cli bot create-monitor",
    `--bot ${botId}`,
    `--workspace ${workspaceId}`,
    "--resource watched/state.txt",
    '--cron "* * * * *"',
    '--responsibility-name "React to the watched file"',
    // An exact command, not prose: the dispatched agent is the free local
    // model, and the test is whether the pipeline reaches it and its work
    // lands — not whether a small model can paraphrase an instruction.
    `--instructions "Run exactly this shell command in this folder and then stop: printf 'MONITOR_FIRED\\n' >> reacted.txt"`,
  ].join(" "));
  const monitor = await until(async () => {
    const state = await botState();
    return state.monitors?.[0] ?? null;
  }, "the Bot created its own monitor", 5 * 60 * 1000, 3000);
  report.monitor = { id: monitor.id, enabled: monitor.enabled, approved: monitor.approved, health: monitor.health, resource: monitor.resource };
  assert.equal(monitor.enabled, true);
  assert.equal(monitor.approved, true);
  assert.equal(monitor.health, "healthy");
  report.checks.push("the-bot-created-its-own-monitor-when-asked-in-its-session");

  // The Bots page shows the Bot's own monitor.
  await expandBotCard();
  await page.getByTestId(`bot-monitors-${botId}`).waitFor({ timeout: 20000 });
  await page.getByTestId(`bot-monitor-${monitor.id}`).waitFor({ timeout: 20000 });
  await shot("bot-monitor-listed");
  report.checks.push("the-bots-page-lists-the-monitor-the-bot-created");

  // --- The change the monitor exists for, and the reaction it must produce. ---
  await writeFile(path.join(homePath, "watched/state.txt"), `changed at ${new Date().toISOString()}\n`);
  const fired = await until(async () => {
    const state = await botState();
    const current = state.monitors?.find((m) => m.id === monitor.id);
    return current?.firing?.lastOutcome === "dispatched" ? current : null;
  }, "the monitor saw the change and dispatched its responsibility", REACTION_TIMEOUT_MS, 3000);
  assert.equal(fired.lastCheckOutcome, "changed");
  assert.equal(fired.firing.lastResource, "watched/state.txt");
  assert.ok(fired.lastEventId, "the monitor event is recorded");
  report.monitorFiring = { lastCheckOutcome: fired.lastCheckOutcome, lastOutcome: fired.firing.lastOutcome, eventId: fired.lastEventId, used: fired.delegationsToday?.used };
  const reacted = await until(async () => readFile(path.join(homePath, "reacted.txt"), "utf8").catch(() => null), "the dispatched responsibility did the work it was given", REACTION_TIMEOUT_MS, 3000);
  assert.match(reacted, /MONITOR_FIRED/, `the responsibility wrote its line: ${JSON.stringify(reacted)}`);
  report.reacted = reacted.trim();
  await shot("monitor-fired");
  report.checks.push("changing-the-watched-file-really-dispatches-the-responsibility-and-it-acts");

  // --- Ask the Bot to create its own scheduled automation. ---
  await askBotToRun("create-automation.sh", [
    "drogon-cli bot create-automation",
    `--bot ${botId}`,
    `--workspace ${workspaceId}`,
    '--name "Write the automated line"',
    '--schedule "* * * * *"',
    `--prompt "Run exactly this shell command in this folder and then stop: printf 'AUTOMATION_RAN\\n' >> automated.txt"`,
  ].join(" "));
  const automation = await until(async () => {
    const state = await botState();
    return state.automations?.find((a) => a.schedule) ?? null;
  }, "the Bot created its own automation", 5 * 60 * 1000, 3000);
  report.automation = { id: automation.responsibilityId ?? automation.id, schedule: automation.schedule, enabled: automation.enabled };
  report.checks.push("the-bot-created-its-own-scheduled-automation-when-asked");

  await expandBotCard();
  await page.getByTestId(`bot-automations-${botId}`).waitFor({ timeout: 20000 });
  await shot("bot-automation-listed");
  report.checks.push("the-bots-page-lists-the-automation-the-bot-created");

  // --- The scheduler fires it, and the run really does the work. ---
  const automated = await until(async () => readFile(path.join(homePath, "automated.txt"), "utf8").catch(() => null), "the scheduled automation ran and did its work", REACTION_TIMEOUT_MS, 3000);
  assert.match(automated, /AUTOMATION_RAN/, `the automation wrote its line: ${JSON.stringify(automated)}`);
  report.automated = automated.trim();
  const history = await cliJson(["automation", "history", "--workspace", workspaceId]).catch(() => null);
  report.automationHistory = history?.runs?.slice(-2) ?? history;
  await shot("automation-ran");
  report.checks.push("the-scheduled-automation-fired-on-the-daemon-tick-and-did-its-work");
  report.daemonTickLog = daemonLog.split("\n").filter((line) => line.includes("bot-monitors") || line.includes("delegation") || line.includes("automation")).slice(-10);
  report.status = "PASSED";
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { try { await page.screenshot({ path: path.join(output, "failure.png") }); } catch { /* keep the original failure */ } }
  try { report.botStateAtFailure = await botState(); } catch (diagnostic) { report.botStateError = String(diagnostic).slice(0, 400); }
  try { report.botTerminalAtFailure = (await botSessionText()).slice(-3000); } catch (diagnostic) { report.botTerminalError = String(diagnostic).slice(0, 200); }
  try { report.homeFiles = await readdir(homePath); } catch { /* nothing to list */ }
} finally {
  try {
    await captureChildren();
    if (browser) { try { await browser.close(); } catch (error) { report.cdpCloseError = String(error); } }
    if (desktop) report.desktopExit = await stop(desktop);
    if (daemonOwner) {
      try { report.daemonExit = await daemonOwner.stop(); }
      catch (error) {
        report.quiescentShutdownError = String(error);
        if (daemon) report.daemonExit = await stop(daemon);
      }
    } else if (daemon) report.daemonExit = await stop(daemon);
    if (daemon) report.daemonProcessExit = await stop(daemon);
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      const rows = await processRows();
      for (const row of rows) if (owned.get(row.pid) === row.identity) {
        try { process.kill(row.pid, signal); } catch { /* Already exited. */ }
      }
      await delay(300);
    }
    report.processes = [...owned].map(([pid, identity]) => ({ pid, identity }));
    report.survivors = (await processRows()).filter((row) => owned.get(row.pid) === row.identity);
    assert.equal(report.survivors.length, 0);
    if (desktop) assert.equal(report.desktopExit.verdict, "exited");
    if (daemon) assert.equal(report.daemonProcessExit.verdict, "exited");
  } catch (error) { report.cleanupError = error.stack ?? String(error); report.status = "FAILED"; }
  if (observer) {
    try { report.focus = await observer.stop(); verifyForegroundObservation(report.focus, desktop ? [desktop.pid] : []); }
    catch (error) { report.focusError = String(error); report.status = "FAILED"; }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, output, checks: report.checks, monitor: report.monitor, monitorFiring: report.monitorFiring, reacted: report.reacted, automation: report.automation, automated: report.automated, error: report.error, cleanupError: report.cleanupError, focusError: report.focusError, survivors: report.survivors }, null, 2));
  if (report.status !== "PASSED") process.exitCode = 1;
}
