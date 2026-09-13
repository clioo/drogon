// Acceptance for Settings → "Demo reproducible": runs the WHOLE demo from the
// app's own button and proves what a viewer would see — the bot, its watch,
// the firing, the Work Graph opening by itself, the adversarial rounds running
// there, and the evidence and cost at the end.
//
// The app is launched in a BACKGROUND window against a disposable data
// directory, with its own daemon whose PATH carries this repository's harness
// fixtures — so every role in the run executes for real with no model
// inference and no provider spend, exactly like `make repro`. The developer's
// Drogon, data directory and sessions are never touched.
//
// Modes: --help | --check (read-only) | (default) execute.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { runAcceptanceProcess, startAcceptanceProcess } from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { resolveRuntime } from "./reproduce-adversarial-run.mjs";
import { writeHarnessFixtures } from "./reproduce-harness-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const evidenceDir = path.join(root, ".preflight", "acceptance");
/** The fixture lane: OpenCode's shell adapter, with an id the rate card
 *  prices, so the run exercises the cost column too. */
const FIXTURE_HARNESS = "opencode";
const FIXTURE_MODEL = "fixture/dog-tinder";
/** The watch ticks on a cron minute and the released session has to open its
 *  own turn, so the whole demo is minutes, not seconds. */
const RUN_BUDGET_MS = 12 * 60_000;

function isMainModule() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

export async function runCheck() {
  const problems = [];
  for (const [label, file] of [
    ["built main entry", path.join(appDir, "out", "main", "index.js")],
    ["built preload entry", path.join(appDir, "out", "preload", "index.js")],
    ["built renderer entry", path.join(appDir, "out", "renderer", "index.html")],
    ["daemon binary", path.join(root, "target", "debug", "drogond")],
    ["cli binary", path.join(root, "target", "debug", "drogon-cli")],
  ]) {
    try {
      await stat(file);
    } catch {
      problems.push(`${label} is missing: ${file}`);
    }
  }
  return { mode: "check", ok: problems.length === 0, problems };
}

async function stopOwned(child, label, report) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    report.cleanup.push(`${label}: ${child?.pid ? "exited" : "never-started"}`);
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (!(await Promise.race([exited.then(() => true), delay(5000).then(() => false)]))) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
    report.cleanup.push(`${label}: required force after timeout`);
    return;
  }
  report.cleanup.push(`${label}: exited on SIGTERM`);
}

