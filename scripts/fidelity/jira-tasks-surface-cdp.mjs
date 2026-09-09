// R17-B fidelity driver: the mounted Jira Tasks surface through the REAL
// app — drogond plus the Electron production bundle, seeded with the
// committed fake Jira server (never a real Atlassian site). Connects the
// fixture site through the ported Connect dialog (the same path a user
// takes), opens the Tasks page, selects the Jira source, and captures the
// connect prompt, the connected list, the issue workspace sheet and the
// create dialog at 1440x900 and 900x700, in light and dark.
//
// Theme rides the status-bar Theme cycle button (the app's real write
// path). Reloads are deliberately avoided: a renderer reload strands main's
// daemon link (status() stays "unverifiable"), and the Tasks surface gates
// on the live service status.
//
// Usage: node scripts/fidelity/jira-tasks-surface-cdp.mjs [--out <dir>]
// Requires: cargo build --workspace and pnpm --filter @drogon/desktop build
// already run (the script launches target/debug/drogond via the app).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "../acceptance-process.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const nodeBin = process.execPath;
const electron = path.join(root, "apps/desktop/node_modules/.bin/electron");
const appDir = path.join(root, "apps/desktop");
const fixtureScript = path.join(root, "scripts/fixtures/jira/fake-jira-server.mjs");
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(root, ".preflight/fidelity/jira-tasks-surface");
await mkdir(outDir, { recursive: true });

// --- fixtures ---------------------------------------------------------------
const fixtureDir = mkdtempSync(path.join(tmpdir(), "drogon-jira-surface-"));
const dataDir = path.join(fixtureDir, "data");
const electronProfile = path.join(fixtureDir, "electron-profile");
mkdirSync(dataDir, { recursive: true });

const fixture = startAcceptanceProcess(
  nodeBin,
  [fixtureScript, "--port", "0"],
  { stdio: ["ignore", "pipe", "ignore"] },
);
let fixturePort = 0;
{
  let listenLine = "";
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const chunk = fixture.stdout.read();
    if (chunk) {
      listenLine += chunk.toString();
      const match = listenLine.match(/LISTEN (\d+)/);
      if (match) {
        fixturePort = Number(match[1]);
        break;
      }
    }
    await delay(50);
  }
}
assert.ok(fixturePort > 0, "fake Jira server did not publish a port");
const siteUrl = `http://127.0.0.1:${fixturePort}`;
// The fixture's 'All Open' window: every issue with no resolution, the same
// rule the fake server's JQL matcher applies (resolution = Unresolved).
const dataset = JSON.parse(
  readFileSync(
    path.join(root, "scripts/fixtures/jira/data/screenshot-site.json"),
    "utf8",
  ),
);
const allOpenCount = dataset.issues.filter(
  (entry) => entry.fields?.resolution == null,
).length;

