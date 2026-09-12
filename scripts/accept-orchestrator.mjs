// MIT Copyright (c) 2026 Lovecast Inc.
//
// The Orchestrator (Subagent policy panel + canvas), proven on the REAL
// app over CDP in a background window (never the developer's own Drogon):
//
//   1. a workspace with NO session yet renders the Orchestrator honestly
//      disabled ("Start a session to enable the orchestrator") — never an
//      empty canvas that looks broken;
//   2. a real session (a fixture harness, never paid inference) makes the
//      Main agent node show its REAL harness, live;
//   3. the Subagent policy panel: adding an approved runtime, editing the
//      fallback, and toggling Delegate all write through the real
//      `graph.write_intent` seam — the probe reads `.drogon/graph.json`
//      from disk and proves the exact policy landed, with the `state`
//      half untouched;
//   4. screenshots of BOTH designs (adversarial off / on) in light AND
//      dark at 1440/1100/900/760, no horizontal overflow, plus the
//      no-session disabled state;
//   5. Run workflow goes through the real `graph.run_node_failover` path —
//      this dev daemon has no real provider configured, so the honest,
//      deterministic outcome is a launch refusal (proving the "designed
//      but never run" -> real-attempt distinction, not a fabricated
//      success).
//
// Background window only: DROGON_BACKGROUND_WINDOW=1, its own
// DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE, no focus call of any kind.
// Run: node scripts/accept-orchestrator.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";
import { writeAgentSettingsFixtures } from "./probe-agent-settings.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const appRequire = createRequire(path.join(appDir, "package.json"));
const electron = appRequire("electron");
const drogon = path.join(root, "target", "debug", "drogond");
const cli = path.join(root, "target", "debug", "drogon-cli");

const WIDTHS = [1440, 1100, 900, 760];

const run = async (file, args, options) => {
  try {
    return await runAcceptanceProcess(file, args, options);
  } catch (error) {
    throw new Error(
      `${path.basename(file)} ${args.join(" ")} failed: ${error.stdout || ""}${error.stderr || error.message}`,
    );
  }
};

const cliJson = async (dataDir, args, options = { timeout: 20000 }) => {
  const { stdout } = await run(cli, ["--data-dir", dataDir, "--json", ...args], options);
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true, `drogon-cli ${args.join(" ")}: ${stdout}`);
  return envelope.result;
};

const desktopPids = [];
const survivors = [];
let desktop = null;
let daemon = null;
let browser = null;
let dataDir = null;
let desktopRunning = false;

async function pidsForDataDir() {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,command="]);
  return stdout
    .split("\n")
    .filter((line) => line.includes(dataDir) && !line.includes("accept-orchestrator"))
    .map((line) => Number.parseInt(line.trim().split(/\s+/)[0], 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

async function stopOwnedByDataDir(label) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const pids = await pidsForDataDir();
    if (pids.length === 0) return;
    if (Date.now() >= deadline) {
      survivors.push(`${label}: still alive after SIGTERM: ${pids.join(",")}`);
      return;
    }
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone between listing and signalling.
      }
    }
    await delay(250);
  }
}

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // A dead CDP socket is not a leak.
    }
  }
  if (desktop) {
    const result = await stopAcceptanceProcess(desktop);
    desktopRunning = result.verdict !== "exited";
  }
  if (daemon) await stopAcceptanceProcess(daemon);
  await stopOwnedByDataDir("daemon-or-runtime");
  const remaining = await pidsForDataDir();
  if (remaining.length > 0) survivors.push(`post-cleanup survivors: ${remaining.join(",")}`);
}

const startedAt = new Date().toISOString();
const report = {
  kind: "orchestrator",
  status: "FAILED",
  startedAt,
  checks: [],
  screenshots: [],
  processes: { desktopPids },
  cleanup: [],
  survivors,
};

async function shot(page, name) {
  const file = path.join(report.output, name.endsWith(".png") ? name : `${name}.png`);
  const png = await page.screenshot({ path: file, animations: "disabled", timeout: 15000 });
  report.screenshots.push({ name, file, sha256: createHash("sha256").update(png).digest("hex") });
  return file;
}

