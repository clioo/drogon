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
import { runAcceptanceProcess as exec, scrubInheritedDispatchBindings, startAcceptanceProcess as start, stopAcceptanceProcess as stop } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { startForegroundObservation, verifyForegroundObservation } from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { bundledRuntimeDestination } from "./mentu-runtime-provision.mjs";

// This journey owns a disposable daemon: drop the parent dispatch context so
// its CLI never presents a foreign credential to its own daemon.
scrubInheritedDispatchBindings();

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
  // The header shows the selected worktree's path once the switch landed;
  // only then does the tab strip belong to this workspace.
  await page.getByText(workspace, { exact: true }).first().waitFor({ timeout: 30000 });
  await Promise.race([
    page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor({ timeout: 5000 }).catch(() => {}),
    page.getByRole("heading", { name: "Start a session" }).waitFor({ timeout: 5000 }).catch(() => {}),
  ]);
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
const BAD_MODEL = "openai-codex/does-not-exist-model";
const runButton = () => page.getByTestId("orchestrator-run-workflow");
async function runState() { return { disabled: await runButton().isDisabled(), title: await runButton().getAttribute("title") }; }
const flowZoom = () => page.evaluate(() => document.querySelector('[data-testid="orchestrator-flow"]')?.getAttribute("style") ?? null);
/** Opens the Fit view menu and picks one item, waiting for the menu to
 *  settle both ways: a Radix item closes the menu on click, and a reopen
 *  during that close animation is swallowed. */
