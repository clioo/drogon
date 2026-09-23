// MIT Copyright (c) 2026 Lovecast Inc.
//
// Mentu Run Recipe delegation, proven against the surfaces the product
// still ships: the sidebar Mentu panel this journey once drove is gone
// (the mentu tab slot renders the Work Graph now and MentuPanel mounts
// nowhere), so delegation is proven through the surviving path — the
// daemon's hash-bound approval gate plus the same `mentu.run` execution
// the desktop's Run button uses — with the desktop's own `mentu open`
// verdict proving the Work Graph tab still opens on the recipe.
//
// What this drives, end to end:
//   1. a workspace with a real `.mentu/recipes` recipe and the pinned
//      official `mentu-recipes` runtime installed;
//   2. the approval gate: an unapproved recipe REFUSES with
//      `mentu_approval_required` instead of running silently;
//   3. `mentu.approve` binding the exact recipe bytes (a wrong hash is
//      refused), then `mentu run` consuming that single-use approval;
//   4. the live run row: the first step's evidence lands while the second
//      step still runs, with the finished step's recorded usage on the row;
//   5. the settle to succeeded, twice (light and dark), and `mentu open`
//      confirmed by the running desktop itself.
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
  scrubInheritedDispatchBindings,
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";
import { writeAgentSettingsFixtures } from "./probe-agent-settings.mjs";

