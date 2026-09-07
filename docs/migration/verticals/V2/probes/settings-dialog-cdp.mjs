// V2 settings dialog acceptance CDP probe (NEW probe, V2-owned). Real dev
// drogond + real dev Electron over Playwright CDP; no mocks, no jsdom.
// Lifecycle uses the existing scripts/acceptance-process.mjs seams
// (start/stop/waitAcceptanceExit), never raw SIGKILL. Shots go to gitignored
// .preflight/settings-dialog-<ts>/; the JSON report prints to stdout.
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
const { chromium } = createRequireRoot(path.join(ROOT, "package.json"))(
  "playwright",
);
const { startAcceptanceProcess, stopAcceptanceProcess, waitAcceptanceExit } =
  await import(path.join(ROOT, "scripts", "acceptance-process.mjs"));

if (process.platform === "win32") {
  console.log(
    JSON.stringify(
      {
        status: "UNVERIFIED",
        reason: "probe not yet verified on Windows",
        checks: [],
      },
      null,
      1,
    ),
  );
  process.exitCode = 2;
  process.exit(process.exitCode);
}

const fixture = await mkdtemp(path.join(tmpdir(), "settings-dialog-"));
const dataDir = path.join(fixture, "data");
await mkdir(dataDir, { recursive: true });
const folder = path.join(fixture, "folder");
await mkdir(folder);
const shots = path.join(ROOT, ".preflight", `settings-dialog-${Date.now()}`);
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
  report.checks.push(
    `${label}: ${result.verdict}${result.forced ? " (FORCED)" : ""}`,
  );
  if (result.forced || result.verdict !== "exited") report.status = "FAILED";
  return result;
}

async function setSettledTheme(theme) {
  await page.evaluate((value) => {
    window.localStorage.setItem(
      "drogon:settings:ui",
      JSON.stringify({ settings: { theme: value } }),
    );
  }, theme);
  await page.reload();
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForFunction(
    (want) => {
      const dark = want === "dark";
      const root = document.documentElement;
      if (root.classList.contains("dark") !== dark) return false;
      return (
        getComputedStyle(root).getPropertyValue("--background").trim() ===
        (dark ? "#0a0a0a" : "#fff")
      );
    },
    theme,
    { timeout: 10000 },
  );
}

async function openSettingsDialog() {
  const settingsButton = page.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await settingsButton.waitFor();
  await settingsButton.click();
  await page.locator('dialog[aria-label="Settings"]').waitFor();
  const bounds = await page
    .locator('dialog[aria-label="Settings"]')
    .boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && viewport, "dialog and viewport must be observable");
  assert.ok(
    Math.abs(viewport.width - bounds.x - bounds.width - 16) <= 1,
    "settings dialog must align with the right-hand toolbar",
  );
}

async function closeSettingsDialog() {
  const dialog = page.locator('dialog[aria-label="Settings"]');
  await dialog.evaluate((el) => el.close());
}

async function checkTabTrap(label) {
  await openSettingsDialog();

  // Get all focusable elements inside the dialog
  const focusableCount = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    if (!dialog) return 0;
    const focusable = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    return focusable.length;
  });

  // Tab through more times than focusable elements exist
  for (let i = 0; i < focusableCount + 3; i++) {
    await page.keyboard.press("Tab");
    await delay(50);
    assert.ok(
      await page.evaluate(() => {
        const dialog = document.querySelector('dialog[aria-label="Settings"]');
        return dialog?.contains(document.activeElement);
      }),
      `${label}: focus escaped on Tab step ${i + 1}`,
    );
  }

  // Verify focus is still inside the dialog
  const focusInsideDialog = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    const activeElement = document.activeElement;
    if (!dialog) return false;
    return dialog.contains(activeElement) || dialog === activeElement;
  });

  assert.ok(
    focusInsideDialog,
    `${label}: focus escaped dialog after repeated Tab`,
  );
  report.checks.push(`tab-forward-trap-${label}`);

  // Verify dialog is still open
  const dialogOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(dialogOpen, `${label}: dialog closed unexpectedly during Tab trap`);

  // Close for next test
  await closeSettingsDialog();
  await page.waitForFunction(
    () => !document.querySelector('dialog[aria-label="Settings"]'),
    { timeout: 5000 },
  );
}

