// The Orchestrator's three execution modes, end to end on the REAL desktop
// over CDP (background window, private data dir and Electron profile) in a
// fresh disposable git repository: None (direct), Delegate, and Adversarial
// testing. Each mode runs in its own fresh worktree of the repository, so a
// mode's testers judge only that mode's task. Every run goes through the real
// UI (policy panel, toggles, "Run workflow") and the real daemon-owned durable
// orchestrator; the main agent
// and every subagent are the real `pi` harness on the cheap model the owner
// named for orchestration end-to-end tests (`openai-codex/gpt-5.6-luna:low`).
// Only the policy-brief sessions use a fixture `claude` (no inference).
//
// Run: node scripts/accept-orchestrator-modes.mjs
// Env: ORCHESTRATOR_MODES_MODEL overrides the pi model id (default above);
//      ORCHESTRATOR_MODES_OUT overrides the report directory.
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readdir, readFile, writeFile, chmod } from "node:fs/promises";
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
import { bundledRuntimeDestination } from "./mentu-runtime-provision.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const cli = path.join(root, "target/debug/drogon-cli");
const daemonBinary = path.join(root, "target/debug/drogond");
const MODEL = process.env.ORCHESTRATOR_MODES_MODEL ?? "openai-codex/gpt-5.6-luna:low";
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
// Short prefix on purpose: the daemon socket lives under the fixture and
// macOS caps unix socket paths at 104 bytes.
const fixture = await mkdtemp(path.join(tmpdir(), "om-"));
const dataDir = path.join(fixture, "data");
const repo = path.join(fixture, "repo");
const fixtureBin = path.join(fixture, "bin");
const output = process.env.ORCHESTRATOR_MODES_OUT ?? path.join(root, ".preflight/acceptance", `orchestrator-modes-${Date.now()}`);
const report = { status: "FAILED", model: MODEL, fixture, output, checks: [], screenshots: [], modes: {}, processes: [] };
let desktop, daemon, browser, observer, daemonOwner, page, projectId;
// The worktree the current mode runs in (each mode gets a fresh one).
let workspace, workspaceId, workspaceName;
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
  const { stdout } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], { timeout: 30000, ...options });
  const value = JSON.parse(stdout);
  assert.equal(value.ok, true, stdout);
  return value.result;
}
async function until(check, label, timeout = 60000, every = 250) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(every);
  }
  throw new Error(`Timed out: ${label}`);
}
const exists = (file) => access(file).then(() => true, () => false);
async function graph() { return JSON.parse(await readFile(path.join(workspace, ".drogon/graph.json"), "utf8")); }
async function status() { return (await cliJson(["graph", "orchestrator-status", "--workspace", workspaceId])).run; }
async function shot(name) {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}
async function openOrchestrator() {
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  // The sidebar learns about a CLI-created worktree through the registry
  // watcher; select this mode's card once it is there.
  const select = page.getByRole("button", { name: `Select ${workspaceName}`, exact: true });
  await select.waitFor({ timeout: 30000 });
  await select.click();
  if (!(await page.getByRole("tab", { name: "Work Graph", exact: true }).count())) {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  } else await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
  await page.getByTestId("orchestrator-canvas").waitFor();
  await page.getByTestId("subagent-policy-panel").waitFor();
}
const panel = () => page.getByTestId("subagent-policy-panel");
async function selectHarness(testId, displayName) {
  await panel().getByTestId(testId).click();
  await page.getByRole("option", { name: displayName, exact: true }).click();
}
// The model picker accepts a typed id the host catalog does not list ("typed
// · unverified"), which is how a `provider/model:thinking` pair is chosen.
async function pickModel(prefix, model) {
  const value = panel().getByTestId(`${prefix}-model-value`);
  if ((await value.innerText()).trim() === model) return;
  await value.locator("xpath=..").getByRole("button", { name: "Browse models" }).click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.fill(model);
  await page.locator('[role="listbox"] [role="option"]').filter({ hasText: model }).first().click();
  await until(async () => (await value.innerText()).trim() === model, `${prefix} model shows ${model}`, 10000);
}
async function waitPolicy(predicate, label) {
  return until(async () => { try { const g = await graph(); return predicate(g.intent.policy) && g; } catch { return false; } }, label, 15000);
}
async function briefForNextSession() {
  // The daemon writes the policy brief at every harness session start; the
  // fixture `claude` on the daemon's PATH is what starts (never inference).
  const session = await cliJson(["harness", "start", "--workspace", workspaceId, "--harness", "claude", "--permission-mode", "unattended"]);
  const agents = await until(() => readFile(path.join(workspace, "AGENTS.md"), "utf8").catch(() => null), "AGENTS.md brief", 15000);
  await cliJson(["terminal", "close", "--session", session.id, "--incarnation", session.incarnation]).catch(() => {});
  await cliJson(["terminal", "wait", "--session", session.id, "--incarnation", session.incarnation, "--for", "exited", "--timeout-ms", "15000"]).catch(() => {});
  return agents;
}
async function diagnostics(run) {
  const out = { run };
  try {
    const runsDir = path.join(workspace, ".mentu", "runs");
    const runs = await readdir(runsDir).catch(() => []);
    out.mentuRuns = {};
    for (const id of runs) {
      const dir = path.join(runsDir, id);
      const files = await readdir(dir).catch(() => []);
      out.mentuRuns[id] = {};
      for (const file of files.filter((f) => /\.(stderr|stdout|log|json)$/.test(f))) {
        out.mentuRuns[id][file] = (await readFile(path.join(dir, file), "utf8").catch(() => "")).slice(-4000);
      }
    }
  } catch (error) { out.mentuRunsError = String(error); }
  try { out.observability = await cliJson(["graph", "observability", "--workspace", workspaceId]); } catch (error) { out.observabilityError = String(error); }
  try {
    const evaluations = path.join(workspace, ".drogon", "evaluations");
    out.evaluations = {};
    for (const file of await readdir(evaluations).catch(() => [])) out.evaluations[file] = await readFile(path.join(evaluations, file), "utf8").catch(() => "");
  } catch (error) { out.evaluationsError = String(error); }
  return out;
}
async function runMode(mode, { file, line, configure }) {
  const record = { startedAt: new Date().toISOString() };
  report.modes[mode] = record;
  // A fresh worktree per mode: its own checkout, policy, evidence and
  // sessions, so nothing from an earlier mode is visible to this mode's agents.
  workspaceName = `modes-${mode}`;
  const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
  workspace = worktree.path; workspaceId = worktree.workspaceId;
  record.workspace = workspace; record.workspaceId = workspaceId;
  await openOrchestrator();
  const prompt = `In this git repository, create a file named ${file} at the repository root containing exactly one line: ${line}\nDo not create or modify any other file and do not commit. Then report done.`;
  await panel().getByRole("textbox", { name: "Main task" }).fill(prompt);
  await until(async () => (await graph()).intent.nodes.find((n) => n.id === "orchestrator-main")?.prompt === prompt, `${mode} main task autosave`, 15000);
  // Main agent runtime: the real pi harness on the cheap model, chosen through
  // the real controls (harness select + typed model id), then one approved
  // runtime for every subagent role (test/review, delegated children).
  await selectHarness("main-task-harness", "Pi");
  await pickModel("main-task", MODEL);
  await until(async () => { const n = (await graph()).intent.nodes.find((x) => x.id === "orchestrator-main"); return n?.harness === "pi" && n?.model === MODEL; }, `${mode} main runtime autosave`, 15000);
  await panel().getByTestId("add-approved-runtime").click();
  await panel().getByTestId("approved-runtime-row-0").waitFor();
  await selectHarness("approved-runtime-0-harness", "Pi");
  await pickModel("approved-runtime-0", MODEL);
  await waitPolicy((p) => p.approvedRuntimes.length === 1 && p.approvedRuntimes[0].harness === "pi" && p.approvedRuntimes[0].model === MODEL, `${mode} approved runtime autosave`);
  await configure();
  const policy = (await graph()).intent.policy;
  record.policy = policy;
  record.brief = (await briefForNextSession()).match(/Mode: [A-Z]+[^\n]*/)?.[0] ?? null;
  await openOrchestrator();
  const disclosure = page.getByTestId("orchestrator-runtime-disclosure");
  if (await disclosure.count()) record.disclosure = { text: (await disclosure.innerText()).trim(), freeDefault: await disclosure.getAttribute("data-free-default") };
  await shot(`${mode}-before-run`);
  const before = await status();
  await page.getByTestId("orchestrator-run-workflow").click();
  const started = await until(async () => { const r = await status(); return r && r.id !== before?.id && r; }, `${mode} run started`, 30000);
  record.runId = started.id;
  const done = await until(async () => { const r = await status(); return r?.id === started.id && r.status !== "running" && r.status !== "stopping" && r; }, `${mode} run finished`, RUN_TIMEOUT_MS, 1000);
  record.finishedAt = new Date().toISOString();
  record.status = done.status;
  record.error = done.error ?? null;
  record.steps = done.steps.map((s) => ({ phase: s.phase, iteration: s.iteration, status: s.status, verdict: s.verdict ?? null, runtime: s.runtime, attempts: s.attempts }));
  const terminal = page.getByTestId("orchestrator-terminal");
  await until(async () => /Last run:/.test(await terminal.innerText()), `${mode} receipt rendered`, 30000);
  record.terminal = { state: await terminal.getAttribute("data-state"), text: (await terminal.innerText()).trim().slice(0, 2000) };
  await shot(`${mode}-after-run`);
  const target = path.join(workspace, file);
  record.fileCreated = await exists(target);
  record.fileContent = record.fileCreated ? (await readFile(target, "utf8")).trim() : null;
  // The agents' work must stay the owner's to commit: no run may add commits
  // to the repository (the runtime auto-commits declared `expected_changes`).
  const { stdout: log } = await exec("git", ["-C", workspace, "log", "--oneline"]);
  record.commits = log.trim().split("\n").filter(Boolean).length;
  // The prompts tell every agent to checkpoint through `drogon-cli graph
  // evidence-add`; evidence tagged with this run proves the daemon's CLI
  // reached the node process (nothing else put it on PATH).
  const { observability } = await cliJson(["graph", "observability", "--workspace", workspaceId]);
  record.evidence = (observability.evidence ?? []).filter((e) => e.runId === done.id).map((e) => `${e.agentId ?? "?"}: ${e.status} — ${e.summary}`);
  record.evaluations = await readdir(path.join(workspace, ".drogon", "evaluations")).catch(() => []);
  if (done.status !== "passed") record.diagnostics = await diagnostics(done);
  return record;
}

