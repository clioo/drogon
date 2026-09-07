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

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const appDir = path.join(ROOT, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const daemonBin = path.join(ROOT, "target", "debug", "drogond");
const { chromium } = createRequireRoot(path.join(ROOT, "package.json"))("playwright");
const { startAcceptanceProcess, stopAcceptanceProcess } = await import(
  path.join(ROOT, "scripts", "acceptance-process.mjs")
);

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
async function stopOwned(child, label) {
  if (!child) return null;
  const result = await stopAcceptanceProcess(child);
  report.checks.push(`${label}: ${result.verdict}${result.forced ? " (FORCED)" : ""}`);
  return result;
}
try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], { stdio: "ignore" });
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      SHELL: "/bin/sh",
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
  let page = null;
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

  report.status = "PASSED";
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  console.log(JSON.stringify(report, null, 1));
  if (report.status !== "PASSED") process.exitCode = 1;
}