async function checkShiftTabTrap(label) {
  await openSettingsDialog();

  // Get all focusable elements inside the dialog
  const focusableCount = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    if (!dialog) return 0;
    const focusable = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    return focusable.length;
  });

  // Shift+Tab through more times than focusable elements exist
  for (let i = 0; i < focusableCount + 3; i++) {
    await page.keyboard.press("Shift+Tab");
    await delay(50);
    assert.ok(
      await page.evaluate(() => {
        const dialog = document.querySelector('dialog[aria-label="Settings"]');
        return dialog?.contains(document.activeElement);
      }),
      `${label}: focus escaped on Shift+Tab step ${i + 1}`,
    );
  }

  // Verify focus is still inside the dialog
  const focusInsideDialog = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    const activeElement = document.activeElement;
    if (!dialog) return false;
    return dialog.contains(activeElement) || dialog === activeElement;
  });

  assert.ok(
    focusInsideDialog,
    `${label}: focus escaped dialog after repeated Shift+Tab`,
  );
  report.checks.push(`shift-tab-reverse-trap-${label}`);

  // Verify dialog is still open
  const dialogOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(
    dialogOpen,
    `${label}: dialog closed unexpectedly during Shift+Tab trap`,
  );

  // Close for next test
  await closeSettingsDialog();
  await page.waitForFunction(
    () => !document.querySelector('dialog[aria-label="Settings"]'),
    { timeout: 5000 },
  );
}

async function checkBackgroundInert(label) {
  await openSettingsDialog();

  // Try to focus a header button (outside the dialog)
  const headerButton = page.getByRole("button", {
    name: "Refresh connection",
    exact: true,
  });

  // Attempt to focus it
  const wasFocused = await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Refresh connection"]',
    );
    if (!btn) throw new Error("background control is missing");
    btn.focus();
    return document.activeElement === btn;
  });

  // Verify it was NOT focused (focus should remain in dialog)
  assert.ok(
    !wasFocused,
    `${label}: background button received focus while dialog was open`,
  );

  // Verify dialog is still open and focus is still inside
  const focusInsideDialog = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    const activeElement = document.activeElement;
    return (
      dialog?.open &&
      (dialog.contains(activeElement) || dialog === activeElement)
    );
  });
  assert.ok(focusInsideDialog, `${label}: dialog lost focus or was closed`);

  report.checks.push(`background-inert-${label}`);

  // Close for next test
  await closeSettingsDialog();
  await page.waitForFunction(
    () => !document.querySelector('dialog[aria-label="Settings"]'),
    { timeout: 5000 },
  );
}

async function checkEscapeCloses(label) {
  await openSettingsDialog();

  // Verify dialog is open
  let dialogOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(dialogOpen, `${label}: dialog is not open initially`);

  // Press Escape
  await page.keyboard.press("Escape");
  await delay(100);

  // Verify dialog is closed
  dialogOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(!dialogOpen, `${label}: dialog still open after Escape`);

  report.checks.push(`escape-closes-dialog-${label}`);
}

async function checkBackdropClick(label) {
  await openSettingsDialog();

  // Get dialog bounding box
  const dialogBox = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  });

  assert.ok(dialogBox, `${label}: could not get dialog bounding box`);

  // Compute a point clearly outside the dialog (top-left corner)
  const outsideX = Math.max(10, dialogBox.left - 50);
  const outsideY = Math.max(10, dialogBox.top - 50);

  // Click outside the dialog
  await page.mouse.click(outsideX, outsideY);
  await delay(100);

  // Verify dialog is closed
  const dialogOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(!dialogOpen, `${label}: dialog still open after outside click`);

  report.checks.push(`backdrop-click-dismisses-${label}`);

  // Negative control: reopen and click INSIDE to verify it does NOT close
  await openSettingsDialog();

  // Click on a control inside the dialog (e.g., a radio button)
  const radioButton = page.locator('input[type="radio"]').first();
  await radioButton.click();
  await delay(100);

  // Verify dialog is still open
  const stillOpen = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    return dialog?.open ?? false;
  });
  assert.ok(stillOpen, `${label}: dialog closed when clicking inside`);

  report.checks.push(`inside-click-does-not-dismiss-${label}`);

  // Close for next test
  await closeSettingsDialog();
  await page.waitForFunction(
    () => !document.querySelector('dialog[aria-label="Settings"]'),
    { timeout: 5000 },
  );
}

