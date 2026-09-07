// V2 keyboard/focus/theme CDP probe (committed, V2-owned). Real dev
// drogond + real dev Electron over Playwright CDP; no mocks, no fixture
// daemon. Lifecycle uses the existing scripts/acceptance-process.mjs
// seams (start/stop), never raw SIGKILL. Shots go to gitignored
// .preflight/v2-kbd-<ts>/; the JSON report prints to stdout.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire as createRequireRoot } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(
  fileURLToPath(new URL("../../../../../package.json", import.meta.url)),
);
const appDir = path.join(ROOT, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const daemonBin = path.join(
  ROOT,
  "target",
  "debug",
  process.platform === "win32" ? "drogond.exe" : "drogond",
);
const { chromium } = createRequireRoot(path.join(ROOT, "package.json"))("playwright");
const { startAcceptanceProcess, stopAcceptanceProcess } = await import(
  path.join(ROOT, "scripts", "acceptance-process.mjs")
);

if (process.platform === "win32") {
  console.log(
    JSON.stringify({ status: "UNVERIFIED", reason: "probe not yet verified on Windows", checks: [] }, null, 1),
  );
  process.exitCode = 2;
  process.exit(process.exitCode);
}

const fixture = await mkdtemp(path.join(tmpdir(), "v2-kbd-"));
const dataDir = path.join(fixture, "data");
await mkdir(dataDir, { recursive: true });
const folder = path.join(fixture, "folder");
await mkdir(folder);
const shots = path.join(ROOT, ".preflight", `v2-kbd-${Date.now()}`);
await mkdir(shots, { recursive: true });

const report = { status: "FAILED", checks: [], shots };
let daemon;
let desktop;
let browser = null;
let page = null;
let probeWorkspaceId = null;
async function stopOwned(child, label) {
  if (!child) return null;
  const result = await stopAcceptanceProcess(child);
  report.checks.push(`${label}: ${result.verdict}${result.forced ? " (FORCED)" : ""}`);
  if (result.forced || result.verdict !== "exited") report.status = "FAILED";
  return result;
}
// Stops every session the probe created via the exact host+id+incarnation
// identity and requires observed exited + empty list before the daemon
// goes down. Any deviation fails the report: leaked shells must never
// hide behind a PASSED functional section.
async function cleanupSessions(page, workspaceId) {
  if (!page || !workspaceId) return;
  const listed = await page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
  for (const session of listed) {
    const stopped = await page.evaluate(
      async (target) => window.drogon.stop({ sessionId: target.id, incarnation: target.incarnation }),
      { id: session.id, incarnation: session.incarnation },
    );
    if (!stopped.ok) throw new Error(stopped.error.message);
    assert.equal(stopped.result.verdict, "exited", `session ${session.id} must exit on exact stop`);
    assert.equal(stopped.result.id, session.id);
    assert.equal(stopped.result.incarnation, session.incarnation);
    report.checks.push(`session-cleanup-exited:${session.id}`);
  }
  const remaining = await page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
  // The Engine retains exited sessions as history: the leak invariant is
  // that no LIVE session survives cleanup, not that the list is empty.
  const live = remaining.filter((item) => item.verdict === "live");
  assert.equal(live.length, 0, "no live probe session may survive cleanup");
  report.checks.push(`session-cleanup-no-live(${remaining.length}-exited-retained)`);
}
try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], { stdio: "ignore" });
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      ...(process.platform === "win32" ? {} : { SHELL: "/bin/sh" }),
    },
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(() => reject(new Error(`no DevTools endpoint: ${tail}`)), 30000);
    desktop.once("error", reject);
    desktop.once("exit", () => reject(new Error(`electron exited early: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const m = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(50);
  }
  assert.ok(page, "electron must render a page");
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
  await page.getByLabel("Folder path").fill(folder);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  probeWorkspaceId = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0].id;
  });

  // 1. Keyboard shortcut creates a terminal (darwin mod is Meta).
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+N`);
  await page.getByRole("tab").first().waitFor();
  assert.equal(await page.getByRole("tab").count(), 1);
  report.checks.push("keyboard-shortcut-creates-terminal");
  await page.screenshot({ path: path.join(shots, "kbd-new-terminal.png") });

  // 2. Second terminal + arrow/Home tab navigation with focus.
  await page.keyboard.press(`${mod}+Shift+N`);
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="tab"]');
    return tab?.getAttribute("aria-selected") === "true" && document.activeElement === tab;
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].at(-1);
    return tab?.getAttribute("aria-selected") === "true" && document.activeElement === tab;
  });
  report.checks.push("arrow-home-tab-navigation-moves-selection-and-focus");
  await page.screenshot({ path: path.join(shots, "kbd-tab-nav.png") });

  // 3. System theme drives .dark on the root (default theme is system).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: path.join(shots, "theme-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: path.join(shots, "theme-light.png") });
  report.checks.push("system-theme-toggles-dark-class");

  // 4. Explicit-theme palette matrix: theme choice x OS scheme asserts
  // computed custom properties + color-scheme, not just the .dark class.
  const DARK = { background: "#0a0a0a", foreground: "#fafafa", scheme: "dark" };
  const LIGHT = { background: "#fff", foreground: "#0a0a0a", scheme: "light" };
  const matrix = [
    ["system", "dark", DARK],
    ["system", "light", LIGHT],
    ["dark", "dark", DARK],
    ["dark", "light", DARK],
    ["light", "dark", LIGHT],
    ["light", "light", LIGHT],
  ];
  for (const [theme, os, expected] of matrix) {
    await page.evaluate((value) => {
      window.localStorage.setItem("drogon:settings:ui", JSON.stringify({ settings: value }));
    }, { theme });
    await page.reload();
    await page.getByText("Service 0.1.0", { exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: os });
    await page.waitForFunction(
      (want) => {
        const style = getComputedStyle(document.documentElement);
        return (
          style.getPropertyValue("--background").trim() === want.background &&
          style.getPropertyValue("--foreground").trim() === want.foreground &&
          style.colorScheme === want.scheme
        );
      },
      expected,
      { timeout: 10000 },
    );
    const actual = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        background: style.getPropertyValue("--background").trim(),
        foreground: style.getPropertyValue("--foreground").trim(),
        scheme: style.colorScheme,
      };
    });
    assert.deepEqual(actual, expected, `theme=${theme} os=${os}`);
    report.checks.push(`theme-matrix-${theme}-on-${os}-os`);
  }
  await page.screenshot({ path: path.join(shots, "theme-matrix-done.png") });

  report.status = "PASSED";
} finally {
  try {
    await cleanupSessions(page, probeWorkspaceId);
  } catch (error) {
    report.checks.push(`session-cleanup: FAILED (${error.message})`);
    report.status = "FAILED";
  }
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  console.log(JSON.stringify(report, null, 1));
  if (report.status !== "PASSED") process.exitCode = 1;
}
