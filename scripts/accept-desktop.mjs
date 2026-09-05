import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startAcceptanceProcess } from "./acceptance-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const appRequire = createRequire(path.join(appDir, "package.json"));
const electron = appRequire("electron");
const fixture = await mkdtemp(path.join(tmpdir(), "dgu-"));
const workspace = path.join(fixture, "folder");
await mkdir(workspace);
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `desktop-${Date.now()}-${randomUUID()}`,
);
await mkdir(output, { recursive: true });
const report = {
  status: "FAILED",
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: [],
  fixture,
};
let daemon, desktop, browser, page, registered;
async function stopOwned(child, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (
    !(await Promise.race([
      exited.then(() => true),
      delay(5000).then(() => false),
    ]))
  ) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
    report.status = "FAILED";
    report.cleanup.push(`${label}: required force after timeout`);
  }
  report.cleanup.push(
    `${label}: ${child.exitCode !== null || child.signalCode !== null ? "exited" : "unverifiable"}`,
  );
}
try {
  daemon = startAcceptanceProcess(
    path.join(
      root,
      "target",
      "debug",
      process.platform === "win32" ? "drogond.exe" : "drogond",
    ),
    ["--data-dir", path.join(fixture, "data")],
    { stdio: "ignore" },
  );
  let daemonError;
  daemon.on("error", (error) => {
    daemonError = error;
  });
  desktop = startAcceptanceProcess(
    electron,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: path.join(fixture, "data"),
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
      },
    },
  );
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error("Electron did not publish a debugging endpoint")),
      15000,
    );
    desktop.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  if (daemonError) throw daemonError;
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 100 && !browser.contexts()[0]?.pages()[0]; i++)
    await delay(50);
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "Electron must create a rendered page");
  page.setDefaultTimeout(10000);
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
    })),
    { require: "undefined", process: "undefined" },
  );
  await page
    .getByRole("button", { name: "Add workspace", exact: true })
    .last()
    .click();
  await page.getByLabel("Folder path").fill(workspace);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  registered = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0];
  });
  report.checks.push("isolated-renderer-and-real-folder-registration");
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .last()
    .click();
  await page.getByRole("tab").first().waitFor();
  await page.locator(".xterm-helper-textarea").focus();
  const nonce = randomUUID().replaceAll("-", "");
  const marker = `DROGON_${nonce}`;
  const command =
    process.platform === "win32"
      ? `echo DROGON_${nonce}`
      : `printf 'DROGON_%s\\n' '${nonce}'`;
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
  report.checks.push("rendered-terminal-command-output");
  const original = await page.evaluate(async (id) => {
    const value = await window.drogon.sessions(id);
    return value.ok ? value.result.sessions[0] : null;
  }, registered.id);
  assert.ok(original?.incarnation);
  await page.reload();
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
  const reconnected = await page.evaluate(async (id) => {
    const value = await window.drogon.sessions(id);
    return value.ok ? value.result.sessions[0] : null;
  }, registered.id);
  assert.equal(reconnected?.id, original.id);
  assert.equal(reconnected?.incarnation, original.incarnation);
  report.checks.push("renderer-reload-retains-exact-session-and-output");
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 2,
  );
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="tab"]');
    return (
      tab?.getAttribute("aria-selected") === "true" &&
      document.activeElement === tab
    );
  });
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].at(-1);
    return (
      tab?.getAttribute("aria-selected") === "true" &&
      document.activeElement === tab
    );
  });
  await page
    .getByRole("button", { name: /^Close .* session$/ })
    .last()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 1,
  );
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
  report.checks.push("keyboard-tab-navigation-and-sibling-close");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 760, height: 600 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(output, "narrow.png"),
    animations: "disabled",
  });
  report.checks.push("light-dark-captures-and-narrow-no-overflow");
  await page.getByRole("button", { name: /Close .* session/ }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  report.checks.push("exact-session-close-through-ui");
  report.status = "PASSED";
} catch (error) {
  report.error = error.message;
} finally {
  if (page && registered) {
    try {
      const cleanup = await page.evaluate(async (id) => {
        const value = await window.drogon.sessions(id);
        if (!value.ok) throw new Error(value.error.message);
        return Promise.all(
          value.result.sessions.map((item) =>
            window.drogon.stop({
              sessionId: item.id,
              incarnation: item.incarnation,
            }),
          ),
        );
      }, registered.id);
      assert.ok(
        cleanup.every((value) => value.ok && value.result.verdict === "exited"),
      );
      report.cleanup.push("owned workspace sessions: exited");
    } catch {
      report.status = "FAILED";
      report.cleanup.push("owned workspace sessions: unverifiable");
    }
  }
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      error: report.error,
      report: path.join(output, "report.json"),
    }),
  );
}
if (report.status !== "PASSED") process.exitCode = 1;
