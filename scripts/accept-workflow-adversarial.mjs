// MIT Copyright (c) 2026 Lovecast Inc.
//
// The workflow bar + bounded adversarial-review loop, proven on the REAL
// app over CDP in a background window (never the developer's own Drogon):
//
//   1. design a minimal one-node (shell) graph and save it — the ONE
//      existing intent seam;
//   2. create a named workflow from that graph through the workflow bar,
//      prove the selector shows which workflow is selected, turn on
//      "adversarial review on finish" and set the max-cycle cap — all real
//      clicks, real persistence to `.drogon/workflows.json`;
//   3. screenshots of the bar (selector, Selected badge, checkbox, max
//      cycles) in light AND dark at 1440/1100/900/760, no horizontal
//      overflow;
//   4. run the graph for real (shell node, no model, fast) through the
//      existing compile→review→run path, watch it settle, click "Watch
//      the graph" back to the read-only view (proving the loop survives
//      that mode switch — it lives in WorkGraphPane, not the designer);
//   5. the adversarial loop then drives itself, autonomously, through the
//      SAME `graph.write_intent`/`graph.compile`/`graph.run` seam: this
//      probe waits for its own status banner and records whatever the
//      daemon HONESTLY reports (this dev daemon has no `pi` provider
//      configured, so the review node is expected to be honestly refused
//      at compile — proving the safety rule that a pi node never emits a
//      false-success recipe, and that this feature never claims success
//      it did not earn);
//   6. the two review-loop OUTCOME strings ("Adversarial review passed on
//      cycle N" and the required "Stopped after N review cycles, still
//      failing.") are proven exactly by
//      features/work-graph-workflows/adversarial-loop.test.ts, which
//      exercises every reducer transition without needing a real (or
//      absent) model endpoint; this probe additionally renders each exact
//      ledger shape those tests certify by writing it to
//      `.drogon/workflows.json` (the same file the feature itself writes)
//      and reloading the pane, so BOTH terminal messages are shown in the
//      real running app, not just asserted in isolation.
//
// Background window only: DROGON_BACKGROUND_WINDOW=1, its own
// DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE, no focus call of any kind.
// Run: node scripts/accept-workflow-adversarial.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
import { MENTU_LOCK_SHA256 } from "./mentu-runtime-provision.mjs";

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

/** A verified copy of the pinned `mentu-recipes` runtime this machine
 *  already fetched for another workspace — content-addressed by the SAME
 *  sha256 the daemon itself re-verifies on install, so using one is exactly
 *  as safe as fetching it again. Never the resource this repo would bundle
 *  in a packaged build (that path is absent in an unprovisioned checkout);
 *  falls back to the bundled path first so a provisioned checkout needs no
 *  network or scratch-directory archaeology at all. */
async function findVerifiedRuntimeSource() {
  const bundled = path.join(
    appDir,
    "resources",
    "mentu-runtime",
    "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
    "bin",
    "mentu-recipes",
  );
  if (existsSync(bundled)) return bundled;
  // A permission-denied entry anywhere under /private/tmp must not abort
  // the whole search (shelling out to `find` does exactly that — a
  // nonzero exit from ONE unreadable directory loses every match `find`
  // already printed), so this walks directly and skips what it cannot read.
  const { readdir } = await import("node:fs/promises");
  async function walk(dir, depthLeft) {
    if (depthLeft < 0) return null;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(full, depthLeft - 1);
        if (found) return found;
        continue;
      }
      if (!entry.isFile() || entry.name !== "mentu-recipes") continue;
      try {
        const bytes = await readFile(full);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (sha256 === MENTU_LOCK_SHA256) return full;
      } catch {
        // Unreadable or vanished — try the next candidate.
      }
    }
    return null;
  }
  const found = await walk("/private/tmp", 6);
  if (found) return found;
  throw new Error(
    "no verified mentu-recipes runtime found (bundled resources absent and no " +
      `sha256-matching (${MENTU_LOCK_SHA256}) copy under /private/tmp)`,
  );
}

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
    .filter((line) => line.includes(dataDir) && !line.includes("accept-workflow-adversarial"))
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
  kind: "workflow-adversarial",
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
async function readWorkflows(workspace) {
  return JSON.parse(await readFile(path.join(workspace, ".drogon", "workflows.json"), "utf8"));
}
async function writeWorkflows(workspace, doc) {
  await mkdir(path.join(workspace, ".drogon"), { recursive: true });
  await writeFile(path.join(workspace, ".drogon", "workflows.json"), `${JSON.stringify(doc, null, 2)}\n`);
}

