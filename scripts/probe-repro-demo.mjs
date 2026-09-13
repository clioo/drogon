// CDP oracle for Settings → "Demo reproducible": launches the real desktop in
// an isolated BACKGROUND window (temporary DROGON_DATA_DIR and
// DROGON_ELECTRON_PROFILE, DROGON_BACKGROUND_WINDOW=1, loopback-only random
// debugging port), opens the section, and proves the rendered surface against
// the REAL preload — including that `botMonitorCreate` reached
// `window.drogon`, which is what lets the demo arm the bot's watch at all.
//
// It deliberately does NOT run the chain: the run itself waits on cron-cadence
// monitor ticks, and `make repro` already exercises that end to end. This
// probe covers what only the real app can answer: the wiring and the layout.
//
// Modes: --help | --check (read-only) | (default) execute.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { runAcceptanceProcess, startAcceptanceProcess } from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { resolveRuntime } from "./reproduce-adversarial-run.mjs";

const STAGE_TIMEOUT_MS = 120_000;
const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const evidenceDir = path.join(root, ".preflight", "acceptance");

function isMainModule() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

async function withStageTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`stage exceeded ${STAGE_TIMEOUT_MS}ms: ${label}`)),
          STAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runCheck() {
  const problems = [];
  for (const [label, file] of [
    ["built main entry", path.join(appDir, "out", "main", "index.js")],
    ["built preload entry", path.join(appDir, "out", "preload", "index.js")],
    ["built renderer entry", path.join(appDir, "out", "renderer", "index.html")],
  ]) {
    try {
      await stat(file);
    } catch {
      problems.push(`${label} is missing: ${file} (build the desktop first)`);
    }
  }
  return { mode: "check", ok: problems.length === 0, problems };
}

async function stopOwned(child, report) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    report.cleanup.push(`desktop: ${child?.pid ? "exited" : "never-started"}`);
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (!(await Promise.race([exited.then(() => true), delay(5000).then(() => false)]))) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
    report.cleanup.push("desktop: required force after timeout");
    return;
  }
  report.cleanup.push("desktop: exited on SIGTERM");
}