// --- desktop ----------------------------------------------------------------
const daemon = startAcceptanceProcess(
  path.join(root, "target/debug/drogond"),
  ["--data-dir", dataDir],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let daemonLog = "";
daemon.stdout.on("data", (bytes) => {
  daemonLog = (daemonLog + bytes.toString()).slice(-8192);
});
daemon.stderr.on("data", (bytes) => {
  daemonLog = (daemonLog + bytes.toString()).slice(-8192);
});
const daemonUp = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("drogond never created its socket")), 30_000);
  const poll = setInterval(() => {
    if (existsSync(path.join(dataDir, "runtime-v1.sock"))) {
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    }
  }, 100);
});
const desktop = startAcceptanceProcess(
  electron,
  [appDir, "--remote-debugging-port=0"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: electronProfile,
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
    },
  },
);
const report = { checks: [], cleanup: [], status: "FAILED" };
const pageConsole = [];
const check = (name, detail) => {
  report.checks.push({ name, detail });
  console.log(`ok - ${name}${detail ? ` (${detail})` : ""}`);
};
let browser;
let desktopOut = "";
await daemonUp;
try {
  desktop.stdout.on("data", (bytes) => {
    desktopOut = (desktopOut + bytes.toString()).slice(-16384);
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no DevTools endpoint: ${tail}`)),
      30_000,
    );
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    desktop.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`electron exited early: ${tail}`));
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i = 0; i < 200 && !page; i += 1) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(100);
  }
  assert.ok(page, "renderer page never appeared");
  page.on("console", (msg) => {
    if (msg.type() === "error") pageConsole.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (error) => pageConsole.push(`pageerror: ${String(error).slice(0, 300)}`));
  await page.waitForFunction(() => Boolean(window.drogon?.jira), null, {
    timeout: 30_000,
  });
  check("preload jira bridge exposed", "window.drogon.jira present");

  // Wait until the daemon answers through the real bridge (ground truth for
  // "the Tasks surface can mount", which gates on the live service status).
  await page.waitForFunction(
    async () => {
      try {
        const reply = await window.drogon.project.projectList();
        return Boolean(reply && reply.ok);
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60_000, polling: 500 },
  );

  // Theme: drive the Settings → Appearance segmented control (the app's
  // real write path; the session-header cycle button does not render on
  // standalone pages like Tasks). Settings leaves with Escape.
  const setTheme = async (target) => {
    // The native-theme sync keeps settling for seconds after a change
    // (store flush debounce + adopt timers), and can briefly re-apply the
    // previous theme. Flip, then require the root class to HOLD the target
    // for a stability window before anyone screenshots.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByTestId("status-bar").getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      const themeGroup = page.getByRole("radiogroup", { name: "Theme", exact: true });
      await themeGroup.waitFor({ timeout: 15_000 });
      await themeGroup.getByRole("radio", { name: target[0].toUpperCase() + target.slice(1), exact: true }).click();
      await page.keyboard.press("Escape");
      const held = await page
        .waitForFunction(
          (value) => document.documentElement.classList.contains("dark") === (value === "dark"),
          target,
          { timeout: 3_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!held) continue;
      let stableMs = 0;
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(150);
        const matches = await page.evaluate(
          (value) => document.documentElement.classList.contains("dark") === (value === "dark"),
          target,
        );
        if (!matches) { stableMs = 0; continue; }
        stableMs += 150;
        if (stableMs >= 1_500) return;
      }
      throw new Error(`theme ${target} never stabilized`);
    }
    throw new Error(`theme ${target} did not apply after 3 attempts`);
  };
  // The Jira surface state that capture() must re-establish after a theme
  // change: opening Settings replaces the Tasks route, discarding the
  // page's local state (selected source, preset, open sheet/dialog).
  let restoreJiraSurface = async () => {};
  const capture = async (name) => {
    for (const theme of ["light", "dark"]) {
      // A sheet/dialog overlay swallows status-bar clicks; close it (the
      // restore below re-opens the same state after the theme flip).
      const openDialog = page.locator('[role="dialog"]');
      if ((await openDialog.count()) > 0) {
        await page.keyboard.press("Escape");
        await openDialog.first().waitFor({ state: "detached", timeout: 10_000 });
      }
      await setTheme(theme);
      const tasksBack = page.locator('[data-testid="tasks-page-host"]');
      await tasksBack.waitFor({ timeout: 15_000 });
      await restoreJiraSurface();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, `${name}.${theme}.png`) });
    }
  };
  const resize = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
  };

  // Connect-prompt state first: the surface before any site is connected.
  const tasksNav = page.getByRole("button", { name: "Tasks", exact: true });
  await tasksNav.waitFor({ timeout: 15_000 });
  await tasksNav.click();
  const tasksHost = page.locator('[data-testid="tasks-page-host"]');
  await tasksHost.waitFor({ timeout: 15_000 });
  const jiraSource = tasksHost.locator('[data-task-source="jira"]');
  await jiraSource.waitFor();
  await jiraSource.click();
  const connectPrompt = tasksHost.getByText("Connect your Jira site", { exact: true });
  await connectPrompt.waitFor({ timeout: 15_000 });
  check("not-connected state renders the fork's connect prompt");
  restoreJiraSurface = async () => {
    const host = page.locator('[data-testid="tasks-page-host"]');
    await host.locator('[data-task-source="jira"]').click();
    await host.getByText("Connect your Jira site", { exact: true }).waitFor({ timeout: 15_000 });
  };

  await resize(1440, 900);
  await capture("connect-prompt.1440x900");

  // Connect the fixture site through the ported Connect dialog — the
  // same path a user takes. onConnected refreshes the page's Jira state
  // (model.refreshJiraStatus), so no reload is needed.
  await tasksHost.getByRole("button", { name: "Connect Jira", exact: true }).click();
  const connectDialog = page.locator('[role="dialog"]');
  await connectDialog.waitFor({ timeout: 15_000 });
  await connectDialog.locator('input[placeholder="https://example.atlassian.net"]').fill(siteUrl);
  await connectDialog.locator('input[placeholder="you@example.com"]').fill("carlos@example.com");
  await connectDialog.locator('input[type="password"]').fill("fixture-token");
  await connectDialog.getByRole("button", { name: "Connect", exact: true }).click();
  await connectDialog.waitFor({ state: "detached", timeout: 30_000 });
  check("connect dialog connects the fixture site", "dialog closed via onConnected");

  // The connected list: default preset ('assigned'), then the full 'All
  // Open' window for the shape of Carlos's 19-issue fixture.
  const listChrome = tasksHost.getByText("Jira issues", { exact: true });
  await listChrome.waitFor({ timeout: 15_000 });
  await tasksHost.getByRole("button", { name: "All Open", exact: true }).click();
  // Wait for THIS fetch's counter — the previous preset's rows may still be
  // painted (and contain DROG-1), so the exact fixture count is the only
  // unambiguous signal that the All Open window landed.
  const shown = tasksHost.getByText(`${allOpenCount} shown`, { exact: true });
  await shown.waitFor({ timeout: 15_000 });
  check("connected list renders with the fork's shown counter", `${allOpenCount} shown`);
  restoreJiraSurface = async () => {
    const host = page.locator('[data-testid="tasks-page-host"]');
    await host.locator('[data-task-source="jira"]').click();
    await host.getByText("Jira issues", { exact: true }).waitFor({ timeout: 15_000 });
    await host.getByRole("button", { name: "All Open", exact: true }).click();
    await host.getByText(`${allOpenCount} shown`, { exact: true }).waitFor({ timeout: 15_000 });
  };
  await capture("list.1440x900");
  await resize(900, 700);
  await capture("list.900x700");

  // Row open → the issue workspace sheet with paged comments.
  await tasksHost.getByText("DROG-1", { exact: true }).first().click();
  const sheet = page.locator('[role="dialog"]');
  await sheet.waitFor({ timeout: 15_000 });
  await sheet.getByPlaceholder("Add a Jira comment...").waitFor({ timeout: 15_000 });
  check("row open shows the issue workspace sheet", "composer visible");
  restoreJiraSurface = async () => {
    const host = page.locator('[data-testid="tasks-page-host"]');
    await host.locator('[data-task-source="jira"]').click();
    await host.getByText("Jira issues", { exact: true }).waitFor({ timeout: 15_000 });
    await host.getByRole("button", { name: "All Open", exact: true }).click();
    await host.getByText(`${allOpenCount} shown`, { exact: true }).waitFor({ timeout: 15_000 });
    await host.getByText("DROG-1", { exact: true }).first().click();
    const reopened = page.locator('[role="dialog"]');
    await reopened.waitFor({ timeout: 15_000 });
    await reopened.getByPlaceholder("Add a Jira comment...").waitFor({ timeout: 15_000 });
  };
  await resize(1440, 900);
  await capture("detail.1440x900");
  await resize(900, 700);
  await capture("detail.900x700");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached", timeout: 10_000 });

  // Create dialog entry from the mounted filters chrome.
  await resize(1440, 900);
  await tasksHost.getByRole("button", { name: "New Jira issue", exact: true }).click();
  const createDialog = page.locator('[role="dialog"]');
  await createDialog.waitFor({ timeout: 15_000 });
  check("create entry opens the ported IssueDialog", "");
  restoreJiraSurface = async () => {
    const host = page.locator('[data-testid="tasks-page-host"]');
    await host.locator('[data-task-source="jira"]').click();
    await host.getByText("Jira issues", { exact: true }).waitFor({ timeout: 15_000 });
    await host.getByRole("button", { name: "New Jira issue", exact: true }).click();
    await page.locator('[role="dialog"]').waitFor({ timeout: 15_000 });
  };
  await capture("create.1440x900");
  await page.keyboard.press("Escape");
  await createDialog.waitFor({ state: "detached", timeout: 10_000 });

  // Measure-only parity probe against this build: the mounted DOM carries
  // the fork's classes and copy (the running orca-drogon reference at
  // :9445 is navigate/measure-only and needs a live Jira login, so the
  // structural comparison rides the fork source + these measures).
  const measures = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="tasks-page-host"]');
    const list = host?.querySelector('[data-task-source="jira"]');
    const headers = [...document.querySelectorAll("button")].map((b) => b.textContent);
    return {
      hostPresent: Boolean(host),
      jiraSourceIcon: Boolean(list),
      jiraIssuesHeader: Boolean([...document.querySelectorAll("div")].some(
        (d) => d.textContent === "Jira issues",
      )),
      presetLabels: ["Assigned", "Reported", "All Open", "Done"].filter((label) =>
        headers.includes(label),
      ),
      jqlPlaceholder: Boolean(
        document.querySelector('input[placeholder*="Jira JQL"]'),
      ),
    };
  });
  assert.equal(measures.hostPresent, true);
  assert.equal(measures.jiraSourceIcon, true);
  assert.equal(measures.jiraIssuesHeader, true);
  assert.deepEqual(measures.presetLabels, ["Assigned", "Reported", "All Open", "Done"]);
  assert.equal(measures.jqlPlaceholder, true);
  check("mounted DOM carries the fork chrome", JSON.stringify(measures));

  await page.evaluate(() => window.close());
  const exit = await stopAcceptanceProcess(desktop, { timeoutMs: 15_000 });
  report.cleanup.push(`desktop: ${exit.verdict}`);
  assert.equal(exit.forced, false, "desktop required a forced kill");
  report.status = "PASSED";
} catch (error) {
  console.error(desktopOut.slice(-4000));
  console.error(`daemon log: ${daemonLog.slice(-3000)}`);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(outDir, "_fail.png") }).catch(() => {});
    console.error(`console errors: ${JSON.stringify(pageConsole.slice(0, 10))}`);
  }
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const child of [desktop, daemon, fixture]) {
    if (child.exitCode === null && !child.killed) {
      const verdict = await stopAcceptanceProcess(child, { timeoutMs: 5_000 });
      report.cleanup.push(`${path.basename(child.spawnfile)}: ${verdict.verdict}`);
    }
  }
  console.log(`status: ${report.status}; cleanup: ${report.cleanup.join(", ")}`);
}