async function main() {
  // A SHORT prefix matters: `native-client.ts`'s `resolveEndpointPath` joins
  // `<dataDir>/runtime-v1.sock` with no long-path fallback (unlike the Rust
  // endpoint, which has one — see `crates/drogond/src/endpoint.rs`), and
  // macOS's AF_UNIX `sun_path` is 104 bytes. `realpath()` turns the tmp
  // root into `/private/var/folders/.../T/...`, so a longer prefix here
  // silently produces `connect EINVAL` in the real app while `drogon-cli`
  // (which the Rust side accepted) keeps working — proven the hard way.
  const fixture = await mkdtemp(path.join(tmpdir(), "wfadv-"));
  dataDir = path.join(fixture, "data");
  report.dataDir = dataDir;
  const workspace = path.join(fixture, "folder");
  report.output =
    process.env.WORKFLOW_ADVERSARIAL_OUT ??
    path.join(root, ".preflight", "acceptance", `workflow-adversarial-${Date.now()}`);
  await mkdir(report.output, { recursive: true });
  await mkdir(workspace, { recursive: true });
  report.fixture = fixture;
  report.workspace = workspace;

  // 1. Start the daemon this probe owns, register the workspace, install
  //    the pinned runtime (needed for the shell node the base graph runs).
  daemon = startAcceptanceProcess(drogon, ["--data-dir", dataDir], { stdio: "ignore" });
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
  const runtimeSource = await findVerifiedRuntimeSource();
  await cliJson(dataDir, [
    "rpc",
    "mentu.runtime_install",
    "--params",
    JSON.stringify({ sourcePath: runtimeSource }),
  ]);
  // `project add` (not the lower-level `workspace add`) registers BOTH the
  // project and its implicit workspace, so the sidebar renders a card for
  // it — the same distinction `accept-desktop.mjs`'s own Add Project step
  // documents; a bare `workspace add` never appears as a card.
  const registered = await cliJson(dataDir, ["project", "add", workspace, "--name", "wf-adv"]);
  report.projectId = registered.id;

  // 2. Launch the real app in a background window and attach over CDP.
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
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
    if (message.type() === "error" || process.env.WORKFLOW_ADVERSARIAL_DEBUG)
      report.consoleErrors.push(`[${message.type()}] ${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  report.checks.push("app-launched-in-background-window");

  // 3. The CLI-registered project reaches the sidebar via its own live
  //    digest (R16-F); select its implicit workspace card, then open the
  //    Work Graph (Mentu tab) and design a minimal one-node graph.
  if (process.env.WORKFLOW_ADVERSARIAL_DEBUG) {
    await shot(page, "debug-after-launch");
  }
  await page.getByRole("button", { name: "Select wf-adv" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Select wf-adv" }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mentu", exact: true }).click();
  await page.getByRole("tab", { name: "Mentu", exact: true }).waitFor();
  const panel = page.locator('[data-testid="mentu-tab-panel"]');
  const empty = panel.locator('[data-testid="work-graph-empty"]');
  await empty.waitFor({ timeout: 15000 });
  await empty.locator('[data-testid="work-graph-design-new"]').click();
  const designer = panel.locator('[data-testid="work-graph-designer"]');
  await designer.waitFor();
  await designer.locator('[data-testid="design-add-node"]').click();
  await designer.locator('[data-testid="design-field-title"]').fill("Base step");
  await designer.locator('[data-testid="design-field-prompt"]').fill("printf 'BASE-DONE\\n'");
  await designer.locator('[data-testid="design-save"]').click();
  await designer.locator('[data-testid="design-status-saved"]').waitFor({ timeout: 15000 });
  const savedGraph = await readGraph(workspace);
  assert.equal(savedGraph.intent.nodes.length, 1);
  report.checks.push("base-graph-designed-and-saved");

  // 4. The workflow bar: create a workflow from the saved graph, prove the
  //    selection is unambiguous, turn on adversarial review with a cap.
  const bar = panel.locator('[data-testid="workflow-bar"]');
  await bar.waitFor();
  // The popover portals its content to <body>, outside `bar`'s own DOM
  // subtree, so its fields are looked up from `page`, not scoped to `bar`.
  await bar.locator('[data-testid="workflow-bar-new"]').click();
  await page.locator('[data-testid="workflow-bar-new-name"]').fill("Ship it");
  await page.locator('[data-testid="workflow-bar-new-confirm"]').click();
  await bar.locator('[data-testid="workflow-bar-selected-badge"]').waitFor();
  const selectValue = (await bar.locator('[data-testid="workflow-bar-select"]').innerText()) ?? "";
  assert.match(selectValue, /Ship it/, "the selected workflow's name must be visible");
  const savedWorkflows = await readWorkflows(workspace);
  assert.equal(savedWorkflows.workflows.length, 1, JSON.stringify(savedWorkflows));
  assert.equal(savedWorkflows.selectedWorkflowId, savedWorkflows.workflows[0].id);
  report.checks.push("workflow-created-selected-and-persisted-to-workflows-json");

  await bar.locator('[data-testid="workflow-bar-adversarial-checkbox"]').click();
  const maxCycles = bar.locator('[data-testid="workflow-bar-max-cycles"]');
  await maxCycles.fill("2");
  await maxCycles.blur();
  await delay(300); // the settings write is fire-and-forget from a change handler
  const withSettings = await readWorkflows(workspace);
  assert.equal(withSettings.workflows[0].settings.adversarialReviewEnabled, true);
  assert.equal(withSettings.workflows[0].settings.maxReviewCycles, 2);
  report.checks.push("adversarial-checkbox-and-max-cycles-persist");

  // 5. Screenshots: the bar in light AND dark, every acceptance width, no
  //    horizontal overflow.
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Mentu", exact: true }).click();
    await bar.waitFor();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 0, `workflow bar must not overflow at ${width}px ${theme} (${overflow}px)`);
      await shot(page, `workflow-bar-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  report.checks.push("workflow-bar-screenshots-light-dark-no-overflow-1440-1100-900-760");

  // The Settings detour remounted the Mentu surfaces (same as the fork —
  // see accept-mentu-run-delegation.mjs), so the pane is back in its
  // default read-only view; re-enter the designer before running.
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  await panel.locator('[data-testid="work-graph-design"]').click();
  await designer.waitFor();

  // 6. Run the base graph for real (shell, no model) through the ONE
  //    existing path, then watch it back to the read-only view — proving
  //    the loop is wired to survive that mode switch.
  await designer.locator('[data-testid="design-run"]').click();
  await designer.locator('[data-testid="design-review"]').waitFor({ timeout: 15000 });
  await designer.locator('[data-testid="design-review-approve"]').click();
  await designer.locator('[data-testid="design-run-launched"]').waitFor({ timeout: 30000 });
  await designer.locator('[data-testid="design-watch"]').click();
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  await panel.locator('[data-work-graph-status="succeeded"]').first().waitFor({ timeout: 45000 });
  report.checks.push("base-graph-run-launched-and-succeeded-real-shell-node");

  // 7. The loop drives itself autonomously from here — this probe only
  //    OBSERVES what the daemon reports, never assumes a specific outcome:
  //    this dev daemon has no `pi` provider configured, so the honest,
  //    deterministic outcome is a compile refusal (the compiler's own
  //    false-success guard), proven live rather than assumed.
  const loopStatus = panel.locator('[data-testid="workflow-loop-status"]');
  await loopStatus.waitFor({ timeout: 30000 });
  await shot(page, "workflow-loop-live-first-observed.png");
  const observedPhases = new Set();
  const loopDeadline = Date.now() + 30000;
  let finalPhase = null;
  let finalText = null;
  while (Date.now() < loopDeadline) {
    const phase = await loopStatus.getAttribute("data-workflow-loop-phase");
    if (phase) observedPhases.add(phase);
    finalPhase = phase;
    finalText = (await loopStatus.innerText()) ?? "";
    if (phase && phase !== "awaiting_base" && phase !== "reviewing" && phase !== "fixing") break;
    await delay(500);
  }
  report.observedLoopPhases = [...observedPhases];
  report.finalLiveLoopPhase = finalPhase;
  report.finalLiveLoopText = finalText;
  // Never a lie either way: the loop must have LEFT its initial silence and
  // reported SOME real, named outcome — success is never claimed for a node
  // that was never actually run.
  assert.ok(finalPhase, `the loop never reported anything real: ${JSON.stringify([...observedPhases])}`);
  assert.doesNotMatch(
    finalText ?? "",
    /passed/i,
    "this dev daemon has no pi provider configured, so a real 'passed' here would be a lie",
  );
  await shot(page, "workflow-loop-live-final.png");
  report.checks.push(`loop-drove-itself-and-reported-honestly (${finalPhase}: ${finalText})`);

  // 8. The two exact terminal outcomes — proven transition-by-transition
  //    by adversarial-loop.test.ts — rendered in the real running app by
  //    writing the SAME shape the feature itself persists, through the
  //    SAME file, then reloading the pane. Clearly a SEEDED render check,
  //    not a live multi-cycle run (which would need a real, reachable pi
  //    endpoint this dev daemon does not have).
  const beforeSeed = await readWorkflows(workspace);
  const workflowId = beforeSeed.workflows[0].id;
  const seedLedger = (phase, cycle, message) => ({
    workflowId,
    token: "deadbeef",
    baseRunId: "seeded-run",
    baseNodeIds: ["base-step"],
    maxCycles: 2,
    cycle,
    phase,
    reviewNodeIds: [`adv-deadbeef-review-${cycle}`],
    fixNodeIds: cycle > 1 ? [`adv-deadbeef-fix-${cycle - 1}`] : [],
    activeNodeId: null,
    startedAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:05:00.000Z",
    message,
  });

  await writeWorkflows(workspace, {
    ...beforeSeed,
    workflows: beforeSeed.workflows.map((workflow) =>
      workflow.id === workflowId
        ? { ...workflow, lastLoop: seedLedger("passed", 1, "Adversarial review passed on cycle 1.") }
        : workflow,
    ),
  });
  await panel.locator('[data-testid="work-graph-refresh"]').click();
  await page.reload();
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await bar.waitFor();
  await loopStatus.waitFor({ timeout: 15000 });
  await bar.locator('[data-testid="workflow-bar-select"]').waitFor();
  assert.match((await loopStatus.innerText()) ?? "", /Adversarial review passed on cycle 1\./);
  await shot(page, "workflow-loop-seeded-passed.png");

  await writeWorkflows(workspace, {
    ...beforeSeed,
    workflows: beforeSeed.workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            lastLoop: seedLedger(
              "stopped_failing",
              2,
              "Stopped after 2 review cycles, still failing.",
            ),
          }
        : workflow,
    ),
  });
  await page.reload();
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await bar.waitFor();
  await loopStatus.waitFor({ timeout: 15000 });
  const stoppedText = (await loopStatus.innerText()) ?? "";
  assert.equal(
    stoppedText.trim(),
    "Stopped after 2 review cycles, still failing.",
    `the required exact message must render verbatim: ${JSON.stringify(stoppedText)}`,
  );
  await shot(page, "workflow-loop-seeded-stopped-failing-light.png");
  await selectSettingsTheme(page, "dark");
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await bar.waitFor();
  await loopStatus.waitFor();
  await shot(page, "workflow-loop-seeded-stopped-failing-dark.png");
  await selectSettingsTheme(page, "light");
  report.checks.push("both-exact-terminal-outcome-strings-render-in-the-real-app");
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
      observedLoopPhases: report.observedLoopPhases,
      finalLiveLoopPhase: report.finalLiveLoopPhase,
      finalLiveLoopText: report.finalLiveLoopText,
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
