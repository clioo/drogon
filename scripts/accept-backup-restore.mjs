// Focused CDP acceptance for install-resilience P6: the pre-migration
// backups the daemon already writes must be RESTORABLE from the product.
//
// Real packaged app over CDP in a BACKGROUND window
// (DROGON_BACKGROUND_WINDOW=1, its own temp DROGON_DATA_DIR and
// DROGON_ELECTRON_PROFILE, never /Applications, never the developer's data).
// The backup under test is produced by the REAL mechanism: the bundled
// daemon migrates a genuinely old fixture schema forward. The rollback skew
// (data newer than this build) is then manufactured the same way the
// upgrade-safety suites manufacture it: the live `schema_versions` row is
// bumped past this build's supported version. That is exactly the condition
// rolling back to an older bundle produces — recorded version > supported —
// and it is what turns the overlay on.
//
// Proven here, end to end:
//   1. the data-dir lock refusal: `backups restore` refuses with
//      runtime_busy while a real bundled drogond holds its whole-lifetime
//      flock (the mutual-exclusion evidence for the drogon-core lock mirror);
//   2. the refusal overlay renders with the restore control listing the REAL
//      backup as restorable, captured in light AND dark (real settings
//      theme pipeline) at 1440 and 760;
//   3. the honest confirmation copy (overwrite + snapshot-first + the loss
//      sentence) gates the destructive click — nothing restores without it;
//   4. restore succeeds, the app relaunches itself, lands in a HEALTHY app
//      (no overlay), and the data recorded after the backup is gone while
//      the pre-restore snapshot exists on disk;
//   5. the CLI restore path succeeds outright once no daemon holds the lock.
//
// Usage: node scripts/accept-backup-restore.mjs [--bundle <Drogon.app>] [--keep]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const execFileP = promisify(execFile);
const keep = process.argv.includes("--keep");
const bundleArgIndex = process.argv.indexOf("--bundle");
const root = fileURLToPath(new URL("..", import.meta.url));
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);

// The packaged bundle under test: my branch's build (passed via --bundle),
// never an installed app.
let bundle = bundleArgIndex >= 0 ? process.argv[bundleArgIndex + 1] : null;
if (!bundle) {
  const dist = path.join(root, "dist");
  const candidates = existsSync(dist) ? (await readdir(dist)).sort() : [];
  const newest = candidates.at(-1);
  assert.ok(newest, "no packaged bundle under dist/ — pass --bundle");
  bundle = path.join(dist, newest, "Drogon-darwin-arm64", "Drogon.app");
}
assert.ok(existsSync(bundle), `bundle missing: ${bundle}`);
const resources = path.join(bundle, "Contents", "Resources");
const appExecutable = path.join(bundle, "Contents", "MacOS", "Drogon");
const bundledDaemon = path.join(resources, "bin", exe("drogond"));
const bundledCli = path.join(resources, "bin", exe("drogon-cli"));
for (const p of [appExecutable, bundledDaemon, bundledCli])
  assert.ok(existsSync(p), `bundle is missing ${p}`);

const report = {
  schema: "drogon.accept-backup-restore/1",
  bundle,
  phases: {},
  screenshots: [],
  cleanup: [],
};

// Genuinely old fixture schema (bots recorded at v1), the same committed
// fixture the engine-level upgrade suite seeds.
const seedSql = await readFile(
  path.join(root, "crates", "drogon-core", "tests", "fixtures", "upgrades", "bots-v1.sql"),
  "utf8",
);

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "p6-restore-"));
const dataDir = path.join(fixtureRoot, "data");
const electronProfile = path.join(fixtureRoot, "electron");
const markerWorkspace = path.join(fixtureRoot, "marker-workspace");
await mkdir(dataDir, { recursive: true });
await mkdir(markerWorkspace, { recursive: true });
report.cleanup.push(`fixture root (disposable): ${fixtureRoot}`);

const minimalEnv = {
  ...process.env,
  DROGON_DATA_DIR: dataDir,
  DROGON_ELECTRON_PROFILE: electronProfile,
  DROGON_BACKGROUND_WINDOW: "1",
  PATH: `/usr/bin:/bin:/usr/sbin:/sbin`,
  SHELL: "/bin/sh",
};

