// MIT Copyright (c) 2026 Lovecast Inc.
//
// Mentu Run Recipe delegation: the owner's thesis, proven on the REAL app
// over CDP in a background window.
//
// What this drives, end to end:
//   1. a workspace with a real `.mentu/recipes` recipe and the pinned
//      official `mentu-recipes` runtime installed;
//   2. a real harness session (`claude`, stubbed by the shared sealed
//      fixture, which answers a Mentu prompt by running the documented
//      `drogon-cli mentu run`, i.e. it stands in for an agent that read the
//      skill);
//   3. the Mentu panel's run control: review, approve, and DELIVER the
//      prompt into that session (the delegation path the app ships; the
//      work graph owns the wide tab since the takeover);
//   4. the daemon's own run row driving the button's animation and the
//      live Evidence while the run is still in flight, with the run row
//      carrying the finished step's recorded usage (the data the old
//      detached Metrics view rendered — now it belongs to the node);
//   5. the settle back to idle.
//
// It never activates the window: `DROGON_BACKGROUND_WINDOW=1`, its own
// `DROGON_DATA_DIR` and `DROGON_ELECTRON_PROFILE`, and no focus call of any
// kind. Run: node scripts/accept-mentu-run-delegation.mjs
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
const runtimeSource = path.join(
  root,
  "apps",
  "desktop",
  "resources",
  "mentu-runtime",
  "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
  "bin",
  "mentu-recipes",
);

const RECIPE_ID = "acceptance-live";
const RECIPE = {
  name: RECIPE_ID,
  description: "delegation probe: one fast step, one deliberately slow step",
  steps: [
    {
      label: "write-marker",
      backend: "shell",
      prompt:
        "printf 'MENTU-STEP-ONE\\n' > mentu-step-one.txt && printf 'MENTU-STEP-ONE\\n'",
      timeout: 30,
    },
    {
      label: "read-marker",
      backend: "shell",
      prompt: "sleep 30 && cat mentu-step-one.txt",
      timeout: 90,
    },
  ],
};

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