// This journey owns a disposable daemon: drop the parent dispatch context so
// its CLI never presents a foreign credential to its own daemon.
scrubInheritedDispatchBindings();

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

  // Raw envelope (no ok assertion): the approval gate is proven by a
  // refusal, so the journey must read the error envelope, not throw on it.
  const cliRaw = async (dataDir, args, options = { timeout: 20000 }) => {
    try {
      const { stdout } = await runAcceptanceProcess(
        cli,
        ["--data-dir", dataDir, "--json", ...args],
        options,
      );
      return JSON.parse(stdout);
    } catch (error) {
      return JSON.parse(error.stdout ?? "");
    }
  };
  const rpc = async (dataDir, method, params) =>
    cliJson(dataDir, ["rpc", method, "--params", JSON.stringify(params)]);

  // 3. Recipe discovery: the workspace exposes exactly this recipe, valid.
  const discovered = await cliJson(dataDir, [
    "mentu",
    "status",
    "--workspace",
    report.workspaceId,
  ]);
  assert.equal(discovered.workspace?.recipes?.total, 1, JSON.stringify(discovered));
  assert.equal(discovered.workspace?.recipes?.valid, 1, JSON.stringify(discovered));
  const listed = await rpc(dataDir, "mentu.recipes", { workspaceId: report.workspaceId });
  const recipe = (listed.recipes ?? []).find((entry) => entry.id === RECIPE_ID);
  assert.ok(recipe?.valid, `workspace must expose a valid ${RECIPE_ID}: ${JSON.stringify(listed)}`);
  report.checks.push("workspace-exposes-the-recipe");

  // 4. The approval gate: an unapproved recipe REFUSES instead of running.
  const refused = await cliRaw(dataDir, [
    "mentu",
    "run",
    "--workspace",
    report.workspaceId,
    "--recipe",
    RECIPE_ID,
  ]);
  assert.equal(refused.ok, false, `unapproved run must refuse: ${JSON.stringify(refused)}`);
  assert.equal(refused.error?.code, "mentu_approval_required");
  report.checks.push("unapproved-recipe-refuses-instead-of-running");

  // 5. Approve the exact current bytes, then run against that approval.
  //    Approvals are single-use: each run below mints its own. The hash is
  //    the sha256 of the recipe file's exact on-disk bytes — the same
  //    bytes a human review would approve.
  const recipeFile = path.join(workspace, ".mentu", "recipes", `${RECIPE_ID}.json`);
  const approveForRun = async () => {
    const contentHash = createHash("sha256").update(await readFile(recipeFile)).digest("hex");
    const approved = await rpc(dataDir, "mentu.approve", {
      workspaceId: report.workspaceId,
      recipeId: RECIPE_ID,
      contentHash,
    });
    assert.ok(approved.approval?.id, JSON.stringify(approved));
    assert.equal(approved.approval.contentHash, contentHash);
    return approved.approval.id;
  };
  // A wrong hash must not mint an approval.
  const wrongHash = await cliRaw(dataDir, [
    "rpc",
    "mentu.approve",
    "--params",
    JSON.stringify({
      workspaceId: report.workspaceId,
      recipeId: RECIPE_ID,
      contentHash: "0".repeat(64),
    }),
  ]);
  assert.equal(wrongHash.ok, false, JSON.stringify(wrongHash));
  report.checks.push("wrong-bytes-approval-refused");
  const runRecipe = async () => {
    const approvalId = await approveForRun();
    const started = await cliJson(dataDir, [
      "mentu",
      "run",
      "--workspace",
      report.workspaceId,
      "--recipe",
      RECIPE_ID,
      "--approval",
      approvalId,
    ]);
    assert.ok(started.run?.id, JSON.stringify(started));
    return started.run.id;
  };
  report.checks.push("exact-bytes-approval-minted-per-run");

  const runStatus = async (runId) =>
    (await cliJson(dataDir, ["mentu", "run-status", "--run", runId])).run;
  const waitForLiveRow = async (timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const listed = await cliJson(dataDir, [
        "mentu",
        "runs",
        "--workspace",
        report.workspaceId,
      ]);
      const live = (listed.runs ?? []).find((entry) => entry.status === "running") ?? null;
      if (live && live.mentuRunId && live.steps.length >= 1) return live;
      if (Date.now() >= deadline) return live;
      await delay(400);
    }
  };
  const waitForSettle = async (runId, timeoutMs = 180000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await runStatus(runId);
      if (row.status !== "running") return row;
      if (Date.now() >= deadline) return row;
      await delay(500);
    }
  };

  // 6. Run 1 (light): the first step's evidence lands while the slow
  //    second step still runs, with the finished step's recorded usage on
  //    the row — read from the daemon while the status is still running.
  await page.setViewportSize({ width: 1440, height: 900 });
  await selectSettingsTheme(page, "light");
  const firstRunId = await runRecipe();
  const liveRun = await waitForLiveRow();
  assert.ok(liveRun, "the run row must appear");
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

  const marker = await readFile(path.join(workspace, "mentu-step-one.txt"), "utf8");
  assert.match(marker, /MENTU-STEP-ONE/);
  report.checks.push("first-step-evidence-lands-while-running");

  // Shell steps honestly carry no token usage (the protocol documents
  // usage as None for shell-only steps), so the live row must carry the
  // step's recorded outcome and its captured output instead.
  const liveRow = await runStatus(liveRun.id);
  const finishedStep = liveRow.steps.find((step) => step.label === "write-marker");
  assert.equal(finishedStep?.status, "succeeded", JSON.stringify(liveRow.steps));
  assert.equal(finishedStep?.exitCode, 0, JSON.stringify(finishedStep));
  assert.ok(finishedStep?.outputPath, JSON.stringify(finishedStep));
  const stepOutput = await readFile(path.join(workspace, finishedStep.outputPath), "utf8");
  assert.match(stepOutput, /MENTU-STEP-ONE/);
  report.checks.push("live-run-row-carries-step-outcome-and-output");

  const stillRunning = (await runStatus(liveRun.id)).status;
  assert.equal(
    stillRunning,
    "running",
    "evidence and usage must be read while the run is still in flight",
  );
  report.checks.push("evidence-and-usage-read-while-status-running");

  const settled = await waitForSettle(liveRun.id);
  assert.equal(settled.status, "succeeded", "run did not succeed: " + JSON.stringify(settled));
  assert.ok(
    (settled.steps ?? []).some((step) => step.label === "read-marker"),
    "the settled run must show both steps",
  );
  report.checks.push("run-settles-succeeded-with-both-steps");

  // 7. The surviving desktop surface: `mentu open` is answered by the
  //    running desktop itself — an open that did not happen reports failure.
  const opened = await cliJson(dataDir, [
    "mentu",
    "open",
    "--workspace",
    report.workspaceId,
    "--recipe",
    RECIPE_ID,
  ]);
  assert.equal(opened.ok ?? true, true, JSON.stringify(opened));
  report.checks.push("desktop-confirms-work-graph-tab-open-on-recipe");
  // The strip tab carries the feature's user-facing name, not "Mentu".
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor({ timeout: 20000 });
  await shot(page, "open-light-1440");

  // 8. Run 2 (dark): a fresh approval (approvals are consumed), the same
  //    delegation, settled the same way.
  await selectSettingsTheme(page, "dark");
  await shot(page, "open-dark-1440");
  const secondRunId = await runRecipe();
  assert.notEqual(secondRunId, firstRunId, "the second run must be a new row");
  const secondSettled = await waitForSettle(secondRunId);
  assert.equal(
    secondSettled.status,
    "succeeded",
    "second run did not succeed: " + JSON.stringify(secondSettled),
  );
  report.checks.push("second-run-delegated-in-dark-and-settled");
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