async function checkFocusRestoration(label) {
  // Store initial focus (should be somewhere neutral)
  const settingsButton = page.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  const buttonElement = await settingsButton.elementHandle();

  // Open dialog
  await openSettingsDialog();

  // Close via Escape
  await page.keyboard.press("Escape");
  await delay(100);

  // Verify focus is back on Settings button
  const focusedAfterEscape = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Settings"]');
    return document.activeElement === btn;
  });
  assert.ok(
    focusedAfterEscape,
    `${label}: focus not restored to Settings button after Escape`,
  );

  report.checks.push(`focus-restoration-escape-${label}`);

  // Test focus restoration via outside click
  await openSettingsDialog();

  // Click outside
  const dialogBox = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Settings"]');
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
    };
  });

  const outsideX = Math.max(10, dialogBox.left - 50);
  const outsideY = Math.max(10, dialogBox.top - 50);

  await page.mouse.click(outsideX, outsideY);
  await delay(100);

  // Verify focus is back on Settings button
  const focusedAfterClickOutside = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Settings"]');
    return document.activeElement === btn;
  });
  assert.ok(
    focusedAfterClickOutside,
    `${label}: focus not restored to Settings button after outside click`,
  );

  report.checks.push(`focus-restoration-outside-click-${label}`);
}

try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
  });
  desktop = startAcceptanceProcess(
    electron,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        ...(process.platform === "win32" ? {} : { SHELL: "/bin/sh" }),
      },
    },
  );

  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error(`no DevTools endpoint: ${tail}`)),
      30000,
    );
    desktop.once("error", reject);
    desktop.once("exit", () =>
      reject(new Error(`electron exited early: ${tail}`)),
    );
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const m = tail.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
      );
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

  // Setup workspace
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();

  await page
    .getByRole("button", { name: "Add workspace", exact: true })
    .first()
    .click();
  await page.getByLabel("Folder path").fill(folder);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  probeWorkspaceId = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0].id;
  });

  // Full 6-check pass at 1440x1000 light
  await setSettledTheme("light");
  await page.setViewportSize({ width: 1440, height: 1000 });

  report.checks.push("=== 1440x1000 light theme ===");
  await checkTabTrap("1440-light");
  await checkShiftTabTrap("1440-light");
  await checkBackgroundInert("1440-light");
  await checkEscapeCloses("1440-light");
  await checkBackdropClick("1440-light");
  await checkFocusRestoration("1440-light");
  await openSettingsDialog();
  await page.screenshot({
    path: path.join(shots, "1440-light-all-checks-done.png"),
  });
  await closeSettingsDialog();

  // Trap-forward + Escape + restore repeat at 760x600 dark
  await setSettledTheme("dark");
  await page.setViewportSize({ width: 760, height: 600 });

  report.checks.push("=== 760x600 dark theme ===");
  await checkTabTrap("760-dark");
  await checkEscapeCloses("760-dark");
  await checkFocusRestoration("760-dark");
  await openSettingsDialog();
  await page.screenshot({
    path: path.join(shots, "760-dark-trap-escape-restore-done.png"),
  });
  await closeSettingsDialog();

  report.status = "PASSED";
} catch (error) {
  report.checks.push(`FAILED: ${error.message}`);
  report.status = "FAILED";
  report.error = error.message;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  console.log(JSON.stringify(report, null, 1));
  if (report.status !== "PASSED") process.exitCode = 1;
}