async function readGraph(workspace) {
  return JSON.parse(await readFile(path.join(workspace, ".drogon", "graph.json"), "utf8"));
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 0, `${label} must not scroll horizontally (overflow ${overflow}px)`);
}

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), "orch-"));
  dataDir = path.join(fixture, "data");
  report.dataDir = dataDir;
  const workspace = path.join(fixture, "folder");
  report.output =
    process.env.ORCHESTRATOR_OUT ??
    path.join(root, ".preflight", "acceptance", `orchestrator-${Date.now()}`);
  await mkdir(report.output, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const fixtureBin = path.join(fixture, "bin");
  await mkdir(fixtureBin, { recursive: true });
  await writeAgentSettingsFixtures(fixtureBin);
  report.fixture = fixture;
  report.workspace = workspace;

  // 1. Start the daemon this probe owns and register the workspace. No
  //    session yet — the Orchestrator must render honestly disabled.
  // Methodology correction (graph-e2e-adversarial audit): the DAEMON, not
  // only the desktop process below, resolves and spawns harness
  // executables for `harness.start` — an unstubbed daemon PATH can silently
  // launch a REAL, possibly paid, catalog binary instead of the fixture.
  // Stub it here identically to the desktop's PATH so every harness this
  // probe launches (including the Delegate-brief checks below) is the
  // fixture, never a real install.
  daemon = startAcceptanceProcess(drogon, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH}` },
  });
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await cliJson(dataDir, ["status"]);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(200);
    }
  }
  const registered = await cliJson(dataDir, ["project", "add", workspace, "--name", "orch-a11y"]);
  report.projectId = registered.id;
  // `project add` registers the project; its IMPLICIT workspace (the id
  // `harness start` needs) is a separate id, found by matching the path.
  const workspaceList = await cliJson(dataDir, ["workspace", "list"]);
  const workspaceRecord = workspaceList.workspaces.find((w) => w.name === "orch-a11y");
  assert.ok(workspaceRecord, `no workspace registered named orch-a11y: ${JSON.stringify(workspaceList)}`);
  report.workspaceId = workspaceRecord.id;

  // 2. Launch the real app in a background window and attach over CDP.
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
      PATH: `${fixtureBin}:${process.env.PATH}`,
    },
  });
  desktopPids.push(desktop.pid);
  report.desktopStderr = "";
  desktop.stderr.on("data", (bytes) => {
    report.desktopStderr += bytes.toString();
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 30000);
    desktop.once("exit", () => reject(new Error(`electron exited: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page = browser.contexts()[0]?.pages()[0];
  for (let i = 0; i < 200 && !page; i++) {
    await delay(50);
    page = browser.contexts()[0]?.pages()[0];
  }
  page.setDefaultTimeout(20000);
  report.consoleErrors = [];
  page.on("pageerror", (error) => report.consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" || process.env.ORCHESTRATOR_DEBUG)
      report.consoleErrors.push(`[${message.type()}] ${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  report.checks.push("app-launched-in-background-window");

  await page.getByRole("button", { name: "Select orch-a11y" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Select orch-a11y" }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
  const panel = page.locator('[data-testid="mentu-tab-panel"]');

  // 3. No session yet: the Orchestrator button is reachable (an empty
  //    graph is safe to start from) and the canvas shows the honest
  //    disabled state, never a broken-looking empty canvas.
  const orchestratorButton = panel.locator('[data-testid="work-graph-orchestrator"]');
  await orchestratorButton.waitFor({ timeout: 15000 });
  // A brand-new workspace's read starts as "loading" before settling to
  // the honest "missing" (no graph.json yet) — the button is disabled only
  // during that brief window, never once settled.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="work-graph-orchestrator"]')?.getAttribute("disabled") === null,
    undefined,
    { timeout: 15000 },
  );
  await orchestratorButton.click();
  const canvas = panel.locator('[data-testid="orchestrator-canvas"]');
  await canvas.waitFor();
  const disabledState = panel.locator('[data-testid="orchestrator-disabled"]');
  await disabledState.waitFor({ timeout: 10000 });
  assert.match(
    (await disabledState.innerText()) ?? "",
    /Start a session to enable the orchestrator/,
  );
  await shot(page, "orchestrator-no-session-light-1440.png");
  report.checks.push("orchestrator-honestly-disabled-with-no-session");

  // 4. Start a real session (fixture harness, never paid inference). The
  //    daemon's own session list is what `pickMentuMainSession` reads —
  //    no UI tab is required for the renderer to see it.
  const session = await cliJson(dataDir, [
    "harness",
    "start",
    "--workspace",
    workspaceRecord.id,
    "--harness",
    "claude",
    "--permission-mode",
    "unattended",
  ]);
  report.sessionId = session.id;
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
  await orchestratorButton.waitFor({ timeout: 15000 });
  await orchestratorButton.click();
  await canvas.waitFor();
  const mainAgent = panel.locator('[data-testid="orchestrator-main-agent"]');
  await mainAgent.waitFor({ timeout: 15000 });
  assert.equal(await mainAgent.getAttribute("data-state"), "live");
  assert.match((await mainAgent.innerText()) ?? "", /claude/);
  report.checks.push("main-agent-node-reflects-the-real-live-session");

  // 5. The Subagent policy panel writes through the real graph.write_intent
  //    seam: add an approved runtime, edit the fallback, toggle Delegate.
  const policyPanel = panel.locator('[data-testid="subagent-policy-panel"]');
  await policyPanel.waitFor();
  await policyPanel.locator('[data-testid="add-approved-runtime"]').click();
  await policyPanel.locator('[data-testid="approved-runtime-row-0"]').waitFor();
  await policyPanel.locator('[data-testid="delegate-toggle"]').click();
  await delay(400); // the save is fire-and-forget from a change handler
  const withPolicy = await readGraph(workspace);
  assert.equal(withPolicy.intent.policy.approvedRuntimes.length, 1, JSON.stringify(withPolicy.intent.policy));
  assert.equal(withPolicy.intent.policy.delegate, true);
  assert.equal(withPolicy.state.nodes.length, 0, "the policy write must never touch state");
  report.checks.push("subagent-policy-writes-through-graph-write-intent-only");

  // 5b. DISHONEST-3 (Delegate must be delivered): flipping Delegate must
  //     change what the NEXT session in this workspace actually receives —
  //     not only `intent.policy.delegate` on disk and the skill guide's
  //     prose. The session started in step 4 (already live before Delegate
  //     was toggled) must be left alone; a freshly launched one must carry
  //     the current policy in its own `AGENTS.md`, the exact seam every
  //     harness reads in its own cwd at session start.
  await cliJson(dataDir, [
    "harness",
    "start",
    "--workspace",
    workspaceRecord.id,
    "--harness",
    "claude",
    "--permission-mode",
    "unattended",
  ]);
  const agentsWithDelegateOn = await readFile(path.join(workspace, "AGENTS.md"), "utf8");
  assert.match(agentsWithDelegateOn, /Delegate: ON/, agentsWithDelegateOn);
  assert.ok(
    agentsWithDelegateOn.includes(
      `drogon-cli graph write-intent --workspace ${workspaceRecord.id} --file graph-intent.json`,
    ),
    `the Delegate brief must name the real, workspace-scoped write-intent verb: ${agentsWithDelegateOn}`,
  );
  report.checks.push("delegate-on-reaches-the-next-sessions-own-agents-md");

  await policyPanel.locator('[data-testid="delegate-toggle"]').click();
  await delay(400);
  assert.equal((await readGraph(workspace)).intent.policy.delegate, false);
  await cliJson(dataDir, [
    "harness",
    "start",
    "--workspace",
    workspaceRecord.id,
    "--harness",
    "claude",
    "--permission-mode",
    "unattended",
  ]);
  const agentsWithDelegateOff = await readFile(path.join(workspace, "AGENTS.md"), "utf8");
  assert.match(agentsWithDelegateOff, /Delegate: OFF/, agentsWithDelegateOff);
  assert.match(
    agentsWithDelegateOff,
    /Single node: do the work directly in this session\./,
    agentsWithDelegateOff,
  );
  assert.ok(
    !agentsWithDelegateOff.includes("Delegate: ON"),
    `a stale Delegate-ON instruction must never survive the flip: ${agentsWithDelegateOff}`,
  );
  report.checks.push(
    "delegate-off-reaches-the-next-sessions-own-agents-md-and-drops-the-stale-on-instruction",
  );

  // 6. Design 1: adversarial off — screenshots light + dark, every width.
  const summary = policyPanel.locator('[data-testid="subagent-policy-summary"]');
  await summary.waitFor();
  assert.match((await summary.innerText()) ?? "", /0 optional subagents/);
  assert.equal(await panel.locator('[data-testid="orchestrator-test-node"]').count(), 0);
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
    // The Settings detour remounts the Mentu surfaces (same as
    // accept-workflow-adversarial.mjs's own note), so the pane is back in
    // its default read-only view; re-enter the Orchestrator each time.
    if ((await panel.locator('[data-testid="orchestrator-canvas"]').count()) === 0) {
      await orchestratorButton.waitFor({ timeout: 15000 });
      await orchestratorButton.click();
    }
    await canvas.waitFor();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(page, `orchestrator design-1 ${theme} ${width}px`);
      await shot(page, `orchestrator-design1-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  report.checks.push("design-1-screenshots-light-dark-no-overflow");

  // 7. Design 2: adversarial on, max iterations 10 — the two role nodes,
  //    the repeat caption, and the summary line update for real.
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
  if ((await panel.locator('[data-testid="orchestrator-canvas"]').count()) === 0) {
    await orchestratorButton.waitFor({ timeout: 15000 });
    await orchestratorButton.click();
  }
  await canvas.waitFor();
  await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
  await policyPanel.locator('[data-testid="adversarial-max-iterations"]').waitFor();
  const maxIterationsValue = policyPanel.locator('[data-testid="adversarial-max-iterations-value"]');
  for (let i = 0; i < 20 && (await maxIterationsValue.innerText()) !== "10"; i++) {
    await policyPanel.locator('[data-testid="adversarial-max-iterations-increase"]').click();
    await delay(150);
  }
  assert.equal(await maxIterationsValue.innerText(), "10");
  await panel.locator('[data-testid="orchestrator-test-node"]').waitFor();
  await panel.locator('[data-testid="orchestrator-review-node"]').waitFor();
  assert.equal(
    (await panel.locator('[data-testid="orchestrator-repeat-caption"]').innerText()) ?? "",
    "Repeat up to 10×",
  );
  assert.match((await summary.innerText()) ?? "", /2 optional subagents/);
  const withAdversarial = await readGraph(workspace);
  assert.equal(withAdversarial.intent.policy.adversarial.enabled, true);
  assert.equal(withAdversarial.intent.policy.adversarial.maxIterations, 10);
  report.checks.push("adversarial-toggle-and-max-iterations-write-through-and-render");

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
    if ((await panel.locator('[data-testid="orchestrator-canvas"]').count()) === 0) {
      await orchestratorButton.waitFor({ timeout: 15000 });
      await orchestratorButton.click();
    }
    await canvas.waitFor();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(page, `orchestrator design-2 ${theme} ${width}px`);
      await shot(page, `orchestrator-design2-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
  if ((await panel.locator('[data-testid="orchestrator-canvas"]').count()) === 0) {
    await orchestratorButton.waitFor({ timeout: 15000 });
    await orchestratorButton.click();
  }
  await canvas.waitFor();
  report.checks.push("design-2-screenshots-light-dark-no-overflow");

  // 8. Run workflow: the real `graph.run_node_failover` path. This dev
  //    daemon has no real provider configured, so the honest outcome is a
  //    launch refusal — the terminal must show it never reached "passed",
  //    not a fabricated success.
  await panel.locator('[data-testid="orchestrator-run-workflow"]').click();
  const terminal = panel.locator('[data-testid="orchestrator-terminal"]');
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-testid="orchestrator-terminal"]');
      return node?.getAttribute("data-state") !== "never-run";
    },
    undefined,
    { timeout: 30000 },
  );
  // Let the loop's own poll (every 2s) actually attempt the launch and
  // settle past the instant "awaiting_base" snapshot, so the recorded
  // evidence is the REAL attempt outcome, not just "a ledger now exists".
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-testid="orchestrator-terminal"]');
      return (node?.textContent ?? "").length > 0 && !/Waiting for the workflow/.test(node.textContent);
    },
    undefined,
    { timeout: 20000 },
  ).catch(() => {});
  const terminalState = await terminal.getAttribute("data-state");
  assert.notEqual(terminalState, "ready", "an unconfigured dev daemon must never fabricate a pass");
  report.observedTerminalState = terminalState;
  report.observedTerminalText = (await terminal.innerText()) ?? "";
  await shot(page, "orchestrator-run-workflow-outcome.png");
  report.checks.push("run-workflow-goes-through-real-failover-and-never-fabricates-success");
}

let failure = null;
try {
  await main();
  report.status = "PASSED";
} catch (error) {
  failure = error;
  report.error = error instanceof Error ? error.stack : String(error);
}
try {
  await cleanup();
} catch (error) {
  report.cleanupError = error instanceof Error ? error.message : String(error);
}
report.desktopStopped = !desktopRunning;
report.finishedAt = new Date().toISOString();
report.cleanup = { survivors, desktopPids };
if (report.cleanupError && !failure) failure = new Error(report.cleanupError);
if (survivors.length > 0 && !failure)
  failure = new Error(`process cleanup left survivors: ${survivors.join("; ")}`);
await writeFile(path.join(report.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status: report.status,
      output: report.output,
      checks: report.checks,
      screenshots: report.screenshots.map((entry) => entry.name),
      observedTerminalState: report.observedTerminalState,
      observedTerminalText: report.observedTerminalText,
      survivors,
      error: report.error ?? null,
    },
    null,
    2,
  ),
);
if (failure) {
  console.error(failure.stack ?? String(failure));
  process.exitCode = 1;
}