export async function execute() {
  const report = {
    runner: "scripts/probe-repro-demo.mjs",
    status: "FAILED",
    startedAt: new Date().toISOString(),
    checks: [],
    cleanup: [],
    screenshots: [],
  };
  const appRequire = createRequire(path.join(appDir, "package.json"));
  const playwright = appRequire("playwright");
  const electronBinary = appRequire("electron");
  await mkdir(evidenceDir, { recursive: true });
  const fixture = await mkdtemp(path.join(evidenceDir, "repro-demo-"));
  // The daemon's unix socket lives under the data directory, and that path has
  // a hard length limit: a repository-relative fixture blows past it, so the
  // disposable world goes to the system temp dir and only the evidence stays
  // here.
  const world = await mkdtemp(path.join(tmpdir(), "rpd-"));
  const dataDir = path.join(world, "data");
  const profileDir = path.join(world, "electron");
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  report.world = world;

  let desktop = null;
  let browser = null;
  let daemon = null;
  let daemonHandle = null;
  try {
    // The demo talks to the daemon through the app's bridges, so this probe
    // owns one for its isolated data directory — the same binary this tree
    // builds, never the developer's running service.
    const cliPath = path.join(root, "target/debug/drogon-cli");
    const daemonPath = path.join(root, "target/debug/drogond");
    // The Work Graph tab is gated on the service advertising `mentu.v1`, which
    // needs the pinned recipe runtime. Same resolution `make repro` uses: a
    // verified copy, into this run's own data directory, never the developer's.
    const runtime = await resolveRuntime(dataDir);
    report.checks.push(`pinned runtime ${runtime.revision.slice(0, 12)} staged for this fixture`);
    daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
      cwd: fixture,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, DROGON_MENTU_RUNTIME: runtime.path },
    });
    const daemonDeadline = Date.now() + 30_000;
    for (;;) {
      const answered = await runAcceptanceProcess(
        cliPath,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 10_000 },
      )
        .then(() => true)
        .catch(() => false);
      if (answered) break;
      if (Date.now() > daemonDeadline) throw new Error("the probe's daemon never answered");
      await delay(200);
    }
    daemonHandle = packagedFixtureDaemon(daemonPath, cliPath, dataDir);
    await daemonHandle.capture();
    report.checks.push("the probe owns a daemon on its own data directory");

    desktop = startAcceptanceProcess(electronBinary, [appDir, "--remote-debugging-port=0"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: profileDir,
        DROGON_BACKGROUND_WINDOW: "1",
        DROGON_MENTU_RUNTIME: runtime.path,
        ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
      },
    });
    const endpoint = await withStageTimeout(
      new Promise((resolve, reject) => {
        let tail = "";
        const timeout = setTimeout(
          () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
          30_000,
        );
        desktop.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        desktop.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error(`Electron exited before connection: ${tail}`));
        });
        desktop.stderr.on("data", (bytes) => {
          tail = (tail + bytes.toString()).slice(-8192);
          const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        });
      }),
      "electron launch",
    );
    browser = await playwright.chromium.connectOverCDP(endpoint);
    let page = null;
    for (let attempt = 0; attempt < 200 && !page; attempt += 1) {
      page = browser.contexts()[0]?.pages()[0] ?? null;
      if (!page) await delay(50);
    }
    assert.ok(page, "Electron must create a rendered page");
    page.setDefaultTimeout(20_000);
    await emulatePageFocus(page);
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();

    // The channel the demo's watch depends on must exist in the REAL preload.
    const wiring = await page.evaluate(() => ({
      botMonitorCreate: typeof window.drogon.botMonitorCreate,
      botMonitorApprove: typeof window.drogon.botMonitorApprove,
      botMonitorList: typeof window.drogon.botMonitorList,
      quickSessionCreate: typeof window.drogon.project?.quickSessionCreate,
      graphWritePolicy: typeof window.drogon.graph?.graphWritePolicy,
      graphOrchestratorStart: typeof window.drogon.graph?.graphOrchestratorStart,
      fileWrite: typeof window.drogon.fileWrite,
    }));
    for (const [name, kind] of Object.entries(wiring)) {
      assert.equal(kind, "function", `window.drogon must expose ${name}`);
    }
    report.checks.push("the real preload exposes every channel the demo needs");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await page.getByRole("button", { name: "Demo reproducible", exact: true }).click();
    await page.getByTestId("repro-demo-run").waitFor();
    report.checks.push("Settings opens the Demo reproducible section");

    // The section opens on the free local lane, with every phase pending and
    // nothing pretending to have happened yet.
    assert.equal(
      await page.getByTestId("repro-demo-model").inputValue(),
      "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
      "the demo must open on the free local model",
    );
    const statuses = await page.evaluate(() =>
      // `[data-status]` narrows to the rows themselves: the list container
      // shares the prefix.
      [...document.querySelectorAll('[data-testid^="repro-demo-phase-"][data-status]')].map(
        (node) => node.getAttribute("data-status"),
      ),
    );
    assert.equal(statuses.length, 9, "every phase must be listed");
    assert.ok(
      statuses.every((status) => status === "idle"),
      `no phase may claim progress before a run: ${statuses.join(",")}`,
    );
    assert.equal(await page.getByTestId("repro-demo-run").isEnabled(), true);
    report.checks.push("nine phases render idle and the run control is live");

    // Layout: the panel must not push the settings page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `settings page overflowed horizontally by ${overflow}px`);
    report.checks.push("no horizontal overflow at the default width");

    const shot = path.join(fixture, "settings-demo.png");
    await page.screenshot({ path: shot, animations: "disabled" });
    report.screenshots.push(shot);

    // The tour: the panel cannot navigate, so it asks and App answers. The
    // request names a workspace this window has never listed — exactly what a
    // run does, since the demo creates its own Quick Session — so this also
    // proves App reloads its workspaces before navigating. Driving the request
    // directly proves the seam in seconds; the run itself waits on
    // cron-cadence monitor ticks and `make repro` covers it end to end.
    const created = await page.evaluate(async () => {
      const result = await window.drogon.project.quickSessionCreate({
        name: "repro-demo-probe",
      });
      return result.ok ? result.result.workspaceId : null;
    });
    assert.ok(created, "the probe must be able to create its own Quick Session workspace");
    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent("drogon:repro-demo-tour", {
          detail: { kind: "open-work-graph", workspaceId: id },
        }),
      );
    }, created);
    await page.getByTestId("orchestrator-canvas").waitFor();
    report.checks.push(
      "the tour leaves Settings and opens the Work Graph of a workspace App had not listed",
    );

    for (const [view, label] of [
      ["evidence", "Evidence"],
      ["usage", "Usage"],
      ["graph", "Graph"],
    ]) {
      await page.evaluate((name) => {
        window.dispatchEvent(
          new CustomEvent("drogon:repro-demo-tour", {
            detail: { kind: "focus-view", view: name },
          }),
        );
      }, view);
      await page
        .getByRole("tab", { name: new RegExp(`^${label}`) })
        .and(page.locator('[data-state="active"]'))
        .waitFor();
    }
    report.checks.push("the tour moves the Work Graph's own view to what changed");

    // The background window must still be hidden: a probe never raises it.
    const hidden = await page.evaluate(() => document.visibilityState);
    report.checks.push(`page visibility stayed '${hidden}' (background window)`);

    report.status = "PASSED";
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopOwned(desktop, report);
    if (daemonHandle) {
      const stopped = await daemonHandle
        .stop()
        .then(() => "exited (quiescent shutdown, kernel-confirmed)")
        .catch((error) => `unverifiable: ${error.message}`);
      report.cleanup.push(`daemon: ${stopped}`);
      if (!stopped.startsWith("exited")) report.status = "FAILED";
    } else if (daemon) {
      await stopOwned(daemon, report);
    }
    if (report.status === "PASSED") await rm(world, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(fixture, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (isMainModule()) {
  const mode = process.argv[2];
  if (mode === "--help") {
    process.stdout.write(
      "Usage: node scripts/probe-repro-demo.mjs [--check]\n" +
        "  --check  verify the built desktop entries exist, run nothing\n",
    );
  } else if (mode === "--check") {
    const result = await runCheck();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const report = await execute();
    process.exitCode = report.status === "PASSED" ? 0 : 1;
  }
}