const cliText = async (dataDir, args) => {
  const { stdout } = await run(cli, ["--data-dir", dataDir, ...args]);
  return stdout;
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
    .filter((line) => line.includes(dataDir) && !line.includes("accept-mentu-run-delegation"))
    .map((line) => Number.parseInt(line.trim().split(/\s+/)[0], 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

/** Bounded, scoped teardown: only processes that name THIS run's data dir. */
async function stopOwnedByDataDir(label, verify) {
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
    if (verify) await verify();
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
  // The daemon is this probe's own (dev builds attach to a manually started
  // one); close it and then verify nothing still names this data dir, which
  // also catches a PTY child or a `mentu-recipes` the run left behind.
  if (daemon) await stopAcceptanceProcess(daemon);
  await stopOwnedByDataDir("daemon", async () => {
    if (desktopRunning) return;
  });
  const remaining = await pidsForDataDir();
  if (remaining.length > 0)
    survivors.push(`post-cleanup survivors: ${remaining.join(",")}`);
}

const startedAt = new Date().toISOString();
const report = {
  kind: "mentu-run-delegation",
  status: "FAILED",
  startedAt,
  checks: [],
  screenshots: [],
  processes: { desktopPids },
  cleanup: [],
  survivors,
};

async function shot(page, name) {
  const file = path.join(report.output, `${name}.png`);
  const png = await page.screenshot({ path: file, animations: "disabled", timeout: 15000 });
  report.screenshots.push({
    name,
    file,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
  return file;
}

/**
 * A real pointer click at the locator's box.
 *
 * `locator.click()` re-checks actionability between hover and mousedown and
 * can silently drop the click on a hidden (background) window right after a
 * Settings detour; the explicit hover + `mouse.click` pair dispatches the
 * same real pointer input without that race (verified on this probe: the
 * locator click produced no dispatch and this did).
 */
async function pointerClick(page, locator) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert.ok(box, "pointer target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), "mentu-delegation-"));
  dataDir = path.join(fixture, "data");
  report.dataDir = dataDir;
  const workspace = path.join(fixture, "folder");
  const fixtureBin = path.join(fixture, "bin");
  report.output =
    process.env.MENTU_DELEGATION_OUT ??
    path.join(root, ".preflight", "acceptance", `mentu-run-delegation-${Date.now()}`);
  await mkdir(report.output, { recursive: true });
  await mkdir(path.join(workspace, ".mentu", "recipes"), { recursive: true });
  await writeFile(
    path.join(workspace, ".mentu", "recipes", `${RECIPE_ID}.json`),
    `${JSON.stringify(RECIPE, null, 2)}\n`,
  );
  await mkdir(fixtureBin, { recursive: true });
  await writeAgentSettingsFixtures(fixtureBin);
  report.fixture = fixture;
  report.workspace = workspace;

  const childEnv = {
    ...process.env,
    PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  // 1. Start the daemon this probe owns (a dev build attaches to a
  //    manually started `drogond`, it never spawns one), then register the
  //    workspace and install the pinned runtime before the app boots.
  daemon = startAcceptanceProcess(drogon, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: childEnv,
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
  await cliJson(dataDir, [
    "rpc",
    "mentu.runtime_install",
    "--params",
    JSON.stringify({ sourcePath: runtimeSource }),
  ]);
  const registered = await cliJson(dataDir, [
    "workspace",
    "add",
    workspace,
    "--name",
    "mentu-delegation",
  ]);
  report.workspaceId = registered.id;

  // 2. Launch the real app in a background window and attach over CDP.
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
  });
  desktopPids.push(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no debugging endpoint: ${tail}`)),
      30000,
    );
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
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  report.checks.push("app-launched-in-background-window");

  // 3. Start the workspace's main agent session (the shared fixture stands
  //    in for an agent that read the drogon-cli skill).
  await cliJson(dataDir, [
    "harness",
    "start",
    "--workspace",
    report.workspaceId,
    "--harness",
    "claude",
  ]);
  let session = null;
  const sessionDeadline = Date.now() + 30000;
  for (;;) {
    const listed = await cliJson(dataDir, [
      "terminal",
      "list",
      "--workspace",
      report.workspaceId,
    ]);
    session =
      listed.sessions.find((item) => item.harnessId === "claude" && item.verdict !== "exited") ??
      null;
    if (session && session.agentState === "idle") break;
    if (Date.now() >= sessionDeadline)
      throw new Error(`main agent session never went idle: ${JSON.stringify(session)}`);
    await delay(500);
  }
  report.mainSession = { id: session.id, agentState: session.agentState };
  report.checks.push("main-agent-session-idle-before-click");

  // 4. Mentu panel: open it and select the recipe. The panel drives the
  //    SAME review -> approve & run controller the old wide-tab header
  //    drove; the wide tab now renders the work graph.
  const panel = page.locator('[data-testid="mentu-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('.right-sidebar-header-drag button[aria-label="Work Graph"]').click();
  }
  await panel.waitFor({ timeout: 20000 });
  await panel.getByRole("combobox", { name: "Recipe", exact: true }).click();
  await page.getByRole("option", { name: RECIPE_ID, exact: true }).click();
  await panel.getByText("write-marker", { exact: true }).waitFor();
  // Every surface below is scoped to the PANEL: the run control, review
  // card and status live here, and the probe must not read another copy.
  const runButton = panel.locator('[data-testid="mentu-run"]');
  await runButton.waitFor({ timeout: 20000 });
  // The shell's session list has to have caught up before the hint clears.
  await page
    .locator('[data-testid="mentu-main-session-hint"]')
    .waitFor({ state: "hidden", timeout: 20000 });
  report.checks.push("mentu-panel-open-with-live-main-session");

  await page.setViewportSize({ width: 1440, height: 900 });
  await selectSettingsTheme(page, "light");
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('.right-sidebar-header-drag button[aria-label="Work Graph"]').click();
  }
  await panel.waitFor();
  await runButton.waitFor();
  await shot(page, "01-idle-light-1440");

  // 5. Review -> approve: the click that used to call mentu.run itself.
  await pointerClick(page, runButton);
  await runButton.filter({ hasText: "Approve & run" }).waitFor({ timeout: 20000 });
  await panel.getByTestId("mentu-review").waitFor({ timeout: 20000 });
  await shot(page, "02-review-light-1440");
  report.checks.push("review-staged-before-approval");

  const terminalTextFor = async () => {
    const read = await cliJson(dataDir, [
      "terminal",
      "read",
      "--session",
      session.id,
      "--incarnation",
      session.incarnation,
      "--cursor",
      "0",
      "--limit-bytes",
      "65536",
    ]);
    return Buffer.from(read.dataBase64, "base64").toString("utf8");
  };

  await pointerClick(page, runButton);
  await page.locator('[data-testid="mentu-run"][data-running="true"]').waitFor({
    timeout: 20000,
  });
  report.checks.push("run-recipe-button-animates-after-approval");

  // 6. The prompt must be VISIBLE in the main session, and the agent (the
  //    fixture) must be the thing that started the run.
  const runsFor = async () =>
    (await cliJson(dataDir, ["mentu", "runs", "--workspace", report.workspaceId])).runs;
  const waitForLiveRun = async (excludeId) => {
    let live = null;
    const deadline = Date.now() + 40000;
    for (;;) {
      live = (await runsFor()).find((entry) => entry.id !== excludeId) ?? null;
      if (live && live.status === "running" && live.mentuRunId && live.steps.length >= 1) break;
      if (live && live.status !== "running") break;
      if (Date.now() >= deadline) break;
      await delay(400);
    }
    return live;
  };

  let promptSeen = false;
  let agentRan = false;
  let terminalTail = "";
  const promptDeadline = Date.now() + 30000;
  for (;;) {
    const text = await terminalTextFor();
    terminalTail = text;
    promptSeen = text.includes("mentu run --workspace " + report.workspaceId);
    agentRan = text.includes("fixture-mentu-run recipe=");
    if (promptSeen && agentRan) break;
    if (Date.now() >= promptDeadline) break;
    await delay(500);
  }
  report.terminalTail = terminalTail.slice(-4000);
  assert.ok(promptSeen, "the Run Recipe prompt must appear as a visible turn in the main session");
  assert.ok(
    agentRan,
    "the agent session must run the documented drogon-cli command; terminal tail:\n" +
      terminalTail.slice(-2000),
  );
  report.prompt = terminalTail
    .split("\n")
    .find((line) => line.includes("mentu run --workspace"));
  report.checks.push("prompt-visible-in-main-session");
  report.checks.push("agent-session-ran-drogon-cli-mentu-run");

  // 7. Live run state: the button animates from the daemon's row, and the
  //    first step's evidence/metrics land while the second step still runs.
  const liveRun = await waitForLiveRun(null);
  assert.ok(liveRun, "the agent's run row must appear");
  assert.equal(liveRun.status, "running", "run settled too early: " + JSON.stringify(liveRun));
  assert.ok(liveRun.mentuRunId, "the live row must carry the runtime's run id");
  assert.equal(liveRun.steps.length, 1, "the finished step must be visible while running");
  report.liveRun = {
    id: liveRun.id,
    status: liveRun.status,
    mentuRunId: liveRun.mentuRunId,
    steps: liveRun.steps.map((step) => step.label),
  };
  report.checks.push("run-row-live-with-finished-step-while-running");

  const paneRunEvidence = async () => {
    await panel.getByRole("tab", { name: "Evidence", exact: true }).click();
    const evidence = panel.getByTestId("recipe-evidence");
    await evidence.waitFor();
    await evidence.getByText("write-marker", { exact: true }).first().waitFor({ timeout: 20000 });
    return (await evidence.innerText()) ?? "";
  };
  const evidenceText = await paneRunEvidence();
  assert.match(
    evidenceText,
    /MENTU-STEP-ONE/,
    "live evidence must carry the first step's stdout: " + evidenceText.slice(0, 400),
  );
  report.checks.push("evidence-populated-while-running");

  // The old detached Metrics view is gone (metrics moved ONTO the work
  // graph's nodes); its DATA must still be live in the daemon's own run
  // row while the run is in flight — the recorded usage of the finished
  // step, exactly what Metrics rendered, read from the same record.
  let liveUsage = null;
  const usageDeadline = Date.now() + 20000;
  for (;;) {
    const row = (await cliJson(dataDir, ["mentu", "run-status", "--run", liveRun.id])).run;
    const finished = row.steps.find((step) => step.label === "write-marker");
    liveUsage = finished?.usage ?? null;
    if (liveUsage && (liveUsage.usageKnown === true || liveUsage.inputTokens !== null)) break;
    if (Date.now() >= usageDeadline) break;
    await delay(300);
  }
  assert.ok(
    liveUsage,
    "the live run row must carry the finished step's recorded usage (the old Metrics data)",
  );
  report.liveUsage = liveUsage;
  report.checks.push("live-run-row-carries-recorded-usage");
  await shot(page, "04-running-evidence-light-1440");

  // The evidence read is the daemon's, not the settled record's.
  const stillRunning = (await cliJson(dataDir, ["mentu", "run-status", "--run", liveRun.id])).run
    .status;
  assert.equal(
    stillRunning,
    "running",
    "Evidence and Metrics must be read while the run is still in flight",
  );
  report.checks.push("evidence-and-metrics-read-while-status-running");

  // 8. The width matrix DURING the run: the animation and the live evidence
  //    surface at 1440/1100/900/760, light here and dark in run 2.
  const captureDuringRun = async (theme) => {
    await paneRunEvidence();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.getByTestId("recipe-evidence").waitFor();
      await page.locator('[data-testid="mentu-run"][data-running="true"]').waitFor();
      await shot(page, `03-running-evidence-${theme}-${width}`);
    }
    report.checks.push(`running-indicator-and-evidence-captured-${theme}-4-widths`);
  };
  await captureDuringRun("light");
  // Still the same run: the animation was alive across the whole matrix.
  const liveAfterMatrix = (await cliJson(dataDir, ["mentu", "run-status", "--run", liveRun.id]))
    .run;
  assert.equal(
    liveAfterMatrix.status,
    "running",
    "the run must still be in flight across the whole width matrix",
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  // 9. Settle: the daemon's own terminal status, and the button back to idle.
  const waitForSettle = async (runId) => {
    const deadline = Date.now() + 180000;
    let row = null;
    for (;;) {
      row = (await runsFor()).find((entry) => entry.id === runId) ?? null;
      if (row && row.status !== "running") break;
      if (Date.now() >= deadline) break;
      await delay(500);
    }
    return row;
  };
  const settled = await waitForSettle(liveRun.id);
  assert.equal(
    settled && settled.status,
    "succeeded",
    "run did not succeed: " + JSON.stringify(settled),
  );
  await page
    .locator('[data-testid="mentu-run"][data-running="false"]')
    .waitFor({ timeout: 30000 });
  await panel.getByRole("tab", { name: "Evidence", exact: true }).click();
  await panel
    .getByTestId("recipe-evidence")
    .getByText("read-marker", { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  report.checks.push("button-returns-to-idle-after-settle");
  report.checks.push("settled-run-shows-both-steps");
  await shot(page, "05-settled-light-1440");

  // 10. Run 2 in dark: the same delegation, the dark matrix DURING the run.
  await selectSettingsTheme(page, "dark");
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('.right-sidebar-header-drag button[aria-label="Work Graph"]').click();
  }
  await panel.waitFor();
  await runButton.waitFor();
  await shot(page, "06-idle-dark-1440");
  // The Settings detour remounts the Mentu surfaces, so the staged review
  // is gone: run 2 walks the same two-phase gate as run 1 (stage, then
  // approve), which is also what a user switching theme mid-session sees.
  const labelBefore = await runButton.evaluate((node) => node.textContent ?? "");
  if (labelBefore.includes("Review Run")) {
    await pointerClick(page, runButton);
    await runButton.filter({ hasText: "Approve & run" }).waitFor({ timeout: 20000 });
    report.checks.push("second-run-restages-review-after-remount");
  }
  await pointerClick(page, runButton);
  await page.locator('[data-testid="mentu-run"][data-running="true"]').waitFor({
    timeout: 20000,
  });
  const secondRun = await waitForLiveRun(liveRun.id);
  assert.ok(secondRun && secondRun.id !== liveRun.id, "the second run must be a new row");
  assert.equal(secondRun.status, "running", "second run settled early: " + secondRun.status);
  await captureDuringRun("dark");
  const secondSettled = await waitForSettle(secondRun.id);
  assert.equal(
    secondSettled && secondSettled.status,
    "succeeded",
    "second run did not succeed: " + JSON.stringify(secondSettled),
  );
  await page
    .locator('[data-testid="mentu-run"][data-running="false"]')
    .waitFor({ timeout: 30000 });
  report.checks.push("second-run-delegated-in-dark-and-settled");
  await shot(page, "08-settled-dark-1440");
  report.checks.push("delegation-proven-end-to-end");
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
      screenshots: report.screenshots.map((shot) => shot.name),
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