async function runBundledCli(args, { expectFailure = false } = {}) {
  let result;
  try {
    result = await runAcceptanceProcess(bundledCli, ["--data-dir", dataDir, ...args], {
      env: minimalEnv,
    });
  } catch (error) {
    // Expected refusals exit non-zero with the failure envelope on stdout.
    if (!expectFailure) throw error;
    result = error;
  }
  let envelope = null;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    if (!expectFailure)
      throw new Error(`bundled CLI printed no JSON envelope: ${result.stderr}`);
  }
  if (expectFailure) {
    assert.ok(envelope, "refusal must print a JSON envelope");
    assert.equal(envelope.ok, false, `expected refusal, got: ${result.stdout}`);
    return envelope;
  }
  assert.equal(envelope.ok, true, `bundled CLI failed: ${result.stderr || result.stdout}`);
  return envelope;
}

/** Scoped process check: only drogond started against THIS fixture dir. */
async function testOwnedDaemons() {
  const { stdout } = await execFileP("pgrep", ["-f", `drogond --data-dir ${dataDir}$`]).catch(
    (error) => ({ stdout: "", code: error.code ?? 1 }),
  );
  return stdout.split("\n").filter(Boolean).map(Number);
}

async function stopTestOwnedDaemons() {
  const pids = await testOwnedDaemons();
  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
    report.cleanup.push(`SIGTERM -> drogond pid ${pid} (test-owned, fixture data dir)`);
  }
  for (let i = 0; i < 100 && (await testOwnedDaemons()).length > 0; i++)
    await delay(100);
  const survivors = await testOwnedDaemons();
  assert.deepEqual(survivors, [], `test-owned daemons still running: ${survivors}`);
  if (pids.length > 0)
    report.cleanup.push(`verified exited: test-owned drogond (${pids.length} signalled)`);
}

async function seedOldSchema() {
  const dbPath = path.join(dataDir, "drogon.sqlite3");
  if (existsSync(dbPath)) await rm(dbPath);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(dbPath + suffix)) await rm(dbPath + suffix);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(seedSql);
  db.close();
}

/** Bumps the live recorded `bots` version past this build's supported one —
 * the exact condition a rollback to an older bundle produces. */
async function skewPastThisBuild() {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "drogon.sqlite3"));
  db.prepare("UPDATE schema_versions SET version = 99 WHERE component = 'bots'").run();
  const row = db
    .prepare("SELECT version FROM schema_versions WHERE component = 'bots'")
    .get();
  db.close();
  assert.equal(row.version, 99, "skew applied");
}

const backupIds = async () =>
  (await readdir(path.join(dataDir, "backups"))).filter((n) => n.startsWith("pre-migration-"));

