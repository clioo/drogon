// Real desktop + pinned recipe runtime; every model executable is a local fixture.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
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
import { installPrivateAcceptanceEnvironment } from "./acceptance-private-environment.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";
import { bundledRuntimeDestination } from "./mentu-runtime-provision.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const cli = path.join(root, "target/debug/drogon-cli");
const fixture = await mkdtemp(path.join(tmpdir(), "drogon-durable-ui-"));
const dataDir = path.join(fixture, "data");
const workspace = path.join(fixture, "workspace");
const output = process.env.ORCHESTRATOR_OUT ?? path.join(root, ".preflight/acceptance", `durable-orchestrator-${Date.now()}`);
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
async function cliJson(args) {
  const { stdout } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], { timeout: 30000 });
  const value = JSON.parse(stdout);
  assert.equal(value.ok, true, stdout);
  return value.result;
}
async function until(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function graph() { return JSON.parse(await readFile(path.join(workspace, ".drogon/graph.json"), "utf8")); }
async function shot(page, name) {
  await page.getByTestId("subagent-policy-panel").evaluate((element) => { element.scrollTop = 0; });
  await until(async () => {
    report.fit = await page.evaluate(() => {
    const flow = document.querySelector('[data-testid="orchestrator-flow"]');
    if (!flow) return false;
    const child = flow.getBoundingClientRect();
    const parent = flow.parentElement.getBoundingClientRect();
    const main = document.querySelector('[data-testid="orchestrator-main-agent"]')?.getBoundingClientRect();
    return { left: child.left, right: child.right, parentLeft: parent.left, parentRight: parent.right, mainWidth: main?.width ?? 0 };
    });
    return report.fit && report.fit.left >= report.fit.parentLeft - 1 && report.fit.right <= report.fit.parentRight + 1 && report.fit.mainWidth >= 168;
  }, "Fit view keeps readable cards inside its viewport", 10000);
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...document.querySelectorAll('[data-testid^="approved-runtime-row-"]')].map((row) => ({
      overflow: row.scrollWidth - row.clientWidth,
      modelWidth: row.querySelector('[data-testid$="-model-value"]')?.getBoundingClientRect().width ?? 0,
    })),
  }));
  assert.ok(layout.overflow <= 1, JSON.stringify(layout));
  assert.ok(layout.rows.every((row) => row.overflow <= 1 && row.modelWidth > 200), JSON.stringify(layout));
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}
async function openOrchestrator(page) {
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Select durable-orchestrator", exact: true }).count()) {
    await page.getByRole("button", { name: "Select durable-orchestrator", exact: true }).click();
  }
  if (!(await page.getByRole("tab", { name: "Work Graph", exact: true }).count())) {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  } else await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
  await page.getByTestId("orchestrator-canvas").waitFor();
  assert.equal(await page.getByTestId("work-graph-orchestrator").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add node", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save intent", exact: true }).count(), 0);
}

