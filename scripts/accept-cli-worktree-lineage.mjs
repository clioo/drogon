// Real desktop + real daemon over CDP: a worktree that `drogon-cli` creates
// from inside a Drogon session nests under that session's worktree in the
// sidebar, the way a subagent belongs under its coordinator. The session is
// a real PTY the daemon spawns; the CLI inside it sees only the environment
// the daemon exports (DROGON_WORKSPACE_ID, DROGON_DATA_DIR).
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { runAcceptanceProcess as exec, scrubInheritedDispatchBindings, startAcceptanceProcess as start, stopAcceptanceProcess as stop } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { startForegroundObservation, verifyForegroundObservation } from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { installPrivateAcceptanceEnvironment } from "./acceptance-private-environment.mjs";

// This journey owns a disposable daemon: drop the parent dispatch context so
// its CLI never presents a foreign credential to its own daemon.
scrubInheritedDispatchBindings();

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const cli = path.join(root, "target/debug/drogon-cli");
const daemonBinary = path.join(root, "target/debug/drogond");
// Short prefix on purpose: the daemon socket lives under the fixture and
// macOS caps unix socket paths at 104 bytes.
const fixture = await mkdtemp(path.join(tmpdir(), "dl-ui-"));
const dataDir = path.join(fixture, "data");
const repo = path.join(fixture, "repo");
const output = process.env.LINEAGE_OUT ?? path.join(root, ".preflight/acceptance", `cli-worktree-lineage-${Date.now()}`);
const report = { status: "FAILED", fixture, output, checks: [], screenshots: [], processes: [] };
let desktop, daemon, browser, observer, daemonOwner, page;
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
  const { stdout, stderr } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], { timeout: 30000, ...options });
  const value = JSON.parse(stdout);
  assert.equal(value.ok, true, stdout);
  return { result: value.result, stderr };
}
async function until(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
const exists = (file) => access(file).then(() => true, () => false);
const q = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
// The sidebar card's nesting depth: 0 for a top-level worktree, 1 for a
// child rendered under its parent (ProjectList's data-worktree-nesting-depth).
const depthOf = (name) => page.evaluate((n) =>
  document.querySelector(`[aria-label="Select ${n}"]`)?.closest("[data-worktree-nesting-depth]")?.getAttribute("data-worktree-nesting-depth") ?? null, name);
const cardOrder = () => page.evaluate(() =>
  [...document.querySelectorAll("[data-worktree-nesting-depth]")].map((card) => ({
    name: card.querySelector('[aria-label^="Select "]')?.getAttribute("aria-label")?.slice("Select ".length) ?? null,
    depth: card.getAttribute("data-worktree-nesting-depth"),
  })));

try {
  await mkdir(output, { recursive: true });
  await mkdir(repo, { recursive: true });
  const env = { ...process.env };
  await installPrivateAcceptanceEnvironment(fixture, env);
  const git = (args) => exec("git", ["-c", "user.name=Drogon", "-c", "user.email=drogon@example.invalid", ...args], { env });
  await git(["init", "-q", "-b", "main", repo]);
  await writeFile(path.join(repo, "README.md"), "lineage fixture\n");
  await git(["-C", repo, "add", "-A"]);
  await git(["-C", repo, "commit", "-q", "-m", "init"]);
  // Nothing in this process's own context may leak a parent into the
  // control-path creates below; only the real session leg carries one.
  delete env.DROGON_WORKSPACE_ID;
  if (process.platform === "darwin") observer = await startForegroundObservation(output);
  daemon = start(daemonBinary, ["--data-dir", dataDir], { env, stdio: "ignore" });
  await until(async () => { try { return await cliJson(["status"]); } catch { return false; } }, "daemon readiness", 30000);
  daemonOwner = packagedFixtureDaemon(daemonBinary, cli, dataDir);
  await daemonOwner.capture();
  report.daemonIdentity = daemonOwner.identity();
  const { result: project } = await cliJson(["project", "add", repo, "--name", "lineage"], { env, cwd: fixture });
  const { result: coordinator } = await cliJson(["worktree", "create", "--project", project.id, "--name", "coordinator", "--no-parent"], { env, cwd: fixture });
  // The daemon reports a top-level worktree as an explicit null.
  assert.equal(coordinator.parentWorktreeId ?? null, null);
  report.projectId = project.id;
  report.coordinator = { id: coordinator.id, workspaceId: coordinator.workspaceId };

  desktop = start(electron, [appDir, "--remote-debugging-port=0"], { env: { ...env, DROGON_DATA_DIR: dataDir, DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"), DROGON_BACKGROUND_WINDOW: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  report.desktopPid = desktop.pid;
  let stderrText = "";
  desktop.stderr.on("data", (chunk) => { stderrText = (stderrText + chunk).slice(-16000); });
  const endpoint = await until(() => stderrText.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1], "CDP endpoint", 30000);
  browser = await chromium.connectOverCDP(endpoint);
  page = await until(() => browser.contexts()[0]?.pages()[0], "renderer");
  page.setDefaultTimeout(30000);
  const consoleTail = [];
  page.on("console", (message) => { consoleTail.push(`${message.type()}: ${message.text()}`); if (consoleTail.length > 80) consoleTail.shift(); });
  report.consoleTail = consoleTail;
  await emulatePageFocus(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Select coordinator", exact: true }).waitFor();
  assert.equal(await depthOf("coordinator"), "0");
  report.checks.push("coordinator-renders-top-level");

  // --- The user's flow: a real session in the coordinator worktree runs
  // `drogon-cli worktree create`; only the daemon-exported env is present. ---
  const out = path.join(fixture, "subagent.json");
  const errFile = path.join(fixture, "subagent.stderr");
  const done = path.join(fixture, "subagent.done");
  const script = `${q(cli)} --json worktree create --project ${q(project.id)} --name subagent-a > ${q(out)} 2> ${q(errFile)}; echo $? > ${q(out + ".code")}; touch ${q(done)}`;
  const { result: session } = await cliJson(["terminal", "create", "--workspace", coordinator.workspaceId, "--", "sh", "-c", script], { env, cwd: fixture });
  report.sessionId = session.id;
  await until(() => exists(done), "session finished its create", 30000);
  const created = JSON.parse(await readFile(out, "utf8"));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.result.parentWorktreeId, coordinator.id, "created from inside the session -> nested under its worktree");
  assert.equal((await readFile(errFile, "utf8")).trim(), "", "a resolved parent is not a warning");
  report.checks.push("cli-inside-session-records-parent-worktree");

  await until(async () => (await depthOf("subagent-a")) === "1", "subagent-a nests under coordinator in the sidebar");
  let order = await cardOrder();
  const coordinatorIndex = order.findIndex((card) => card.name === "coordinator");
  const childIndex = order.findIndex((card) => card.name === "subagent-a");
  assert.ok(coordinatorIndex >= 0 && childIndex === coordinatorIndex + 1, JSON.stringify(order));
  report.checks.push("sidebar-nests-session-created-worktree-under-its-parent");

  // --- The explicit opt-out stays a top-level card, on the same daemon. ---
  const { result: standalone } = await cliJson(["worktree", "create", "--project", project.id, "--name", "standalone", "--no-parent"], { env, cwd: fixture });
  assert.equal(standalone.parentWorktreeId ?? null, null);
  await until(async () => (await depthOf("standalone")) === "0", "standalone renders top-level");
  report.checks.push("no-parent-renders-top-level");

  const file = path.join(output, "sidebar-lineage.png");
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);

  // --- Nesting is the daemon's record, not renderer memory: it survives a reload. ---
  await page.reload();
  await page.getByRole("button", { name: "Select coordinator", exact: true }).waitFor();
  await until(async () => (await depthOf("subagent-a")) === "1", "nesting survives reload");
  assert.equal(await depthOf("standalone"), "0");
  order = await cardOrder();
  report.sidebar = order;
  report.checks.push("nesting-survives-reload");

  // The session's shell exits once its script is done; the daemon proves it.
  await cliJson(["terminal", "wait", "--session", session.id, "--incarnation", session.incarnation, "--for", "exited", "--timeout-ms", "15000"], { env, cwd: fixture });
  report.checks.push("session-exited");
  report.status = "PASSED";
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) {
    try { await page.screenshot({ path: path.join(output, "failure.png") }); } catch { /* Preserve the original failure. */ }
    // What the renderer actually held when the check failed: the rendered
    // cards and the daemon rows it can read, so a live-refresh gap and a
    // nesting gap are told apart from the report alone.
    try { report.sidebarAtFailure = await cardOrder(); } catch { /* best effort */ }
    try {
      report.worktreeListAtFailure = await page.evaluate(
        (projectId) => window.drogon.project?.worktreeList?.({ projectId }),
        report.projectId,
      );
    } catch (diagnostic) { report.worktreeListAtFailure = String(diagnostic); }
  }
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
  console.log(JSON.stringify({ status: report.status, output, checks: report.checks, screenshots: report.screenshots, sidebar: report.sidebar, error: report.error, cleanupError: report.cleanupError, focusError: report.focusError, survivors: report.survivors, sidebarAtFailure: report.sidebarAtFailure, worktreeListAtFailure: report.worktreeListAtFailure, consoleTail: report.error ? report.consoleTail : undefined }, null, 2));
  if (report.status !== "PASSED") process.exitCode = 1;
}
