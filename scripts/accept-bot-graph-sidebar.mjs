// Hidden Electron/CDP rendering of real sidebar components with explicit graph/session snapshots.
// No graph execution, runtime provisioning, model inference, or installed-app interaction.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { captureDescendants, settleOwnedProcesses, startAcceptanceProcess, stopAcceptanceProcess } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { startForegroundObservation, verifyForegroundObservation } from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const require = createRequire(path.join(appDir, "package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")));
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")));
const evidence = path.join(root, ".preflight/acceptance");
await mkdir(evidence, { recursive: true });
const receipt = await mkdtemp(path.join(evidence, "bot-graph-sidebar-"));
const world = await mkdtemp(path.join(tmpdir(), "drogon-sidebar-"));
const dataDir = path.join(world, "data");
const profileDir = path.join(world, "profile");
const siteDir = path.join(world, "site");
const report = { status: "FAILED", fixture: "Rendered snapshot fixture; not graph execution", world, checks: [], cleanup: [], screenshots: [], screenshotTimings: [] };
const COLD_SCREENSHOT_TIMEOUT_MS = 120_000;
async function timedScreenshot(page, shotPath) {
  const startedAt = Date.now();
  await page.screenshot({ path: shotPath, animations: "disabled", timeout: 120_000 });
  report.screenshotTimings.push({ path: shotPath, durationMs: Date.now() - startedAt, timeoutMs: COLD_SCREENSHOT_TIMEOUT_MS });
  report.screenshots.push(shotPath);
}
const owned = new Map();
let server, daemon, daemonHandle, desktop, browser, foreground, page;
let cancelled = false;
const cancel = () => { cancelled = true; void browser?.close().catch(() => {}); };
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const checkCancelled = () => { if (cancelled) throw new Error("Validation cancelled"); };
const env = {
  ...process.env,
  PATH: [path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
  DROGON_DATA_DIR: dataDir,
  DROGON_ELECTRON_PROFILE: profileDir,
  DROGON_BACKGROUND_WINDOW: "1",
  DROGON_USAGE_FORCE_UNAVAILABLE: "claude,codex",
};
async function until(check, description) {
  for (let i = 0; i < 120; i += 1) {
    checkCancelled();
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
try {
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  await mkdir(siteDir, { recursive: true });
  if (process.platform === "darwin") foreground = await startForegroundObservation(receipt);
  checkCancelled();
  const assets = path.join(appDir, "out/renderer/assets");
  const styles = (await readdir(assets)).filter((file) => /^index-.*\.css$/.test(file));
  assert.equal(styles.length, 1, "Build the desktop before running sidebar acceptance");
  // Use the freshly built product stylesheet, including its generated utilities and bundled fonts.
  await writeFile(path.join(siteDir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/@fs/${path.join(assets, styles[0])}"></head><body><div id="root"></div><script type="module" src="/@fs/${path.join(appDir, "src/renderer/src/features/shell/WorktreeWorkflow.fixture.tsx")}"></script></body></html>`);
  server = await createServer({
    configFile: false, root: siteDir, plugins: [react({ include: /\.[jt]sx$/ })],
    resolve: { alias: { react: path.dirname(require.resolve("react/package.json")), "react-dom": path.dirname(require.resolve("react-dom/package.json")) } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [world, root] } },
  });
  await server.listen();
  checkCancelled();
  const daemonPath = path.join(root, "target/debug/drogond");
  const cli = path.join(root, "target/debug/drogon-cli");
  daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], { cwd: world, env, stdio: "ignore" });
  let daemonError;
  daemon.once("error", (error) => { daemonError = error; });
  await captureDescendants([daemon.pid], owned);
  daemonHandle = packagedFixtureDaemon(daemonPath, cli, dataDir);
  await until(() => {
    if (daemonError) throw daemonError;
    return daemonHandle.capture().then(() => true, () => false);
  }, "fixture daemon ready");
  checkCancelled();
  desktop = startAcceptanceProcess(require("electron"), [appDir, "--remote-debugging-port=0"], {
    env: { ...env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}`, DROGON_WINDOW_BOUNDS: "900x850+0+0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const [endpoint] = await Promise.all([new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("No Electron debugging endpoint")), 15_000);
    desktop.once("error", (error) => { clearTimeout(timer); reject(error); });
    desktop.once("exit", () => { clearTimeout(timer); reject(new Error("Electron exited before CDP connection")); });
    desktop.stderr.on("data", (bytes) => {
      output = (output + bytes).slice(-8192);
      const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  }), captureDescendants([desktop.pid], owned)]);
  checkCancelled();
  browser = await require("playwright").chromium.connectOverCDP(endpoint);
  await until(() => { page = browser.contexts()[0]?.pages()[0]; return Boolean(page); }, "rendered page");
  page.setDefaultTimeout(15_000);
  await emulatePageFocus(page);
  report.pageErrors = [];
  page.on("pageerror", (error) => { if (report.pageErrors.length < 20) report.pageErrors.push(error.message); });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.delegationSidebarFixture));
  await captureDescendants([process.pid], owned);
  owned.delete(process.pid);
  const graph = () => page.getByRole("button", { name: /Work Graph ·/ });
  const main = page.getByText("Main agent · running", { exact: true });
  await until(async () => await graph().getAttribute("aria-expanded") === "true", "main automatically revealed");
  assert.equal(await main.isVisible(), true);
  assert.equal(await graph().evaluate((button) => getComputedStyle(document.getElementById(button.getAttribute("aria-controls"))).flexDirection), "column", "fixture must load the product's generated utility styles");
  assert.equal(await graph().evaluate((button) => getComputedStyle(button).fontSize), "12px");
  assert.equal(await page.getByText("pi · fixture/model", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Native workspace sessions", { exact: true }).isVisible(), true);
  assert.deepEqual((await page.locator("[data-worktree-agent-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-worktree-agent-row")))).sort(), ["bot-dispatcher", "main-session", "worker-deck", "worker-page"]);
  report.checks.push("native graph main automatically visible beside its workers while the exited Bot remains separate");
  const expanded = path.join(receipt, "main-and-workers.png");
  await timedScreenshot(page, expanded);
  await page.locator('[data-worktree-agent-row="worker-deck"]').click();
  assert.equal(await page.evaluate(() => window.delegationSidebarFixture.calls.selectedSession), "worker-deck");
  await graph().click();
  const poll = await page.evaluate(() => window.delegationSidebarFixture.calls.polls);
  await until(async () => await page.evaluate(() => window.delegationSidebarFixture.calls.polls) >= poll + 2, "two subsequent polls");
  assert.equal(await graph().getAttribute("aria-expanded"), "false");
  assert.equal(await main.isVisible(), false);
  report.checks.push("manual collapse survives repeated same-run polling; worker row selects only its recorded session");
  await page.evaluate(() => window.delegationSidebarFixture.disconnect(true));
  await page.getByRole("button", { name: "Work Graph · Unverifiable" }).waitFor();
  assert.equal(await graph().getAttribute("aria-expanded"), "false");
  await graph().click();
  assert.equal(await page.getByText("Main agent · unverifiable", { exact: true }).isVisible(), true);
  const unavailable = path.join(receipt, "unverifiable.png");
  await timedScreenshot(page, unavailable);
  await graph().click();
  await page.evaluate(() => window.delegationSidebarFixture.disconnect(false));
  await page.getByRole("button", { name: "Work Graph · Running" }).waitFor();
  assert.equal(await graph().getAttribute("aria-expanded"), "false");
  await page.evaluate(() => window.delegationSidebarFixture.nextRun());
  await until(async () => await graph().getAttribute("aria-expanded") === "true", "new run revealed");
  assert.equal(await page.getByText("Run fixture-workflow-2", { exact: true }).isVisible(), true);
  const calls = await page.evaluate(() => window.delegationSidebarFixture.calls);
  assert.equal(calls.starts, 0); assert.equal(calls.stops, 0);
  report.checks.push("contact loss is unverifiable, recovery preserves collapse, only a new run reopens; zero start/stop side effects");
  await page.evaluate(() => window.delegationSidebarFixture.unmount());
  assert.deepEqual(report.pageErrors, []);
  checkCancelled();
  report.status = "PASSED";
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (page) {
    try { await page.screenshot({ path: path.join(receipt, "failure.png"), timeout: 3000 }); }
    catch { /* Preserve the original failure if the page is no longer available. */ }
  }
} finally {
  async function clean(name, action) {
    try { await action(); report.cleanup.push(`${name}: completed`); }
    catch (error) { report.status = "FAILED"; report.cleanup.push(`${name}: unverifiable: ${error.message}`); }
  }
  await clean("process capture", async () => { await captureDescendants([process.pid], owned); owned.delete(process.pid); });
  if (browser) await clean("CDP", () => browser.close());
  if (desktop) await clean("desktop", async () => assert.equal((await stopAcceptanceProcess(desktop)).verdict, "exited"));
  if (daemonHandle) await clean("daemon", () => daemonHandle.stop());
  if (server) await clean("fixture server", () => server.close());
  if (foreground) await clean("OS observer", async () => {
    report.osForeground = await foreground.stop();
    const desktopPids = [...owned].filter(([, identity]) => identity.includes("Electron.app/Contents/")).map(([pid]) => pid);
    verifyForegroundObservation(report.osForeground, desktopPids);
    report.checks.push("OS activation and window visibility preserved throughout launch, interaction and shutdown");
  });
  await clean("owned processes", async () => {
    report.processes = await settleOwnedProcesses(owned);
    assert.ok(report.processes.every((entry) => entry.verdict === "exited"));
  });
  if (cancelled) { report.status = "FAILED"; report.failure ??= "Validation cancelled"; }
  if (report.status === "PASSED") await clean("fixture directory removal", () => rm(world, { recursive: true, force: true }));
  await writeFile(path.join(receipt, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
  console.log(JSON.stringify({ status: report.status, failure: report.failure, checks: report.checks, report: path.join(receipt, "report.json") }));
  process.exitCode = report.status === "PASSED" ? 0 : 1;
}