export async function execute({ runs = 2 } = {}) {
  const report = {
    runner: "scripts/accept-repro-demo.mjs",
    status: "FAILED",
    startedAt: new Date().toISOString(),
    lane: `${FIXTURE_HARNESS}/${FIXTURE_MODEL} (local fixture, no inference)`,
    checks: [],
    runs: [],
    phases: {},
    cleanup: [],
    screenshots: [],
  };
  const appRequire = createRequire(path.join(appDir, "package.json"));
  const playwright = appRequire("playwright");
  const electronBinary = appRequire("electron");
  await mkdir(evidenceDir, { recursive: true });
  const fixture = await mkdtemp(path.join(evidenceDir, "repro-demo-run-"));
  // The daemon's unix socket lives under the data directory and that path has a
  // hard length limit, so the disposable world goes to the system temp dir.
  const world = await mkdtemp(path.join(tmpdir(), "rpa-"));
  const dataDir = path.join(world, "data");
  const profileDir = path.join(world, "electron");
  const binDir = path.join(world, "bin");
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  report.world = world;

  let desktop = null;
  let daemon = null;
  let daemonHandle = null;
  let browser = null;
  try {
    const cliPath = path.join(root, "target/debug/drogon-cli");
    const daemonPath = path.join(root, "target/debug/drogond");
    const runtime = await resolveRuntime(dataDir);
    await writeHarnessFixtures(binDir, [FIXTURE_HARNESS]);
    // What the fixture agent needs to reach the CLI and its stages. The in-app
    // demo writes no context file of its own, so the daemon carries the path
    // and the fixture resolves its workspace from the registry.
    const contextPath = path.join(world, "repro-context.json");
    await writeFile(
      contextPath,
      `${JSON.stringify(
        {
          cli: cliPath,
          dataDir,
          stagesDir: path.join(root, "scripts/scenarios/dog-tinder"),
          model: FIXTURE_MODEL,
          invocationLog: path.join(world, "harness-invocations.jsonl"),
          specPath: "specs/dog-tinder.md",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(path.join(world, "harness-invocations.jsonl"), "");
    // The daemon resolves harnesses from ITS path, so the fixture shim has to
    // lead the daemon's own PATH — never the developer's environment.
    const env = {
      ...process.env,
      PATH: [binDir, path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
        path.delimiter,
      ),
      DROGON_MENTU_RUNTIME: runtime.path,
      DROGON_REPRO_CONTEXT: contextPath,
    };

    daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
      cwd: world,
      stdio: ["ignore", "ignore", "ignore"],
      env,
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const answered = await runAcceptanceProcess(
        cliPath,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 10_000 },
      )
        .then(() => true)
        .catch(() => false);
      if (answered) break;
      if (Date.now() > deadline) throw new Error("the acceptance daemon never answered");
      await delay(200);
    }
    daemonHandle = packagedFixtureDaemon(daemonPath, cliPath, dataDir);
    await daemonHandle.capture();
    report.checks.push("daemon owned by this run, with the harness fixture on its PATH");

    desktop = startAcceptanceProcess(electronBinary, [appDir, "--remote-debugging-port=0"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: profileDir,
        DROGON_BACKGROUND_WINDOW: "1",
      },
    });
    const endpoint = await new Promise((resolve, reject) => {
      let tail = "";
      const timer = setTimeout(
        () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
        30_000,
      );
      desktop.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      desktop.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Electron exited before connection: ${tail}`));
      });
      desktop.stderr.on("data", (bytes) => {
        tail = (tail + bytes.toString()).slice(-8192);
        const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    browser = await playwright.chromium.connectOverCDP(endpoint);
    let page = null;
    for (let attempt = 0; attempt < 200 && !page; attempt += 1) {
      page = browser.contexts()[0]?.pages()[0] ?? null;
      if (!page) await delay(50);
    }
    assert.ok(page, "Electron must create a rendered page");
    page.setDefaultTimeout(30_000);
    await emulatePageFocus(page);
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();

    for (let attempt = 1; attempt <= runs; attempt += 1) {
      // Everything below is one whole demo, driven through the real UI.
      // Open the demo and choose the fixture lane, through the real controls.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
      await page.getByRole("button", { name: "Reproducible demo", exact: true }).click();
      await page.getByTestId("repro-demo-run").waitFor();
      await page.getByTestId("repro-demo-runtime").selectOption(FIXTURE_HARNESS);
      await page.getByTestId("repro-demo-model").fill(FIXTURE_MODEL);
      await page.getByRole("button", { name: "2", exact: true }).click();
      await page.getByTestId("repro-demo-run").click();
      report.checks.push("the demo starts from its own button on the fixture lane");

      // The panel's own phase rows are NOT a reliable oracle here: the tour
      // leaves Settings as soon as the bot and its watch exist, which is
      // seconds after the click. Everything below is read from the surfaces
      // the tour opens and from the daemon itself.

      // First stop of the tour: the page that shows what was just configured.
      await page.getByRole("heading", { name: "Bots", exact: true }).waitFor({ timeout: 120_000 });
      // The page loads its bots asynchronously, and every earlier run's bot is
      // still listed — which is the point: they coexist. Wait for the one this
      // run just made, i.e. a name no earlier run in this report claimed.
      const seenNames = new Set(report.runs.map((entry) => entry.runName));
      const runName = await (async () => {
        const stop = Date.now() + 90_000;
        for (;;) {
          const text = await page.locator("body").innerText();
          const found = [...text.matchAll(/dog-tinder-[0-9a-f]{6}/g)]
            .map((match) => match[0])
            .find((name) => !seenNames.has(name));
          if (found) return found;
          if (Date.now() > stop)
            throw new Error(
              `Bots never showed run ${attempt}'s own bot: ${text.slice(0, 220).replace(/\s+/g, " ")}`,
            );
          await delay(1000);
        }
      })();
      assert.ok(
        !seenNames.has(runName),
        `run ${attempt} reused the name of an earlier run: ${runName}`,
      );
      report.runName = runName;
      report.checks.push(
        `run ${attempt} left Settings for Bots, showing '${runName}' — its own short name`,
      );
      const botsShot = path.join(fixture, `bots-configured-${attempt}.png`);
      await page.screenshot({ path: botsShot, animations: "disabled" });
      report.screenshots.push(botsShot);

      // The workspace this run created, resolved through the daemon: the demo
      // names its Quick Session project after the run, and the workspace is
      // the one registered at that project's path.
      const cli = async (...args) => {
        const { stdout } = await runAcceptanceProcess(
          cliPath,
          ["--data-dir", dataDir, "--json", ...args],
          { timeout: 30_000 },
        );
        const answer = JSON.parse(stdout);
        assert.equal(answer.ok, true, stdout);
        return answer.result;
      };
      const projects = await cli("project", "list");
      const project = (projects.projects ?? []).find((entry) => entry.name === runName);
      assert.ok(project, `the daemon must know the project '${runName}'`);
      const workspaces = await cli("workspace", "list");
      const demoWorkspaceId = (workspaces.workspaces ?? []).find(
        (entry) => entry.path === project.path,
      )?.id;
      assert.ok(demoWorkspaceId, `the daemon must know a workspace at ${project.path}`);

      // A PTY session gets a curated environment, so the shim cannot read the
      // context from the daemon's env the way a recipe step does: drop it in
      // the workspace the released session will run in. This is fixture
      // plumbing for THIS acceptance — the product ships nothing of the sort,
      // and a real agent just follows the instructions in its prompt.
      await mkdir(path.join(project.path, ".drogon"), { recursive: true });
      await writeFile(
        path.join(project.path, ".drogon/repro-context.json"),
        `${JSON.stringify(
          {
            cli: cliPath,
            dataDir,
            workspaceId: demoWorkspaceId,
            stagesDir: path.join(root, "scripts/scenarios/dog-tinder"),
            model: FIXTURE_MODEL,
            invocationLog: path.join(world, "harness-invocations.jsonl"),
            specPath: "specs/dog-tinder.md",
          },
          null,
          2,
        )}\n`,
      );

      // Second stop: the orchestration itself, once the watch releases the work.
      await page.getByTestId("orchestrator-canvas").waitFor({ timeout: 240_000 });
      report.checks.push("the app left Settings and opened the run's Work Graph by itself");
      const canvasShot = path.join(fixture, `orchestration-running-${attempt}.png`);
      await page.screenshot({ path: canvasShot, animations: "disabled" });
      report.screenshots.push(canvasShot);

      // The rounds run there. The daemon's own orchestrator status is the
      // verdict — never the rendered text.
      const orchestratorStatus = async () => {
        const { stdout } = await runAcceptanceProcess(
          cliPath,
          [
            "--data-dir",
            dataDir,
            "--json",
            "graph",
            "orchestrator-status",
            "--workspace",
            demoWorkspaceId,
          ],
          { timeout: 30_000 },
        );
        const answer = JSON.parse(stdout);
        return answer.ok ? (answer.result.run ?? null) : null;
      };
      const rounds = await (async () => {
        const stop = Date.now() + RUN_BUDGET_MS;
        for (;;) {
          const run = await orchestratorStatus().catch(() => null);
          if (run && ["passed", "exhausted", "failed", "stopped"].includes(run.status)) return run;
          if (Date.now() > stop) throw new Error("the orchestration did not settle in budget");
          await delay(2000);
        }
      })();
      assert.equal(
        rounds.status,
        "passed",
        `the fixture lane must finish green, got ${rounds.status}`,
      );
      const roles = (rounds.steps ?? []).map((step) => `${step.iteration}:${step.phase}:${step.verdict ?? step.status}`);
      assert.ok(
        roles.some((entry) => entry.endsWith("findings")),
        `the adversarial round must find the missing undo: ${roles.join(", ")}`,
      );
      report.rounds = roles;
      report.checks.push(`the orchestration ran its rounds and passed: ${roles.join(" · ")}`);

      // Back in Settings: the panel kept the run and shows what it cost.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
      await page.getByRole("button", { name: "Reproducible demo", exact: true }).click();
      // Back in Settings the panel is mounted again, so its own rows are
      // readable: wait for the last phase to settle there.
      await (async () => {
        const stop = Date.now() + 2 * 60_000;
        for (;;) {
          const status = await page
            .getByTestId("repro-demo-phase-evidence")
            .getAttribute("data-status")
            .catch(() => null);
          if (status === "done") return;
          if (status === "failed") {
            const note = await page.getByTestId("repro-demo-phase-evidence").innerText();
            throw new Error(`the evidence phase failed: ${note.replace(/\s+/g, " ")}`);
          }
          if (Date.now() > stop) throw new Error("the ledgers and the cost never settled");
          await delay(1000);
        }
      })();
      const cost = await page.getByTestId("repro-demo-cost").innerText();
      assert.match(cost, /\$\d/, `the cost tile must show a real number: ${cost}`);
      report.cost = cost.replace(/\s+/g, " ").trim();
      const evidence = await page.getByTestId("repro-demo-evidence").innerText();
      assert.match(evidence, /undo/i, "the evidence must name what the rounds found");
      const release = await page.getByTestId("repro-demo-release").innerText();
      assert.match(
        release,
        /the bot's own watch/,
        `the work must be released by the watch, not by the panel: ${release}`,
      );
      report.checks.push("the bot's own watch released the work — not the panel's fallback");
      report.checks.push(`the panel survived the tour and reports the cost: ${report.cost}`);
        report.runs.push({ attempt, runName, rounds: roles, cost: report.cost });
      const panelShot = path.join(fixture, `settings-after-run-${attempt}.png`);
      await page.screenshot({ path: panelShot, animations: "disabled" });
      report.screenshots.push(panelShot);
    }

    report.status = "PASSED";
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopOwned(desktop, "desktop", report);
    if (daemonHandle) {
      const stopped = await daemonHandle
        .stop()
        .then(() => "exited (quiescent shutdown, kernel-confirmed)")
        .catch((error) => `unverifiable: ${error.message}`);
      report.cleanup.push(`daemon: ${stopped}`);
      if (!stopped.startsWith("exited")) report.status = "FAILED";
    } else {
      await stopOwned(daemon, "daemon", report);
    }
    if (report.status === "PASSED") await rm(world, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(fixture, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (isMainModule()) {
  const mode = process.argv[2];
  if (mode === "--help") {
    process.stdout.write(
      "Usage: node scripts/accept-repro-demo.mjs [--check] [--runs <1-5>]\n" +
        "  --check      verify the built desktop and core binaries exist, run nothing\n" +
        "  --runs <n>   how many whole demos to run back to back (default 2: the\n" +
        "               second one proves a run can be repeated)\n",
    );
  } else if (mode === "--check") {
    const result = await runCheck();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const runsFlag = process.argv.indexOf("--runs");
    const runs = runsFlag === -1 ? 2 : Number(process.argv[runsFlag + 1]);
    if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
      process.stderr.write("--runs takes 1..5\n");
      process.exitCode = 1;
    }
    const report = await execute({ runs });
    process.exitCode = report.status === "PASSED" ? 0 : 1;
  }
}