async function fitViewMenu(testId) {
  const item = page.getByTestId(testId);
  await until(async () => {
    if (!(await item.isVisible().catch(() => false))) {
      await page.getByTestId("orchestrator-fit-view").click();
    }
    return item.isVisible().catch(() => false);
  }, `Fit view menu offers ${testId}`, 15000, 200);
  await item.click();
  await item.waitFor({ state: "hidden", timeout: 10000 });
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

  // --- Leg 0: the controls the mode runs never touch, without inference. ---
  {
    workspaceName = "modes-controls";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await openOrchestrator();
    const controls = report.controls = {};
    // Run stays disabled with an honest reason until the task and its runtime exist.
    controls.emptyPrompt = await runState();
    assert.equal(controls.emptyPrompt.disabled, true);
    assert.equal(controls.emptyPrompt.title, "Describe the main task first.");
    assert.equal((await page.getByTestId("orchestrator-no-subagents-caption").innerText()).trim(), "Direct mode · main agent works without subagents");
    await panel().getByRole("textbox", { name: "Main task" }).fill("Exercise the controls");
    await until(async () => (await graph()).intent.nodes.find((n) => n.id === "orchestrator-main")?.prompt === "Exercise the controls", "controls prompt autosave", 15000);
    controls.noModel = await runState();
    assert.equal(controls.noModel.title, "Choose a model for the main task.");
    await selectHarness("main-task-harness", "Pi");
    await pickModel("main-task", MODEL);
    await until(async () => !(await runState()).disabled, "Run enabled once the runtime is chosen", 15000);
    await until(async () => (await page.getByTestId("orchestrator-save-status").innerText()).trim() === "Saved automatically", "autosave settles to Saved automatically", 15000);
    report.checks.push("run-button-explains-why-it-is-disabled-until-task-and-runtime-exist");
    // Approved runtimes: order, bounds, removal; fallback set and cleared; the summary tells the truth.
    const summary = () => panel().getByTestId("subagent-policy-summary").innerText().then((t) => t.trim());
    assert.equal(await summary(), "0 approved · 0 fallback · Direct");
    await panel().getByTestId("add-approved-runtime").click();
    await panel().getByTestId("approved-runtime-row-0").waitFor();
    assert.equal(await panel().getByTestId("approved-runtimes-list").getByTestId("approved-runtime-row-0").count(), 1, "rows live inside the approved-runtimes list");
    await selectHarness("approved-runtime-0-harness", "Pi");
    await pickModel("approved-runtime-0", MODEL);
    await panel().getByTestId("add-approved-runtime").click();
    await panel().getByTestId("approved-runtime-row-1").waitFor();
    await selectHarness("approved-runtime-1-harness", "Pi");
    await pickModel("approved-runtime-1", BAD_MODEL);
    await waitPolicy((p) => p.approvedRuntimes.map((r) => r.model).join() === `${MODEL},${BAD_MODEL}`, "two approved runtimes");
    assert.equal(await summary(), "2 approved · 0 fallback · Direct");
    assert.equal(await panel().getByTestId("approved-runtime-0-up").isDisabled(), true, "first row cannot move up");
    assert.equal(await panel().getByTestId("approved-runtime-1-down").isDisabled(), true, "last row cannot move down");
    await panel().getByTestId("approved-runtime-1-up").click();
    await waitPolicy((p) => p.approvedRuntimes.map((r) => r.model).join() === `${BAD_MODEL},${MODEL}`, "reordered");
    await panel().getByTestId("approved-runtime-0-down").click();
    await waitPolicy((p) => p.approvedRuntimes.map((r) => r.model).join() === `${MODEL},${BAD_MODEL}`, "reordered back");
    await panel().getByTestId("approved-runtime-1-remove").click();
    await waitPolicy((p) => p.approvedRuntimes.length === 1 && p.approvedRuntimes[0].model === MODEL, "second runtime removed");
    await panel().getByTestId("fallback-runtime-harness").click();
    const harnesses = await page.getByRole("option").allInnerTexts();
    assert.ok(harnesses.includes("Pi"), `the fallback harness list is the real host catalog: ${harnesses.join(", ")}`);
    await page.getByRole("option", { name: "Pi", exact: true }).click();
    await panel().getByTestId("fallback-runtime-row").waitFor();
    await waitPolicy((p) => p.fallbackRuntime?.harness === "pi", "fallback harness");
    await pickModel("fallback-runtime", MODEL);
    await waitPolicy((p) => p.fallbackRuntime?.model === MODEL, "fallback model");
    assert.equal(await summary(), "1 approved · 1 fallback · Direct");
    await panel().getByTestId("fallback-runtime-remove").click();
    await waitPolicy((p) => p.fallbackRuntime === null, "fallback removed");
    assert.equal(await summary(), "1 approved · 0 fallback · Direct");
    report.checks.push("approved-runtimes-reorder-remove-and-fallback-set-clear-write-through-with-an-honest-summary");
    // Adversarial: loop nodes, repeat caption, iteration bounds 1..10.
    await panel().getByTestId("adversarial-toggle").click();
    await waitPolicy((p) => p.adversarial.enabled, "adversarial on");
    await page.getByTestId("orchestrator-test-node").waitFor();
    await page.getByTestId("orchestrator-review-node").waitFor();
    await page.getByTestId("orchestrator-depth-one-workers").waitFor();
    await page.getByTestId("orchestrator-flow-sequence").waitFor();
    // The loop's own back edge, named for a screen reader.
    assert.equal(await page.getByLabel("Return to adversarial testing when findings remain").count(), 1);
    assert.equal((await page.getByTestId("orchestrator-repeat-caption").innerText()).trim(), "Repeat up to 3×");
    const iterations = () => panel().getByTestId("adversarial-max-iterations-value").innerText().then((t) => Number(t.trim()));
    for (let i = 0; i < 12 && !(await panel().getByTestId("adversarial-max-iterations-increase").isDisabled()); i++) { await panel().getByTestId("adversarial-max-iterations-increase").click(); await delay(120); }
    assert.equal(await iterations(), 10);
    assert.equal(await panel().getByTestId("adversarial-max-iterations-increase").isDisabled(), true, "10 is the ceiling");
    await waitPolicy((p) => p.adversarial.maxIterations === 10, "ceiling saved");
    assert.equal((await page.getByTestId("orchestrator-repeat-caption").innerText()).trim(), "Repeat up to 10×");
    for (let i = 0; i < 12 && !(await panel().getByTestId("adversarial-max-iterations-decrease").isDisabled()); i++) { await panel().getByTestId("adversarial-max-iterations-decrease").click(); await delay(120); }
    assert.equal(await iterations(), 1);
    assert.equal(await panel().getByTestId("adversarial-max-iterations-decrease").isDisabled(), true, "1 is the floor");
    await waitPolicy((p) => p.adversarial.maxIterations === 1, "floor saved");
    report.checks.push("adversarial-design-shows-both-loop-roles-and-bounds-iterations-to-1..10");
    // Delegate and Adversarial exclude each other; each design has its own caption and summary.
    await panel().getByTestId("delegate-toggle").click();
    await waitPolicy((p) => p.delegate && !p.adversarial.enabled, "delegate replaces adversarial");
    assert.equal(await page.getByTestId("orchestrator-test-node").count(), 0);
    assert.equal((await page.getByTestId("orchestrator-no-subagents-caption").innerText()).trim(), "Delegate mode · depth-1 implementation workers");
    assert.equal(await summary(), "1 approved · 0 fallback · Delegate · Depth 1");
    await panel().getByTestId("adversarial-toggle").click();
    await waitPolicy((p) => p.adversarial.enabled && !p.delegate, "adversarial replaces delegate");
    await panel().getByTestId("adversarial-toggle").click();
    await waitPolicy((p) => !p.adversarial.enabled && !p.delegate, "both off");
    report.checks.push("delegate-and-adversarial-exclude-each-other-in-the-saved-policy");
    // Fit view menu: zoom in/out and reset act on the flow.
    assert.equal(await flowZoom(), "zoom: 1;");
    await fitViewMenu("orchestrator-zoom-in");
    await until(async () => (await flowZoom()) === "zoom: 1.1;", "zoom in", 5000);
    await fitViewMenu("orchestrator-zoom-out");
    await until(async () => (await flowZoom()) === "zoom: 1;", "zoom out", 5000);
    await fitViewMenu("orchestrator-zoom-in");
    await until(async () => (await flowZoom()) === "zoom: 1.1;", "zoom in again", 5000);
    await fitViewMenu("orchestrator-fit-view-reset");
    await until(async () => (await flowZoom()) === "zoom: 1;", "fit view reset", 5000);
    report.checks.push("fit-view-menu-zooms-and-resets-the-flow");
    // Evidence and Usage views start honest: nothing recorded, nothing counted as zero.
    const pane = page.getByTestId("work-graph-pane");
    assert.equal(await page.getByRole("tablist", { name: "Work Graph views" }).count(), 1);
    await pane.getByRole("tab", { name: /Evidence/ }).click();
    await page.getByTestId("work-graph-evidence-empty").waitFor();
    await pane.getByRole("tab", { name: "Usage", exact: true }).click();
    assert.match(await page.getByTestId("work-graph-usage-view").innerText(), /No agent has reported token usage yet\. Missing usage is never counted as zero\./);
    await pane.getByRole("tab", { name: "Graph", exact: true }).click();
    report.checks.push("evidence-and-usage-views-start-empty-and-honest");
    await shot("controls");
  }

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
  {
    const pane = page.getByTestId("work-graph-pane");
    await pane.getByRole("tab", { name: /Evidence/ }).click();
    await page.getByTestId("work-graph-evidence-view").waitFor();
    const evidenceText = await page.getByTestId("work-graph-evidence-view").innerText();
    const firstSummary = adversarial.evidence[0]?.split(" — ")[1]?.slice(0, 40);
    assert.ok(firstSummary && evidenceText.includes(firstSummary), `the Evidence view shows what the agents recorded: ${evidenceText.slice(0, 300)}`);
    await pane.getByRole("tab", { name: "Usage", exact: true }).click();
    assert.match(await page.getByTestId("work-graph-usage-view").innerText(), /No agent has reported token usage yet/);
    await pane.getByRole("tab", { name: "Graph", exact: true }).click();
    await shot("adversarial-evidence");
    report.checks.push("evidence-view-lists-the-real-run-checkpoints-and-usage-stays-unreported");
    await page.reload();
    await openOrchestrator();
    await until(async () => /Last run: Ready to merge/.test(await page.getByTestId("orchestrator-terminal").innerText()), "receipt survives a reload", 30000);
    report.checks.push("durable-receipt-survives-a-reload");
  }
  report.checks.push("adversarial-mode-runs-the-daemon-owned-test-review-loop-to-a-verdict");
  // --- Leg 4: Stop mid-run, then Resume, through the real buttons. ---
  {
    workspaceName = "modes-stop";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await openOrchestrator();
    const prompt = "In this git repository, create a file named stop.txt at the repository root containing exactly one line: hola stop\nBefore creating it, run: sleep 45\nDo not create or modify any other file and do not commit. Then report done.";
    await panel().getByRole("textbox", { name: "Main task" }).fill(prompt);
    await until(async () => (await graph()).intent.nodes.find((n) => n.id === "orchestrator-main")?.prompt === prompt, "stop prompt autosave", 15000);
    await selectHarness("main-task-harness", "Pi");
    await pickModel("main-task", MODEL);
    await until(async () => !(await runState()).disabled, "stop leg ready", 15000);
    const before = await status();
    await runButton().click();
    const started = await until(async () => { const r = await status(); return r && r.id !== before?.id && r; }, "stop leg run started", 30000);
    await until(async () => (await status())?.steps?.[0]?.status === "running", "main step running", 60000, 500);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const stopped = await until(async () => { const r = await status(); return r?.id === started.id && r.status !== "running" && r.status !== "stopping" && r; }, "run stopped", 60000, 500);
    assert.equal(stopped.status, "stopped", JSON.stringify(stopped));
    await until(async () => (await page.getByTestId("orchestrator-terminal").getAttribute("data-state")) === "stopped", "receipt reads stopped", 20000);
    assert.equal((await page.getByTestId("orchestrator-terminal").innerText()).trim(), "Last run: stopped");
    await shot("stopped");
    await page.getByRole("button", { name: "Resume run", exact: true }).click();
    const resumed = await until(async () => { const r = await status(); return r?.id === started.id && r.status !== "running" && r.status !== "stopping" && r; }, "resumed run finished", RUN_TIMEOUT_MS, 1000);
    assert.equal(resumed.status, "passed", JSON.stringify(resumed));
    assert.deepEqual(resumed.steps.map((s) => `${s.phase}:${s.status}`), ["main:stopped", "main:succeeded"]);
    assert.equal((await readFile(path.join(workspace, "stop.txt"), "utf8")).trim(), "hola stop");
    await until(async () => (await page.getByTestId("orchestrator-terminal").getAttribute("data-state")) === "ready", "receipt ready after resume", 20000);
    report.modes.stopResume = { runId: started.id, stopped: stopped.steps.map((s) => `${s.phase}:${s.status}`), resumed: resumed.steps.map((s) => `${s.phase}:${s.status}`) };
    await shot("resumed");
    report.checks.push("stop-halts-the-running-main-step-and-resume-finishes-the-same-run");
  }

  // --- Leg 5: role failover — a dead approved runtime first, the real one second. ---
  {
    workspaceName = "modes-failover";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await openOrchestrator();
    const prompt = "In this git repository, create a file named failover.txt at the repository root containing exactly one line: hola failover\nDo not create or modify any other file and do not commit. Then report done.";
    await panel().getByRole("textbox", { name: "Main task" }).fill(prompt);
    await until(async () => (await graph()).intent.nodes.find((n) => n.id === "orchestrator-main")?.prompt === prompt, "failover prompt autosave", 15000);
    await selectHarness("main-task-harness", "Pi");
    await pickModel("main-task", MODEL);
    for (const [index, model] of [[0, BAD_MODEL], [1, MODEL]]) {
      await panel().getByTestId("add-approved-runtime").click();
      await panel().getByTestId(`approved-runtime-row-${index}`).waitFor();
      await selectHarness(`approved-runtime-${index}-harness`, "Pi");
      await pickModel(`approved-runtime-${index}`, model);
    }
    await waitPolicy((p) => p.approvedRuntimes.map((r) => r.model).join() === `${BAD_MODEL},${MODEL}`, "failover policy");
    await panel().getByTestId("adversarial-toggle").click();
    await waitPolicy((p) => p.adversarial.enabled, "failover adversarial on");
    while (Number((await panel().getByTestId("adversarial-max-iterations-value").innerText()).trim()) > 1) await panel().getByTestId("adversarial-max-iterations-decrease").click();
    await waitPolicy((p) => p.adversarial.maxIterations === 1, "one cycle");
    assert.equal(await page.getByTestId("orchestrator-runtime-disclosure").count(), 0);
    const before = await status();
    await runButton().click();
    const started = await until(async () => { const r = await status(); return r && r.id !== before?.id && r; }, "failover run started", 30000);
    const done = await until(async () => { const r = await status(); return r?.id === started.id && r.status !== "running" && r.status !== "stopping" && r; }, "failover run finished", RUN_TIMEOUT_MS, 1000);
    assert.equal(done.status, "passed", JSON.stringify(done));
    for (const step of done.steps.slice(1)) {
      assert.deepEqual(step.attempts.map((a) => `${a.model}:${a.outcome}`), [`${BAD_MODEL}:failed`, `${MODEL}:succeeded`], JSON.stringify(step));
      assert.match(step.attempts[0].reason ?? "", /does-not-exist-model/, "the dead runtime's own words are recorded");
    }
    await until(async () => /Last run: Ready to merge/.test(await page.getByTestId("orchestrator-terminal").innerText()), "failover receipt", 30000);
    for (const node of ["orchestrator-test-node", "orchestrator-review-node"]) {
      const text = await page.getByTestId(node).innerText();
      assert.ok(text.includes("2 runtime attempts") && text.includes(MODEL), `${node} shows the failover: ${text}`);
    }
    report.modes.failover = { runId: started.id, steps: done.steps.map((s) => ({ phase: s.phase, attempts: s.attempts.map((a) => `${a.model}:${a.outcome}`) })) };
    await shot("failover");
    report.checks.push("role-failover-tries-approved-runtimes-in-order-and-the-loop-nodes-show-every-attempt");
  }

  // --- Leg 6: a main runtime that cannot run — the receipt says so, with the runtime's reason, and survives a reload. ---
  {
    workspaceName = "modes-failed";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await openOrchestrator();
    await panel().getByRole("textbox", { name: "Main task" }).fill("Create bad.txt with one line: hola bad");
    await until(async () => (await graph()).intent.nodes.find((n) => n.id === "orchestrator-main")?.prompt.startsWith("Create bad.txt"), "failed prompt autosave", 15000);
    await selectHarness("main-task-harness", "Pi");
    await pickModel("main-task", BAD_MODEL);
    await until(async () => !(await runState()).disabled, "failed leg ready", 15000);
    const before = await status();
    await runButton().click();
    const started = await until(async () => { const r = await status(); return r && r.id !== before?.id && r; }, "failed run started", 30000);
    const done = await until(async () => { const r = await status(); return r?.id === started.id && r.status !== "running" && r.status !== "stopping" && r; }, "failed run finished", 5 * 60 * 1000, 1000);
    assert.equal(done.status, "failed", JSON.stringify(done));
    await until(async () => (await page.getByTestId("orchestrator-terminal").getAttribute("data-state")) === "failed", "receipt reads failed", 20000);
    const receipt = await page.getByTestId("orchestrator-terminal").innerText();
    assert.match(receipt, /Last run: failed/);
    assert.match(receipt, /Every configured runtime failed to execute this role\./);
    const reason = await page.getByTestId("orchestrator-terminal-reason").innerText();
    assert.match(reason, /does-not-exist-model/, `the receipt carries the runtime's own reason: ${reason}`);
    assert.equal((await runState()).disabled, false, "Run stays available after a failure");
    await shot("failed");
    await page.reload();
    await openOrchestrator();
    await until(async () => /Last run: failed/.test(await page.getByTestId("orchestrator-terminal").innerText()), "failed receipt survives a reload", 30000);
    assert.match(await page.getByTestId("orchestrator-terminal-reason").innerText(), /does-not-exist-model/);
    report.modes.failed = { runId: started.id, error: done.error, reason: reason.slice(0, 300) };
    report.checks.push("a-dead-main-runtime-fails-fast-with-the-runtimes-own-reason-on-the-receipt-and-survives-reload");
  }
  // --- Leg 7: the sidebar's own Work Graph panel is a real entry point. ---
  {
    workspaceName = "modes-sidebar";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
    const card = page.getByRole("button", { name: `Select ${workspaceName}`, exact: true });
    await card.waitFor({ timeout: 30000 });
    await card.click();
    await page.getByText(workspace, { exact: true }).first().waitFor({ timeout: 30000 });
    // The right sidebar's Work Graph activity item, then its Open button —
    // the path a user takes without the New tab menu.
    await page.getByRole("button", { name: "Work Graph", exact: true }).click();
    await page.getByTestId("work-graph-panel").waitFor();
    await page.getByRole("button", { name: "Open Work Graph", exact: true }).click();
    await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
    await page.getByTestId("orchestrator-canvas").waitFor();
    await panel().waitFor();
    report.checks.push("the-sidebar-work-graph-panel-opens-the-orchestrator-tab");
    await shot("sidebar-entry");
  }

  // --- Leg 8: the Main agent node and its inspector, against a real session. ---
  {
    workspaceName = "modes-inspector";
    const worktree = await cliJson(["worktree", "create", "--project", projectId, "--name", workspaceName, "--no-parent"], { cwd: fixture });
    workspace = worktree.path; workspaceId = worktree.workspaceId;
    await openOrchestrator();
    // No session yet: the node says so instead of claiming an agent.
    assert.equal(await page.getByTestId("orchestrator-main-agent").getAttribute("data-state"), "no-session");
    const session = await cliJson(["harness", "start", "--workspace", workspaceId, "--harness", "claude", "--permission-mode", "unattended"]);
    // No reload: a session started out of band (this CLI, a Bot, another
    // window) must reach this view on its own, from the host-wide poll the
    // sidebar already reads. It used to appear only on the next load, so
    // the sidebar showed a session while this node said there was none.
    const node = page.getByTestId("orchestrator-main-agent");
    await until(async () => (await node.getAttribute("data-state")) === "live", "the node projects the real live session without a reload", 60000);
    assert.match(await node.innerText(), /Main agent/);
    assert.equal(await page.getByLabel("Main agent, live. Open inspector.").count(), 1);
    await node.click();
    const inspector = page.getByTestId("main-agent-inspector");
    await inspector.waitFor();
    assert.match(await inspector.getByTestId("main-agent-harness-locked").innerText(), /harness cannot change/);
    assert.match(await inspector.getByTestId("main-agent-delete-refused").innerText(), /cannot be deleted from here/);
    const stopButton = inspector.getByTestId("main-agent-stop-session");
    assert.equal(await stopButton.isDisabled(), false, "a live session offers the honest stop action");
    await shot("inspector-live");
    // The stop action is real: the daemon reports the session exited.
    await stopButton.click();
    // Close the popover so reopening it below is a fresh open, not a toggle.
    await page.keyboard.press("Escape");
    await inspector.waitFor({ state: "hidden" });
    const exited = await until(async () => {
      const listed = await cliJson(["terminal", "list", "--workspace", workspaceId]);
      const row = listed.sessions.find((item) => item.id === session.id);
      return (!row || row.verdict === "exited") && (row ?? { verdict: "exited" });
    }, "the daemon reports the session exited", 60000, 500);
    report.modes.inspector = { sessionId: session.id, verdict: exited.verdict };
    await until(async () => (await node.getAttribute("data-state")) === "exited", "the node says exited once it is", 30000);
    assert.match(await node.innerText(), /This session has exited/);
    await node.click();
    await inspector.waitFor();
    assert.match(await inspector.innerText(), /Harness/);
    assert.equal(await inspector.getByTestId("main-agent-stop-session").count(), 0, "nothing left to stop");
    assert.match(await inspector.innerText(), /there is nothing to stop/);
    await shot("inspector-exited");
    report.checks.push("main-agent-inspector-locks-the-harness-refuses-deletion-and-really-stops-the-session");
  report.checks.push("a-session-started-out-of-band-reaches-the-open-workspace-without-a-reload");
  }
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