// --- Phase A: a real migration creates a real backup; the daemon's lock
// refuses a restore; marker data advances past the backup. -----------------
let firstBackupId;
{
  await seedOldSchema();
  const daemon = startAcceptanceProcess(bundledDaemon, ["--data-dir", dataDir], {
    env: minimalEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  report.cleanup.push(`started test-owned drogond pid ${daemon.pid}`);
  const daemonExited = new Promise((resolve) => daemon.once("exit", resolve));

  let status = null;
  for (let i = 0; i < 100 && !status; i++) {
    try {
      status = await runBundledCli(["status", "--json"]);
    } catch {
      await delay(100);
    }
  }
  assert.ok(status, "bundled daemon became healthy");

  const entries = await backupIds();
  assert.equal(entries.length, 1, `exactly one real backup after the migration: ${entries}`);
  firstBackupId = entries[0];
  report.phases.migration = { backupId: firstBackupId };

  // Marker data recorded AFTER the backup — a rollback must lose it.
  const marker = await runBundledCli([
    "workspace",
    "add",
    markerWorkspace,
    "--name",
    "p6-post-backup-marker",
    "--json",
  ]);
  const list = await runBundledCli(["workspace", "list", "--json"]);
  assert.ok(
    list.result.workspaces.some((w) => w.id === marker.result.id),
    "marker workspace exists before the restore",
  );

  // The lock refusal: a real bundled drogond holds the whole-lifetime flock;
  // the restore must refuse with the reason, from the same bundled CLI.
  const refused = await runBundledCli(["backups", "restore", firstBackupId, "--json"], {
    expectFailure: true,
  });
  assert.equal(refused.error.code, "runtime_busy", JSON.stringify(refused));
  assert.match(refused.error.message, /running daemon holds this data directory/);
  report.phases.lockRefusal = {
    code: refused.error.code,
    message: refused.error.message,
  };

  await stopTestOwnedDaemons();
  await daemonExited;
}

// --- Packaged-app helpers. -------------------------------------------------
async function launchApp() {
  const child = startAcceptanceProcess(appExecutable, ["--remote-debugging-port=0"], {
    env: minimalEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  report.cleanup.push(`started packaged app pid ${child.pid}`);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error(`Electron published no CDP endpoint: ${tail}`)),
      20000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i++) await delay(50);
  const page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  page.setDefaultTimeout(20000);
  return { child, browser, page };
}

/** Stops one script-spawned app instance and every daemon it left behind. */
async function stopAppInstance(child) {
  const result = await stopAcceptanceProcess(child);
  report.cleanup.push(`packaged app pid ${child.pid}: ${result.verdict}`);
  await stopTestOwnedDaemons();
  return result;
}

async function capture(page, name) {
  const shots = path.join(root, ".preflight", "p6", "shots");
  await mkdir(shots, { recursive: true });
  const file = path.join(shots, name);
  await page.screenshot({ path: file });
  const { size } = await stat(file);
  report.screenshots.push({ name, file, bytes: size });
}

const overlayIsUp = async (page) =>
  (await page.locator("[data-dadir-refusal-overlay]").count()) > 0;

/** Waits for the healthy shell: no overlay, the real toolbar rendered. */
async function waitForHealthyShell(page) {
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  assert.equal(await overlayIsUp(page), false, "no refusal overlay");
}

async function setViewportAndCapture(page, theme, width) {
  await page.setViewportSize({ width, height: 900 });
  await delay(300);
  await capture(page, `overlay-${theme}-${width}.png`);
}

// --- Phase B0: pin the theme to LIGHT through the real settings page while
// the app is still healthy, so the overlay captures are deterministic. ----
{
  const app = await launchApp();
  try {
    await waitForHealthyShell(app.page);
    await selectSettingsTheme(app.page, "light");
  } finally {
    if (!app.child.killed && app.child.exitCode === null) await stopAppInstance(app.child);
    await stopTestOwnedDaemons();
  }
}

// --- Phase B: refusal journey (LIGHT), restore, relaunch, healthy app. ---
{
  await skewPastThisBuild();
  const app = await launchApp();
  try {
    // The overlay, for real: the bundled daemon refused and exited.
    await app.page.locator("[data-dadir-refusal-overlay]").waitFor();
    assert.ok(await overlayIsUp(app.page), "refusal overlay is up");
    assert.ok(
      await app.page.getByText(/is newer than/).first().isVisible(),
      "the daemon's own refusal reason is shown",
    );

    // The restore control lists the REAL backup, restorable by this build.
    const control = app.page.locator("[data-backup-restore-control]");
    await control.waitFor();
    const entry = app.page.locator(`[data-backup-entry="${firstBackupId}"]`);
    await entry.waitFor();
    assert.ok(await entry.getByText(/Backup from/).isVisible(), "backup timestamp shown");
    assert.equal(
      await entry.getByText(/Newer than this build/).count(),
      0,
      "the real backup is restorable by this build",
    );

    // Light theme (the profile default) at 1440 and 760.
    await setViewportAndCapture(app.page, "light", 1440);
    await setViewportAndCapture(app.page, "light", 760);

    // The honest confirmation gates the destructive click.
    await entry.getByRole("button", { name: "Restore…" }).click();
    const confirm = app.page.locator("[data-backup-confirm]");
    await confirm.waitFor();
    await confirm.getByText(/overwrites the current database/).waitFor();
    await confirm.getByText(/snapshotted first/).waitFor();
    await confirm.getByText(/Everything recorded after this backup's timestamp/).waitFor();
    report.phases.confirmCopy = "overwrite + snapshot-first + loss sentence all shown";
    const before = await runBundledCli(["workspace", "list", "--json"]);
    assert.ok(
      before.result.workspaces.some((w) => w.name === "p6-post-backup-marker"),
      "nothing restored before the explicit confirm click",
    );

    // Confirm. The app restores, then relaunches itself.
    const exited = new Promise((resolve) => app.child.once("exit", resolve));
    await confirm.getByRole("button", { name: /Restore backup from/ }).click();
    await app.page.getByText(/Drogon is relaunching/).waitFor();
    await exited;

    // The relaunched instance: fresh CDP endpoint, same bundle, healthy app.
    const relaunched = await waitForRelaunchedEndpoint(app.child.pid);
    report.cleanup.push(`relaunched app pid ${relaunched.pid}`);
    const browser2 = await chromium.connectOverCDP(relaunched.endpoint);
    for (let i = 0; i < 200 && !browser2.contexts()[0]?.pages()[0]; i++) await delay(50);
    const page2 = browser2.contexts()[0].pages()[0];
    await emulatePageFocus(page2);
    page2.setDefaultTimeout(20000);

    await waitForHealthyShell(page2);

    // The restore actually restored: marker data (recorded after the backup)
    // is gone; a pre-restore snapshot exists; the reopened restored dir
    // re-migrated and the pre-migration mechanism snapshotted it again.
    // (The relaunched app's daemon is up, so the RPC path is live.)
    const workspaces = await runBundledCli(["workspace", "list", "--json"]);
    assert.ok(
      !workspaces.result.workspaces.some((w) => w.name === "p6-post-backup-marker"),
      "the marker recorded after the backup is gone",
    );
    const dirs = await readdir(path.join(dataDir, "backups"));
    assert.ok(
      dirs.some((n) => n.startsWith("pre-restore-")),
      `a pre-restore snapshot exists: ${dirs}`,
    );
    assert.ok(
      dirs.filter((n) => n.startsWith("pre-migration-")).length >= 2,
      `the reopened restored dir re-migrated and snapshotted again: ${dirs}`,
    );
    report.phases.restored = { backups: dirs };

    // Leave the relaunched app healthy-state ON PURPOSE for Phase C: switch
    // the theme to DARK through the real settings page, then stop it.
    await selectSettingsTheme(page2, "dark");
    await browser2.close().catch(() => {});
    try {
      process.kill(relaunched.pid, "SIGTERM");
      report.cleanup.push(`SIGTERM -> relaunched app pid ${relaunched.pid}`);
    } catch {}
    for (let i = 0; i < 100 && (await isAlive(relaunched.pid)); i++) await delay(100);
    if (await isAlive(relaunched.pid)) {
      process.kill(relaunched.pid, "SIGKILL");
      report.cleanup.push("SIGKILL -> relaunched app (survived TERM)");
      await delay(500);
    }
    assert.ok(!(await isAlive(relaunched.pid)), "relaunched app exited");
    report.cleanup.push(`verified exited: relaunched app pid ${relaunched.pid}`);
  } finally {
    if (!app.child.killed && app.child.exitCode === null) await stopAppInstance(app.child);
    await stopTestOwnedDaemons();
  }
}

// --- Phase C: same journey with the DARK theme for the dark captures. -----
{
  await skewPastThisBuild();
  const app = await launchApp();
  try {
    await app.page.locator("[data-dadir-refusal-overlay]").waitFor();
    const entry = app.page.locator(`[data-backup-entry="${(await backupIds()).at(-1)}"]`);
    await entry.waitFor();
    const dark = await app.page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    assert.ok(dark, "the persisted dark theme renders the overlay dark");
    await setViewportAndCapture(app.page, "dark", 1440);
    await setViewportAndCapture(app.page, "dark", 760);
    report.phases.darkOverlay = "captured dark 1440 + 760 via the persisted theme";
  } finally {
    if (!app.child.killed && app.child.exitCode === null) await stopAppInstance(app.child);
    await stopTestOwnedDaemons();
  }

  // Phase D: with no daemon holding the lock, the CLI restore succeeds.
  const newest = (await backupIds()).sort().at(-1);
  const restored = await runBundledCli(["backups", "restore", newest, "--json"]);
  assert.equal(restored.result.restoredBackupId, newest);
  assert.ok(restored.result.preRestoreSnapshotId, "CLI restore snapshots first too");
  report.phases.cliRestore = restored.result;
}

async function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Finds the relaunched app's CDP endpoint by its listening port. */
async function waitForRelaunchedEndpoint(oldPid) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await delay(500);
    const { stdout } = await execFileP("pgrep", ["-f", `${appExecutable} --remote-debugging-port`]).catch(
      () => ({ stdout: "" }),
    );
    const pids = stdout.split("\n").filter(Boolean).map(Number).filter((pid) => pid !== oldPid);
    for (const pid of pids) {
      const { stdout: lsof } = await execFileP("lsof", [
        "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-nP",
      ]).catch(() => ({ stdout: "" }));
      const match = lsof.match(/127\.0\.0\.1:(\d+)/) || lsof.match(/localhost:(\d+)/);
      if (!match) continue;
      const port = match[1];
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const info = await response.json();
        if (info.webSocketDebuggerUrl) return { pid, endpoint: `http://127.0.0.1:${port}`, info };
      } catch {}
    }
  }
  throw new Error("the relaunched app never published a CDP endpoint");
}

// --- Cleanup: every process this script owns, verified exited. ------------
await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
report.cleanup.push(`fixture root removed: ${!keep}`);
console.log(JSON.stringify(report, null, 2));