try {
  await mkdir(output, { recursive: true });
  await mkdir(repo, { recursive: true });
  await mkdir(fixtureBin, { recursive: true });
  // Fixture `claude` for the brief sessions only: prints and idles on stdin.
  await writeFile(path.join(fixtureBin, "claude"), "#!/bin/sh\nprintf 'modes-fixture\\n'\nwhile IFS= read -r line; do :; done\n");
  await chmod(path.join(fixtureBin, "claude"), 0o755);
  const runtime = process.env.DROGON_MENTU_RUNTIME ?? bundledRuntimeDestination(root);
  assert.ok(await exists(runtime), `mentu runtime missing at ${runtime}; run scripts/mentu-runtime-provision.mjs`);
  // Real HOME on purpose: pi reads the owner's credentials for the cheap
  // model. The app state itself lives in the private data dir and profile.
  const nodeBin = path.dirname(process.execPath);
  // Production parity: nothing puts this daemon's CLI on PATH for the owner;
  // the daemon itself must hand its shims to every node runtime it spawns.
  const env = { ...process.env, PATH: `${fixtureBin}:/opt/homebrew/bin:${nodeBin}:${process.env.PATH}`, DROGON_MENTU_RUNTIME: runtime };
  delete env.DROGON_WORKSPACE_ID; delete env.DROGON_SESSION_ID; delete env.DROGON_DATA_DIR; delete env.DROGON_TERMINAL;
  const git = (args) => exec("git", ["-c", "user.name=Drogon Modes", "-c", "user.email=modes@example.invalid", ...args], { env });
  await git(["init", "-q", "-b", "main", repo]);
  await writeFile(path.join(repo, "README.md"), "# modes-lab\n\nDisposable repository for the Orchestrator mode acceptance.\n");
  await writeFile(path.join(repo, ".gitignore"), ".drogon/\n.mentu/\nAGENTS.md\nCLAUDE.md\n");
  await git(["-C", repo, "add", "-A"]);
  await git(["-C", repo, "commit", "-q", "-m", "init"]);
  if (process.platform === "darwin") observer = await startForegroundObservation(output);
  daemon = start(daemonBinary, ["--data-dir", dataDir], { env, stdio: "ignore" });
  await until(async () => { try { return await cliJson(["status"]); } catch { return false; } }, "daemon readiness", 30000);
  daemonOwner = packagedFixtureDaemon(daemonBinary, cli, dataDir);
  await daemonOwner.capture();
  report.daemonIdentity = daemonOwner.identity();
  const project = await cliJson(["project", "add", repo, "--name", "modes-lab"], { env, cwd: fixture });
  projectId = project.id;
  report.projectId = projectId;

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
  report.checks.push("app-launched-in-background-window-with-fresh-repo");

  // --- Mode 1: None (direct). Both toggles off. ---
  const none = await runMode("none", {
    file: "direct.txt", line: "hola drogon directo",
    configure: async () => {
      await waitPolicy((q) => !q.delegate && !q.adversarial.enabled, "none policy");
    },
  });
  assert.match(none.brief ?? "", /Mode: DIRECT/, `none brief: ${none.brief}`);
  assert.equal(none.status, "passed", JSON.stringify(none, null, 2));
  assert.equal(none.steps.length, 1, JSON.stringify(none.steps));
  assert.equal(none.steps[0].phase, "main");
  assert.equal(none.fileContent, "hola drogon directo", `direct.txt: ${none.fileContent}`);
  assert.equal(none.terminal.state, "ready", none.terminal.text);
  assert.equal(none.commits, 1, "no run may commit on the owner's behalf");
  assert.ok(none.evidence.length >= 1, `${"none"}: the agent reached drogon-cli from the node runtime`);
  report.checks.push("none-mode-runs-main-only-and-the-main-agent-does-the-work-itself");
  report.checks.push("main-agent-and-approved-runtime-set-through-the-ui");

  // --- Mode 2: Delegate. ---
  const delegate = await runMode("delegate", {
    file: "delegate.txt", line: "hola drogon delegado",
    configure: async () => {
      await panel().getByTestId("delegate-toggle").click();
      await waitPolicy((q) => q.delegate && !q.adversarial.enabled, "delegate policy");
    },
  });
  assert.match(delegate.brief ?? "", /Mode: DELEGATE/, `delegate brief: ${delegate.brief}`);
  assert.equal(delegate.steps.length, 1, "delegate adds no daemon-owned tester: " + JSON.stringify(delegate.steps));
  assert.equal(delegate.status, "passed", JSON.stringify(delegate, null, 2));
  assert.equal(delegate.fileContent, "hola drogon delegado", `delegate.txt: ${delegate.fileContent}`);
  assert.equal(delegate.terminal.state, "ready", delegate.terminal.text);
  assert.equal(delegate.commits, 1, "no run may commit on the owner's behalf");
  assert.ok(delegate.evidence.length >= 1, `${"delegate"}: the agent reached drogon-cli from the node runtime`);
  report.checks.push("delegate-mode-runs-main-as-planner-with-no-daemon-tester");

  // --- Mode 3: Adversarial testing, bounded to 2 cycles. ---
  const adversarial = await runMode("adversarial", {
    file: "adversarial.txt", line: "hola drogon adversarial",
    configure: async () => {
      await panel().getByTestId("adversarial-toggle").click();
      await waitPolicy((q) => q.adversarial.enabled && !q.delegate, "adversarial policy");
      const valueOf = async () => Number((await panel().getByTestId("adversarial-max-iterations-value").innerText()).trim());
      while ((await valueOf()) > 2) await panel().getByTestId("adversarial-max-iterations-decrease").click();
      await waitPolicy((q) => q.adversarial.maxIterations === 2, "max iterations 2");
      await page.getByTestId("orchestrator-test-node").waitFor();
    },
  });
  assert.match(adversarial.brief ?? "", /Mode: ADVERSARIAL/, `adversarial brief: ${adversarial.brief}`);
  assert.equal(adversarial.status, "passed", JSON.stringify(adversarial, null, 2));
  assert.ok(adversarial.steps.length >= 2 && adversarial.steps[0].phase === "main" && adversarial.steps[1].phase === "test", JSON.stringify(adversarial.steps));
  assert.ok(adversarial.steps.slice(1).every((s) => s.verdict === "pass" || s.verdict === "findings"), JSON.stringify(adversarial.steps));
  assert.equal(adversarial.fileContent, "hola drogon adversarial", `adversarial.txt: ${adversarial.fileContent}`);
  assert.equal(adversarial.terminal.state, "ready", adversarial.terminal.text);
  assert.equal(adversarial.commits, 1, "no run may commit on the owner's behalf");
  assert.ok(adversarial.evidence.length >= 1, `${"adversarial"}: the agent reached drogon-cli from the node runtime`);
  assert.ok(adversarial.evaluations.length >= 1, "the daemon-owned tester wrote its evaluation");
  report.checks.push("adversarial-mode-runs-the-daemon-owned-test-review-loop-to-a-verdict");
  report.status = "PASSED";
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { try { await page.screenshot({ path: path.join(output, "failure.png") }); } catch { /* keep the original failure */ } }
  if (workspaceId) { try { report.failureDiagnostics = await diagnostics(await status()); } catch (diagnostic) { report.failureDiagnosticsError = String(diagnostic); } }
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
  const summary = Object.fromEntries(Object.entries(report.modes).map(([mode, r]) => [mode, { status: r.status, steps: r.steps?.map((s) => `${s.phase}:${s.status}${s.verdict ? "/" + s.verdict : ""}`), file: r.fileContent, brief: r.brief, terminal: r.terminal?.state, error: r.error }]));
  console.log(JSON.stringify({ status: report.status, output, checks: report.checks, modes: summary, error: report.error, cleanupError: report.cleanupError, focusError: report.focusError, survivors: report.survivors }, null, 2));
  if (report.status !== "PASSED") process.exitCode = 1;
}