try {
  await mkdir(output, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const bin = path.join(fixture, "bin");
  await mkdir(bin);
  // A real executable consumes the exact compiler argv and produces evaluation evidence.
  const fixtureSource = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('opencode fixture 1.0'); process.exit(0); }
if (args[0] === 'models') { console.log('fixture/main\\nfixture/one\\nfixture/two\\nfixture/fallback'); process.exit(0); }
if (args[0] !== 'run') process.exit(20);
const model = args[args.indexOf('--model') + 1];
const prompt = args.at(-1);
const target = prompt.match(/Write (\\.drogon\\/evaluations\\/[^ ]+\\.json) as JSON/)?.[1];
const scenario = fs.readFileSync(process.env.DROGON_FIXTURE_SCENARIO, 'utf8').trim();
fs.appendFileSync(process.env.DROGON_FIXTURE_LOG, JSON.stringify({ model, target: target ?? 'main' }) + '\\n');
await new Promise(resolve => setTimeout(resolve, target ? 1100 : 300));
if (scenario === 'fallback' && model !== 'fixture/main' && model !== 'fixture/fallback') process.exit(9);
if (target) {
  fs.mkdirSync('.drogon/evaluations', { recursive: true });
  const findings = scenario === 'findings' && prompt.includes('Iteration 1 of');
  fs.writeFileSync(target, JSON.stringify({ verdict: findings ? 'findings' : 'pass', evidence: 'Local executable fixture tested the requested iteration.' }));
}
console.log(prompt.match(/DROGON_NODE_[A-Z0-9_]+_DONE/g)?.at(-1) ?? 'fixture complete');
`;
  await writeFile(path.join(bin, "opencode"), fixtureSource);
  await chmod(path.join(bin, "opencode"), 0o700);
  for (const name of ["claude", "codex", "pi", "agy"]) {
    await writeFile(path.join(bin, name), "#!/bin/sh\nexit 19\n");
    await chmod(path.join(bin, name), 0o700);
  }
  const scenario = path.join(fixture, "scenario");
  const log = path.join(fixture, "launches.jsonl");
  await writeFile(scenario, "findings");
  await writeFile(log, "");
  const env = { ...process.env };
  await installPrivateAcceptanceEnvironment(fixture, env);
  Object.assign(env, { PATH: `${bin}:${process.env.PATH}`, DROGON_FIXTURE_SCENARIO: scenario, DROGON_FIXTURE_LOG: log, DROGON_MENTU_RUNTIME: process.env.DROGON_MENTU_RUNTIME_SOURCE ?? bundledRuntimeDestination(root) });
  if (process.platform === "darwin") observer = await startForegroundObservation(output);
  daemon = start(path.join(root, "target/debug/drogond"), ["--data-dir", dataDir], { env, stdio: "ignore" });
  await until(async () => { try { return await cliJson(["status"]); } catch { return false; } }, "daemon readiness", 30000);
  daemonOwner = packagedFixtureDaemon(path.join(root, "target/debug/drogond"), cli, dataDir);
  await daemonOwner.capture();
  report.daemonIdentity = daemonOwner.identity();
  await cliJson(["project", "add", workspace, "--name", "durable-orchestrator"]);
  const { workspaces } = await cliJson(["workspace", "list"]);
  const workspaceId = workspaces.find((w) => w.name === "durable-orchestrator").id;
  report.workspaceId = workspaceId;
  const main = { id: "orchestrator-main", title: "Main agent", harness: "opencode", model: "fixture/main", prompt: "Implement the fixture task", dependsOn: [], enabled: true, verifyCommands: [] };
  const policy = { approvedRuntimes: [{ harness: "opencode", model: "fixture/one" }, { harness: "opencode", model: "fixture/two" }], fallbackRuntime: { harness: "opencode", model: "fixture/fallback" }, adversarial: { enabled: false, maxIterations: 2 }, delegate: false };
  const intentFile = path.join(fixture, "intent.json");
  await writeFile(intentFile, JSON.stringify({ nodes: [main], policy }));
  await cliJson(["graph", "write-intent", "--workspace", workspaceId, "--file", intentFile]);
  desktop = start(electron, [appDir, "--remote-debugging-port=0"], { env: { ...env, DROGON_DATA_DIR: dataDir, DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"), DROGON_BACKGROUND_WINDOW: "1" }, stdio: ["ignore", "ignore", "pipe"] });
  report.desktopPid = desktop.pid;
  let stderr = "";
  desktop.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16000); });
  const endpoint = await until(() => stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1], "CDP endpoint", 30000);
  browser = await chromium.connectOverCDP(endpoint);
  page = await until(() => browser.contexts()[0]?.pages()[0], "renderer");
  page.setDefaultTimeout(30000);
  await emulatePageFocus(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrchestrator(page);
  await page.getByRole("button", { name: /^Work Graph(?: \(|$)/ }).click();
  await page.getByTestId("work-graph-panel").waitFor();
  assert.equal(await page.getByTestId("mentu-panel").count(), 0);
  await page.getByRole("button", { name: "Open Work Graph", exact: true }).click();
  await page.getByTestId("orchestrator-canvas").waitFor();
  assert.equal(await page.getByRole("tab", { name: "Work Graph", exact: true }).count(), 1);
  report.checks.push("work-graph-opens-orchestrator-directly-from-tab-and-sidebar");
  await page.getByRole("textbox", { name: "Main task", exact: true }).fill("Implement the fixture task and preserve evidence");
  await until(async () => (await graph()).intent.nodes.find((n) => n.id === main.id)?.prompt.includes("preserve evidence"), "main task autosave");
  await selectSettingsTheme(page, "dark");
  await openOrchestrator(page);
  assert.equal(await page.getByTestId("orchestrator-test-node").count(), 0);
  await shot(page, "adversarial-off");
  const status = async () => {
    return (await cliJson(["graph", "orchestrator-status", "--workspace", workspaceId])).run;
  };
  await page.getByTestId("orchestrator-run-workflow").click();
  const baseOnly = await until(async () => { const r = await status(); return r?.status !== "running" && r; }, "base-only run");
  assert.equal(baseOnly.status, "passed", JSON.stringify(baseOnly));
  assert.equal(baseOnly.steps.length, 1);
  report.checks.push("run-with-adversarial-off-executes-only-main");
  await writeFile(log, "");
  await page.getByTestId("adversarial-toggle").click();
  await until(async () => (await graph()).intent.policy.adversarial.enabled, "adversarial autosave");
  await page.getByTestId("orchestrator-test-node").waitFor();
  await page.getByTestId("orchestrator-review-node").waitFor();
  await shot(page, "adversarial-on");
  report.checks.push("off-on-designs-and-autosave");
  await page.getByTestId("orchestrator-run-workflow").click();
  const running = await until(async () => { const r = await status(); return r?.phase === "test" && r; }, "test launched");
  await captureChildren();
  await page.reload();
  await openOrchestrator(page);
  const completed = await until(async () => { const r = await status(); return r?.status !== "running" && r; }, "completed findings loop");
  assert.equal(completed.id, running.id);
  assert.equal(completed.status, "passed", JSON.stringify(completed));
  assert.equal(completed.steps.length, 5, JSON.stringify(completed));
  assert.ok(completed.steps.every((step) => step.attempts.length === 1));
  assert.equal(completed.steps[1].verdict, "findings");
  assert.equal(completed.steps[2].phase, "review");
  const launches = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(launches.length, 5, "reload must not duplicate a launch");
  report.findingsRun = completed;
  report.checks.push("findings-review-retest-pass-without-failover-and-reload-without-duplicate");
  await until(async () => (await page.getByTestId("orchestrator-terminal").innerText()).includes("Last run: Ready to merge"), "rendered completed receipt", 10000);
  await shot(page, "findings-loop-completed");
  await writeFile(scenario, "fallback");
  await page.getByTestId("orchestrator-run-workflow").click();
  const fallbackRun = await until(async () => { const r = await status(); return r?.id !== completed.id && r?.status !== "running" && r; }, "fallback loop completed");
  assert.equal(fallbackRun.status, "passed", JSON.stringify(fallbackRun));
  for (const step of fallbackRun.steps.slice(1)) {
    assert.equal(step.attempts.length, 3, JSON.stringify(step));
    assert.equal(step.isFallback, true);
    assert.equal(step.attempts[2].model, "fixture/fallback");
    assert.ok(step.attempts.slice(0, 2).every((attempt) => attempt.outcome === "failed"));
  }
  report.fallbackRun = fallbackRun;
  report.checks.push("runtime-failures-exhaust-approved-before-real-fallback");
  await until(async () => (await page.getByTestId("orchestrator-terminal").innerText()).includes("Last run: Ready to merge"), "rendered fallback receipt", 10000);
  await shot(page, "fallback-completed");
  report.status = "PASSED";
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { try { await page.screenshot({ path: path.join(output, "failure.png") }); } catch { /* Preserve the original failure. */ } }
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
  console.log(JSON.stringify({ status: report.status, output, checks: report.checks, screenshots: report.screenshots, error: report.error, cleanupError: report.cleanupError, focusError: report.focusError, survivors: report.survivors }, null, 2));
  if (report.status !== "PASSED") process.exitCode = 1;
}
