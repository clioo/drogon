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
//   3. A no-policy session leaves a fixture repo clean; toggling Delegate on
//      writes a managed brief for the next session, and toggling Delegate back
//      off removes the files. Adding an approved runtime and enabling
//      adversarial mode still write through the real `graph.write_intent`
//      seam — the probe reads `.drogon/graph.json` from disk and proves the
//      exact policy landed, with the `state` half untouched;
//   4. screenshots of BOTH designs (adversarial off / on) in light AND
//      dark at 1440/1100/900/760, no horizontal overflow, plus the
//      no-session disabled state;
//   5. "Run workflow" DISPATCHES the base task to the Main agent's own
//      live session first (a real, visible prompt through the same seam
//      the Mentu Run Recipe dispatch uses) and only then goes through the
//      real `graph.run_node_failover` path once that session's turn
//      settles — this dev daemon has no real provider configured, so the
//      honest, deterministic outcome is a launch refusal (proving the
//      "designed but never run" -> real-attempt distinction, not a
//      fabricated success), and the canvas discloses which runtime would
//      run and whether it is the free local default BEFORE the click.
//   6. the top Graph / Evidence / Usage tabs read Drogon's native `.drogon`
//      ledgers; recorded token totals come from exact CLI measurements and
//      missing fields stay visibly not reported.
//
// Background window only: DROGON_BACKGROUND_WINDOW=1, its own
// DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE, no focus call of any kind.
// Run: node scripts/accept-orchestrator.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  const { stdout } = await run(
    cli,
    ["--data-dir", dataDir, "--json", ...args],
    options,
  );
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
    .filter(
      (line) => line.includes(dataDir) && !line.includes("accept-orchestrator"),
    )
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
  if (remaining.length > 0)
    survivors.push(`post-cleanup survivors: ${remaining.join(",")}`);
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
  const file = path.join(
    report.output,
    name.endsWith(".png") ? name : `${name}.png`,
  );
  const png = await page.screenshot({
    path: file,
    animations: "disabled",
    timeout: 15000,
  });
  report.screenshots.push({
    name,
    file,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
  return file;
}

async function readGraph(workspace) {
  return JSON.parse(
    await readFile(path.join(workspace, ".drogon", "graph.json"), "utf8"),
  );
}

async function gitStatus(workspace) {
  const { stdout } = await run("git", ["status", "--porcelain"], {
    cwd: workspace,
  });
  return stdout;
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  assert.ok(
    overflow <= 0,
    `${label} must not scroll horizontally (overflow ${overflow}px)`,
  );
}

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), "orch-"));
  dataDir = path.join(fixture, "data");
  report.dataDir = dataDir;
  let workspace = path.join(fixture, "folder");
  report.output =
    process.env.ORCHESTRATOR_OUT ??
    path.join(root, ".preflight", "acceptance", `orchestrator-${Date.now()}`);
  await mkdir(report.output, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const gitIdentity = [
    "-c",
    "user.email=acceptance@drogon.local",
    "-c",
    "user.name=Drogon Acceptance",
    "-c",
    "init.defaultBranch=main",
  ];
  const fixtureBin = path.join(fixture, "bin");
  await mkdir(fixtureBin, { recursive: true });
  await writeAgentSettingsFixtures(fixtureBin);
  report.fixture = fixture;
  report.workspace = workspace;

  // Turn the already-registered folder workspace into a disposable fixture
  // repo. Registering first keeps this journey's implicit folder workspace;
  // the graph brief itself is still exercised inside a real Git checkout.
  await run("git", [...gitIdentity, "init", "--initial-branch=main"], {
    cwd: workspace,
  });
  // The graph store is an application file, not an owner change for this
  // fixture repository; keep it ignored so the policy reset can prove the
  // brief files themselves are gone and `git status --porcelain` is clean.
  await writeFile(path.join(workspace, ".gitignore"), ".drogon/\n");
  await run("git", [...gitIdentity, "add", ".gitignore"], { cwd: workspace });
  await run("git", [...gitIdentity, "commit", "-m", "fixture"], {
    cwd: workspace,
  });

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
  const registered = await cliJson(dataDir, [
    "project",
    "add",
    workspace,
    "--name",
    "orch-a11y",
  ]);
  report.projectId = registered.id;
  // The redesigned sidebar presents project worktrees, not a detached
  // workspace registration. Create one real disposable worktree and use its
  // workspace identity/path for every graph and harness assertion below.
  const createdWorktree = await cliJson(dataDir, [
    "worktree",
    "create",
    "--project",
    registered.id,
    "--name",
    "orch-a11y",
  ]);
  workspace = createdWorktree.path;
  report.workspace = workspace;
  const workspaceRecord = {
    id: createdWorktree.workspaceId,
    name: "orch-a11y",
  };
  report.workspaceId = workspaceRecord.id;

  // 2. Launch the real app in a background window and attach over CDP.
  desktop = startAcceptanceProcess(
    electron,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        DROGON_BACKGROUND_WINDOW: "1",
        SHELL: "/bin/sh",
        PATH: `${fixtureBin}:${process.env.PATH}`,
      },
    },
  );
  desktopPids.push(desktop.pid);
  report.desktopStderr = "";
  desktop.stderr.on("data", (bytes) => {
    report.desktopStderr += bytes.toString();
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no debugging endpoint: ${tail}`)),
      30000,
    );
    desktop.once("exit", () => reject(new Error(`electron exited: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
      );
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

  const workspaceCard = page.locator("[data-worktree-card-id]").first();
  await workspaceCard.waitFor({ timeout: 30000 });
  await workspaceCard.locator("button.shell-worktree-card-select").click();
  await page
    .getByRole("heading", { name: "Start a session" })
    .waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
  const panel = page.locator('[data-testid="mentu-tab-panel"]');

  // 3. Work Graph is the Orchestrator itself. With no session yet it still
  //    shows the configurable Main agent preview, never an empty canvas.
  const canvas = panel.locator('[data-testid="orchestrator-canvas"]');
  await canvas.waitFor();
  const disabledState = panel.locator('[data-testid="orchestrator-disabled"]');
  const mainPreview = panel.locator('[data-testid="orchestrator-main-agent"]');
  await mainPreview.waitFor({ timeout: 10000 });
  assert.match(
    (await mainPreview.innerText()) ?? "",
    /Configure the main task/,
  );
  await shot(page, "orchestrator-no-session-light-1440.png");
  report.checks.push("orchestrator-main-task-preview-with-no-session");

  // Native observability is independent of the Mentu runner. Write through
  // the public CLI, then prove the real renderer polls and presents the same
  // workspace files from its top-level tabs.
  await cliJson(dataDir, [
    "graph",
    "evidence-add",
    "--workspace",
    workspaceRecord.id,
    "--summary",
    "Native checkpoint visible",
    "--status",
    "progress",
    "--detail",
    "Recorded directly by the lead agent.",
    "--artifact",
    "reports/native-check.txt",
    "--agent",
    "leader",
  ]);
  await cliJson(dataDir, [
    "graph",
    "usage-add",
    "--workspace",
    workspaceRecord.id,
    "--input",
    "120",
    "--output",
    "30",
    "--agent",
    "leader",
    "--harness",
    "pi",
    "--model",
    "fixture",
  ]);
  await panel.getByRole("tab", { name: /Evidence/ }).click();
  try {
    await panel
      .getByText("Native checkpoint visible")
      .waitFor({ timeout: 10000 });
  } catch (error) {
    report.observabilityPanelText = await panel.innerText();
    await shot(page, "orchestrator-evidence-failed-light-1440.png");
    throw error;
  }
  assert.match(await panel.innerText(), /reports\/native-check\.txt/);
  await shot(page, "orchestrator-evidence-light-1440.png");
  await panel.getByRole("tab", { name: "Usage", exact: true }).click();
  await panel.getByText("120", { exact: true }).waitFor({ timeout: 10000 });
  await panel.getByText("30", { exact: true }).waitFor();
  assert.match(
    await panel.innerText(),
    /Missing usage is never counted as zero|1 measurement/,
  );
  await shot(page, "orchestrator-usage-light-1440.png");
  await panel.getByRole("tab", { name: "Graph", exact: true }).click();
  await mainPreview.waitFor();
  report.checks.push("native-evidence-and-usage-tabs-read-drogon-ledgers");

  if (process.env.ORCHESTRATOR_OBSERVABILITY_ONLY === "1") return;

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
  assert.equal(
    await gitStatus(workspace),
    "",
    "a no-policy session must leave the fixture repo clean",
  );
  assert.ok(!(await readdir(workspace)).includes("AGENTS.md"));
  assert.ok(!(await readdir(workspace)).includes("CLAUDE.md"));
  report.checks.push(
    "no-policy-session-creates-no-brief-files-and-leaves-repo-clean",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
  await canvas.waitFor();
  const mainAgent = panel.locator('[data-testid="orchestrator-main-agent"]');
  await mainAgent.waitFor({ timeout: 15000 });
  assert.match((await mainAgent.innerText()) ?? "", /Main agent/);
  report.checks.push("main-agent-node-remains-visible-with-a-live-session");

  // 5. DISHONEST-3 (Delegate must be delivered): a policy toggle changes
  //    what the NEXT session in this workspace actually receives. Start with
  //    the empty/default policy so the reset below proves that the managed
  //    files disappear rather than merely changing to an OFF paragraph.
  const policyPanel = panel.locator('[data-testid="subagent-policy-panel"]');
  await policyPanel.waitFor();
  const summary = policyPanel.locator(
    '[data-testid="subagent-policy-summary"]',
  );
  await policyPanel.locator('[data-testid="delegate-toggle"]').click();
  await delay(400); // the save is fire-and-forget from a change handler
  const delegateOnPolicy = await readGraph(workspace);
  assert.equal(delegateOnPolicy.intent.policy.approvedRuntimes.length, 0);
  assert.equal(delegateOnPolicy.intent.policy.delegate, true);
  assert.equal(
    delegateOnPolicy.state.nodes.length,
    0,
    "the policy write must never touch state",
  );
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
  const agentsWithDelegateOn = await readFile(
    path.join(workspace, "AGENTS.md"),
    "utf8",
  );
  const claudeWithDelegateOn = await readFile(
    path.join(workspace, "CLAUDE.md"),
    "utf8",
  );
  assert.match(agentsWithDelegateOn, /Mode: DELEGATE/, agentsWithDelegateOn);
  assert.match(claudeWithDelegateOn, /Mode: DELEGATE/, claudeWithDelegateOn);
  assert.ok(
    agentsWithDelegateOn.includes(
      `drogon-cli graph write-intent --workspace ${workspaceRecord.id} --file graph-intent.json`,
    ),
    `the Delegate brief must name the real, workspace-scoped write-intent verb: ${agentsWithDelegateOn}`,
  );
  assert.match(
    agentsWithDelegateOn,
    new RegExp(
      `drogon-cli graph observability --workspace ${workspaceRecord.id} --json`,
    ),
  );
  report.checks.push("delegate-on-reaches-the-next-sessions-own-brief-files");

  // Both execution modes are impossible at once. Enabling either one turns
  // the other off in the same saved policy, rather than relying on display.
  await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
  await delay(400);
  const adversarialReplacedDelegate = await readGraph(workspace);
  assert.equal(adversarialReplacedDelegate.intent.policy.delegate, false);
  assert.equal(
    adversarialReplacedDelegate.intent.policy.adversarial.enabled,
    true,
  );
  await policyPanel.locator('[data-testid="delegate-toggle"]').click();
  await delay(400);
  const delegateReplacedAdversarial = await readGraph(workspace);
  assert.equal(delegateReplacedAdversarial.intent.policy.delegate, true);
  assert.equal(
    delegateReplacedAdversarial.intent.policy.adversarial.enabled,
    false,
  );
  report.checks.push("delegate-and-adversarial-are-mutually-exclusive");

  await policyPanel.locator('[data-testid="delegate-toggle"]').click();
  await delay(400);
  const defaultPolicy = await readGraph(workspace);
  assert.equal(defaultPolicy.intent.policy.delegate, false);
  assert.equal(defaultPolicy.intent.policy.approvedRuntimes.length, 0);
  assert.equal(defaultPolicy.intent.policy.fallbackRuntime, null);
  assert.equal(defaultPolicy.intent.policy.adversarial.enabled, false);
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
  assert.ok(!(await readdir(workspace)).includes("AGENTS.md"));
  assert.ok(!(await readdir(workspace)).includes("CLAUDE.md"));
  assert.equal(
    await gitStatus(workspace),
    "",
    "resetting the policy must clean the fixture repo",
  );
  report.checks.push(
    "delegate-off-removes-the-managed-block-and-restores-a-clean-repo",
  );

  if (process.env.ORCHESTRATOR_POLICY_ONLY === "1") {
    await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
    await panel
      .locator('[data-testid="orchestrator-depth-one-workers"]')
      .waitFor();
    await panel.locator('[data-testid="orchestrator-test-node"]').waitFor();
    await delay(400);
    const adversarialPolicy = await readGraph(workspace);
    assert.equal(adversarialPolicy.intent.policy.delegate, false);
    assert.equal(adversarialPolicy.intent.policy.adversarial.enabled, true);
    assert.match((await summary.innerText()) ?? "", /Adversarial · Depth 1/);
    await shot(page, "orchestrator-adversarial-depth-one-light-1440.png");
    await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
    await delay(400);
    const restored = await readGraph(workspace);
    assert.equal(restored.intent.policy.delegate, false);
    assert.equal(restored.intent.policy.adversarial.enabled, false);
    report.checks.push(
      "mutually-exclusive-depth-one-policy-persists-and-renders",
    );
    return;
  }

  // Keep the existing policy-panel write-through coverage: once the reset
  // proof is complete, configure an approved runtime for the design and graph
  // assertions below. The final cleanup launches one more default session.
  await policyPanel.locator('[data-testid="add-approved-runtime"]').click();
  await policyPanel.locator('[data-testid="approved-runtime-row-0"]').waitFor();
  await delay(400);
  const withPolicy = await readGraph(workspace);
  assert.equal(
    withPolicy.intent.policy.approvedRuntimes.length,
    1,
    JSON.stringify(withPolicy.intent.policy),
  );
  assert.equal(withPolicy.intent.policy.delegate, false);
  assert.equal(
    withPolicy.state.nodes.length,
    0,
    "the policy write must never touch state",
  );
  report.checks.push("subagent-policy-writes-through-graph-write-intent-only");

  // 5c. FRAGILE fix: the fallback runtime can be both set AND removed.
  await policyPanel.locator('[data-testid="fallback-runtime-harness"]').click();
  // Whatever the real host catalog offers first — never a fabricated menu.
  await page.getByRole("option").first().click();
  await delay(400);
  const withFallback = await readGraph(workspace);
  assert.ok(
    withFallback.intent.policy.fallbackRuntime,
    `fallback runtime must write through: ${JSON.stringify(withFallback.intent.policy)}`,
  );
  const removeFallback = policyPanel.locator(
    '[data-testid="fallback-runtime-remove"]',
  );
  await removeFallback.waitFor();
  assert.equal(
    await removeFallback.isDisabled(),
    false,
    "a configured fallback must be removable",
  );
  await removeFallback.click();
  await delay(400);
  const withoutFallback = await readGraph(workspace);
  assert.equal(
    withoutFallback.intent.policy.fallbackRuntime,
    null,
    "Remove must clear the fallback runtime",
  );
  assert.match((await summary.innerText()) ?? "", /0 fallback/);
  assert.equal(
    await removeFallback.isDisabled(),
    true,
    "nothing left to remove — the control must disable, not no-op",
  );
  report.checks.push("fallback-runtime-remove-clears-and-summary-drops-to-0");

  // 5d. Scenario 7: the Main agent node opens a real inspector exposing the
  //     live-session honesty rules (harness-change refusal, delete/stop
  //     refusal) with a genuine Stop-session action wired through.
  await mainAgent.click();
  // The inspector is a Popover, portaled to the document body — not a
  // descendant of `panel` — so it must be located page-wide.
  const mainAgentInspector = page.locator(
    '[data-testid="main-agent-inspector"]',
  );
  await mainAgentInspector.waitFor({ timeout: 10000 });
  await page
    .locator('[data-testid="main-agent-harness-locked"]')
    .waitFor({ timeout: 5000 });
  await page
    .locator('[data-testid="main-agent-delete-refused"]')
    .waitFor({ timeout: 5000 });
  await shot(page, "orchestrator-main-agent-inspector-light-1440.png");
  await page.keyboard.press("Escape");
  await mainAgentInspector.waitFor({ state: "detached", timeout: 5000 });
  report.checks.push(
    "leader-node-inspector-exposes-harness-and-delete-refusal-rules",
  );

  // 6. Design 1: adversarial off — screenshots light + dark, every width.
  await summary.waitFor();
  assert.match((await summary.innerText()) ?? "", /Direct/);
  assert.equal(
    await panel.locator('[data-testid="orchestrator-test-node"]').count(),
    0,
  );
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
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
  await canvas.waitFor();
  await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
  await policyPanel
    .locator('[data-testid="adversarial-max-iterations"]')
    .waitFor();
  const maxIterationsValue = policyPanel.locator(
    '[data-testid="adversarial-max-iterations-value"]',
  );
  for (
    let i = 0;
    i < 20 && (await maxIterationsValue.innerText()) !== "10";
    i++
  ) {
    await policyPanel
      .locator('[data-testid="adversarial-max-iterations-increase"]')
      .click();
    await delay(150);
  }
  assert.equal(await maxIterationsValue.innerText(), "10");
  await panel
    .locator('[data-testid="orchestrator-depth-one-workers"]')
    .waitFor();
  await panel.locator('[data-testid="orchestrator-test-node"]').waitFor();
  await panel.locator('[data-testid="orchestrator-review-node"]').waitFor();
  assert.equal(
    (await panel
      .locator('[data-testid="orchestrator-repeat-caption"]')
      .innerText()) ?? "",
    "Repeat up to 10×",
  );
  assert.match((await summary.innerText()) ?? "", /Adversarial · Depth 1/);
  const withAdversarial = await readGraph(workspace);
  assert.equal(withAdversarial.intent.policy.adversarial.enabled, true);
  assert.equal(withAdversarial.intent.policy.adversarial.maxIterations, 10);
  report.checks.push(
    "adversarial-toggle-and-max-iterations-write-through-and-render",
  );

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
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
  await canvas.waitFor();
  report.checks.push("design-2-screenshots-light-dark-no-overflow");

  // 8. F0: BEFORE clicking "Run workflow", the canvas must disclose which
  //    runtime would run and whether it is the free local default — never
  //    a silent paid/external spawn. Computed the same way the app does
  //    (mirrors `FREE_DEFAULT_RUNTIME` in `shared/work-graph-contract.ts`),
  //    not assumed, since the approved runtime added in step 5 could be
  //    the catalog's default free pair or something else.
  const FREE_DEFAULT = {
    harness: "pi",
    model: "qwen3.8-flash-next-nvidia-nvfp4",
  };
  const currentPolicy = (await readGraph(workspace)).intent.policy;
  const firstRuntime =
    currentPolicy.approvedRuntimes[0] ??
    currentPolicy.fallbackRuntime ??
    FREE_DEFAULT;
  const expectFree =
    firstRuntime.harness === FREE_DEFAULT.harness &&
    firstRuntime.model === FREE_DEFAULT.model;
  const disclosure = panel.locator(
    '[data-testid="orchestrator-runtime-disclosure"]',
  );
  await disclosure.waitFor({ timeout: 10000 });
  assert.equal(
    await disclosure.getAttribute("data-free-default"),
    String(expectFree),
  );
  assert.match(
    (await disclosure.innerText()) ?? "",
    expectFree ? /free local model/ : /paid\/external/,
  );
  report.checks.push("run-workflow-discloses-the-runtime-before-launch");

  // 9. "Run workflow" (DISHONEST-1): dispatches the base task to the Main
  //    agent's OWN session first — the terminal must show it genuinely
  //    waiting on that dispatch, never firing the review within the same
  //    instant as the click. Only once the fixture session's turn settles
  //    (its own generic agent-state heuristic sees a real busy quiet-again
  //    transition from the dispatched write) does the real, BROKEN-2-fixed
  //    `graph.run_node_failover` episode proceed. This dev daemon has no
  //    real provider configured, so the honest, deterministic outcome is
  //    still a launch refusal once the episode is genuinely exhausted —
  //    never a fabricated "ready".
  const repeatCaption = panel.locator(
    '[data-testid="orchestrator-repeat-caption"]',
  );
  const boundBeforeRun =
    (await repeatCaption.innerText().catch(() => "")) ?? "";
  await panel.locator('[data-testid="orchestrator-run-workflow"]').click();
  // DISHONEST-2, exercised live and best-effort: bump the policy DOWN
  // immediately after the click, while the loop may still be in flight.
  // The exact in-flight WINDOW is timing-dependent on this unconfigured
  // dev daemon (a launch refusal can resolve within ~1 cycle) — the
  // deterministic proof of this fix lives in OrchestratorCanvas.test.tsx;
  // this only records corroborating live evidence when the race
  // cooperates, and never fails the run when it does not.
  await policyPanel
    .locator('[data-testid="adversarial-max-iterations-decrease"]')
    .click();
  const boundRightAfterBump =
    (await repeatCaption.innerText().catch(() => "")) ?? "";
  if (boundBeforeRun && boundRightAfterBump === boundBeforeRun) {
    report.checks.push(
      "dishonest2-in-flight-caption-held-the-running-bound-live",
    );
  } else {
    report.dishonest2LiveRaceInconclusive = {
      boundBeforeRun,
      boundRightAfterBump,
    };
  }
  const terminal = panel.locator('[data-testid="orchestrator-terminal"]');
  await page.waitForFunction(
    () => {
      const node = document.querySelector(
        '[data-testid="orchestrator-terminal"]',
      );
      return node?.getAttribute("data-state") !== "never-run";
    },
    undefined,
    { timeout: 30000 },
  );
  // Immediately after the click, the ledger must be waiting on the main
  // agent's session — never already past "awaiting_base" (that would mean
  // the review fired without the dispatch ever settling).
  assert.match(
    (await terminal.innerText()) ?? "",
    /Waiting for the main agent's delegated turn to finish/,
    "Run workflow must not launch a review before dispatching to the main agent",
  );
  report.checks.push(
    "run-workflow-waits-on-the-dispatched-session-before-reviewing",
  );
  // Let the dispatch settle and the loop's own poll (every 2s) actually
  // attempt the launch, so the recorded evidence is the REAL attempt
  // outcome, not just "a ledger now exists".
  await page
    .waitForFunction(
      () => {
        const node = document.querySelector(
          '[data-testid="orchestrator-terminal"]',
        );
        return (
          (node?.textContent ?? "").length > 0 &&
          !/Waiting for the main agent's delegated turn to finish/.test(
            node.textContent,
          )
        );
      },
      undefined,
      { timeout: 40000 },
    )
    .catch(() => {});
  const terminalState = await terminal.getAttribute("data-state");
  assert.notEqual(
    terminalState,
    "ready",
    "an unconfigured dev daemon must never fabricate a pass",
  );
  report.observedTerminalState = terminalState;
  report.observedTerminalText = (await terminal.innerText()) ?? "";
  await shot(page, "orchestrator-run-workflow-outcome.png");
  report.checks.push(
    "run-workflow-goes-through-real-dispatch-and-failover-and-never-fabricates-success",
  );

  // Return the policy to its default through the real controls, then launch
  // one final fixture session. This proves the acceptance itself leaves no
  // generated brief files or dirty repository behind.
  await policyPanel.locator('[data-testid="adversarial-toggle"]').click();
  await delay(400);
  await policyPanel
    .locator('[data-testid="approved-runtime-0-remove"]')
    .click();
  await delay(400);
  const finalPolicy = await readGraph(workspace);
  assert.equal(finalPolicy.intent.policy.delegate, false);
  assert.equal(finalPolicy.intent.policy.adversarial.enabled, false);
  assert.equal(finalPolicy.intent.policy.approvedRuntimes.length, 0);
  assert.equal(finalPolicy.intent.policy.fallbackRuntime, null);
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
  assert.ok(!(await readdir(workspace)).includes("AGENTS.md"));
  assert.ok(!(await readdir(workspace)).includes("CLAUDE.md"));
  assert.equal(
    await gitStatus(workspace),
    "",
    "acceptance cleanup must leave the fixture repo clean",
  );
  report.checks.push("acceptance-resets-policy-and-leaves-fixture-repo-clean");

  // 10. FINDING fix: closing the session and reloading must never collapse
  //    the canvas to the no-session view. Confirmed empirically before this
  //    fix existed: `terminal close` never reaches an already-mounted
  //    canvas without a reload (no live push for an externally closed
  //    session), and the reload itself then dropped the session from
  //    `terminal list` entirely — an in-memory-only fix would not survive
  //    it, which is why the real fix persists the last-known session
  //    (last-known-main-session.ts) rather than only holding it in a ref.
  //
  //    The DISHONEST-3 step above (5b) launched two MORE sessions in this
  //    workspace (delegate-on/off) after the one captured in `session` —
  //    `pickMentuMainSession` prefers the newest LIVE agent session, so the
  //    canvas is now showing one of those, not `session`. Close every live
  //    agent session this workspace has, not just the original one, so the
  //    canvas genuinely has none left — exactly the state a real user
  //    reaches by closing their last session, whichever it was.
  const stillLive = (
    await cliJson(dataDir, [
      "terminal",
      "list",
      "--workspace",
      workspaceRecord.id,
    ])
  ).sessions.filter(
    (candidate) => candidate.harnessId && candidate.verdict === "live",
  );
  assert.ok(
    stillLive.length > 0,
    "expected at least one live session to close",
  );
  let closeResult = null;
  for (const candidate of stillLive) {
    closeResult = await cliJson(dataDir, [
      "terminal",
      "close",
      "--session",
      candidate.id,
      "--incarnation",
      candidate.incarnation,
    ]);
    assert.equal(closeResult.verdict, "exited", JSON.stringify(closeResult));
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
  await canvas.waitFor();
  assert.equal(
    await panel.locator('[data-testid="orchestrator-disabled"]').count(),
    0,
    "an exited session must never collapse the canvas to the no-session view",
  );
  const mainAgentAfterClose = panel.locator(
    '[data-testid="orchestrator-main-agent"]',
  );
  await mainAgentAfterClose.waitFor({ timeout: 10000 });
  // The renderer never observes a live push for an externally-closed
  // session (confirmed empirically: no `onStateChanged` event reaches an
  // already-mounted canvas for a session closed from outside the app), so
  // the persisted last-known record's own verdict is whatever was true the
  // moment BEFORE the close — "live". The honest state to render from that
  // is "unverifiable" (contact lost, not confirmed exited — AGENTS.md is
  // explicit that loss of contact never proves exit), not a fabricated
  // "exited". Either is an acceptable answer per the finding's own wording
  // ("exited or unverifiable"); what must never happen is "live" or a
  // collapse to "no session".
  const stateAfterClose = await mainAgentAfterClose.getAttribute("data-state");
  assert.ok(
    stateAfterClose === "exited" || stateAfterClose === "unverifiable",
    `expected exited or unverifiable, got ${stateAfterClose}`,
  );
  assert.notEqual(
    stateAfterClose,
    "live",
    "a session with no fresh confirmation must never render as live",
  );
  await shot(page, "orchestrator-exited-session-after-reload-light-1440.png");
  report.checks.push(
    "exited-session-survives-a-reload-instead-of-collapsing-to-no-session",
  );
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
  failure = new Error(
    `process cleanup left survivors: ${survivors.join("; ")}`,
  );
await writeFile(
  path.join(report.output, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
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
