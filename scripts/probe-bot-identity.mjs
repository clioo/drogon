// Acceptance probe for task_926fddc5e769 (Bot identity + one-session +
// sidebar), driving the REAL dev app (built renderer + real drogond) in a
// hidden DROGON_BACKGROUND_WINDOW=1 window with its own temp data dir and
// Electron profile -- never the developer's running instance, never
// OS-activated.
//
// No real model inference: a shell-script `pi` fixture on drogond's PATH
// stands in for the harness and `cat`s the Bot's generated AGENTS.md /
// CLAUDE.md from its own cwd. That makes Gap 1 observable in the RENDERED
// terminal: the bytes a real harness process reads out of its working
// directory are on screen.
//
// Gaps covered:
//   1. the harness receives the Bot's identity (display name, handle,
//      instructions, memories) and the CLAUDE.md pointer;
//   2. clicking "Open session" twice keeps exactly ONE session/tab and the
//      second click focuses it (no duplicate);
//   3. the sidebar Chats section lists the Bot session with its daemon
//      state and opens it on click.
// Plus light/dark screenshots at parity widths with no horizontal overflow.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const appRequire = createRequire(path.join(appDir, "package.json"));
const electronBin = appRequire("electron");
const drogondBin = path.join(root, "target", "debug", "drogond");
assert.ok(
  existsSync(drogondBin),
  `drogond debug binary missing at ${drogondBin} -- run \`cargo build -p drogond\` first`,
);
assert.ok(
  existsSync(path.join(appDir, "out", "main", "index.js")),
  `apps/desktop/out missing -- run \`electron-vite build\` first`,
);

const fixture = await mkdtemp(path.join(tmpdir(), "dgidentity-"));
const dataDir = path.join(fixture, "data");
const electronProfile = path.join(fixture, "electron");
const fixtureBin = path.join(fixture, "bin");
const projectDir = path.join(fixture, "project-worktree");
const output = path.join(root, ".preflight", "bot-identity", `${Date.now()}`);

await mkdir(dataDir, { recursive: true });
await mkdir(electronProfile, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(projectDir, { recursive: true });
await mkdir(output, { recursive: true });

const INSTRUCTIONS = "Always answer first as Arya Stark, never as the underlying CLI.";
const MEMORY = "The owner is Carlos.";

// The harness fixture reads the generated context files from its cwd and
// then behaves like an interactive TUI (echo loop, clean TERM handling).
const fixturePath = path.join(fixtureBin, "pi");
await writeFile(
  fixturePath,
  `#!/bin/sh
echo "CWD=$(pwd)"
echo "---AGENTS---"
cat AGENTS.md 2>/dev/null
echo "---CLAUDE---"
cat CLAUDE.md 2>/dev/null
trap 'exit 0' TERM INT
while IFS= read -r line; do echo "you said: $line"; done
exit 0
`,
);
await chmod(fixturePath, 0o755);

let drogond = null;
let desktop = null;
let browser = null;
let livePage = null;
const report = { checks: [], screenshots: [], widths: [] };

function readRenderedTerminalTextScript() {
  const registry = window.__drogonTerminals;
  if (!registry || registry.size === 0)
    return document.querySelector(".xterm-screen")?.textContent ?? "";
  const lines = [];
  for (const terminal of registry.values()) {
    const buffer = terminal.buffer.active;
    for (let row = 0; row < buffer.length; row += 1)
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

async function renderedText(page) {
  return page.evaluate(readRenderedTerminalTextScript);
}

async function waitForRenderedTextIncludes(page, needle, timeout = 20000) {
  await page.waitForFunction(
    (text) => {
      const registry = window.__drogonTerminals;
      let rendered = "";
      if (!registry || registry.size === 0) {
        rendered = document.querySelector(".xterm-screen")?.textContent ?? "";
      } else {
        const lines = [];
        for (const terminal of registry.values()) {
          const buffer = terminal.buffer.active;
          for (let row = 0; row < buffer.length; row += 1)
            lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
        }
        rendered = lines.join("\n");
      }
      return rendered.includes(text);
    },
    needle,
    { timeout },
  );
}

async function goToBotsPage(page) {
  // The sidebar nav row; the Bot session header's own "Bots" breadcrumb
  // button shares the accessible name, so scope to the shell sidebar.
  await page
    .locator(".shell-sidebar")
    .getByRole("button", { name: "Bots", exact: true })
    .first()
    .click();
}

async function countSessionTabs(page) {
  return page.locator('[role="tablist"][aria-label="Sessions"] [role="tab"]').count();
}

async function main() {
  drogond = startAcceptanceProcess(drogondBin, ["--data-dir", dataDir], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH ?? ""}` },
  });
  assert.ok(drogond.pid, "drogond must report a pid");
  await delay(600);
  assert.equal(drogond.exitCode, null, "drogond must still be running");

  desktop = startAcceptanceProcess(
    electronBin,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: electronProfile,
        DROGON_BACKGROUND_WINDOW: "1",
        PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
      },
    },
  );
  if (desktop.pid) report.desktopPid = desktop.pid;

  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Electron did not publish a debugging endpoint: ${tail}`),
        ),
      20000,
    );
    desktop.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    desktop.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited before connection (code ${code})`));
    });
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
      );
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page = null;
  for (let i = 0; i < 200 && !page; i += 1) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(50);
  }
  assert.ok(page, "Electron must create a rendered page");
  livePage = page;
  page.setDefaultTimeout(20000);
  await emulatePageFocus(page);

  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  report.checks.push("app-ready");

  const registered = await page.evaluate(async (dir) => {
    const result = await window.drogon.addWorkspace(dir);
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }, projectDir);
  const status = await page.evaluate(async () => {
    const result = await window.drogon.status();
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  });
  const bot = await page.evaluate(
    async ({ hostId, workspaceId }) => {
      const result = await window.drogon.botCreate({
        hostId,
        workspaceId,
        requestId: crypto.randomUUID(),
        locale: "en-US",
        body: {
          characterPreset: "arya",
          displayIdentity: {
            displayName: "Arya Stark",
            handle: "arya-stark",
            title: "Scout",
          },
          harnessPolicy: { defaultHarness: "pi", explicitModel: null },
          instructions: "Always answer first as Arya Stark, never as the underlying CLI.",
          memories: ["The owner is Carlos."],
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.result;
    },
    { hostId: status.hostId, workspaceId: registered.id },
  );
  report.checks.push(`bot-created:${bot.id}`);

  await goToBotsPage(page);
  await page.getByTestId(`open-session-${bot.id}`).waitFor();
  await page.getByTestId(`open-session-${bot.id}`).click();
  await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
  report.checks.push("session-opened");

  // ---- Gap 1: the harness process reads the generated identity files ----
  await page.locator(".xterm-screen:visible").waitFor();
  await waitForRenderedTextIncludes(page, "---CLAUDE---", 20000);
  const identityText = await renderedText(page);
  assert.ok(
    identityText.includes("- Name: Arya Stark"),
    `harness must read the display name: ${JSON.stringify(identityText.slice(0, 800))}`,
  );
  assert.ok(identityText.includes("- Handle: @arya-stark"), "harness must read the handle");
  assert.ok(identityText.includes("- Role: Scout"), "harness must read the role");
  assert.ok(identityText.includes(INSTRUCTIONS), "harness must read the standing instructions");
  assert.ok(identityText.includes(`- ${MEMORY}`), "harness must read the memories");
  assert.ok(
    identityText.includes("Your identity, role, standing instructions and memories"),
    "CLAUDE.md must point the harness at AGENTS.md",
  );
  report.checks.push("harness-received-bot-identity");

  // ---- Gap 2: the second Open session focuses the same session ----
  assert.equal(await countSessionTabs(page), 1, "one open session must be one tab");
  await goToBotsPage(page);
  await page.getByTestId(`open-session-${bot.id}`).waitFor();
  await page.getByTestId(`open-session-${bot.id}`).click();
  await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
  await delay(500);
  assert.equal(
    await countSessionTabs(page),
    1,
    "clicking Open session again must NOT spawn a second session",
  );
  const focusedTab = page.locator(
    '[role="tablist"][aria-label="Sessions"] [role="tab"][aria-selected="true"]',
  );
  assert.equal(await focusedTab.count(), 1, "exactly one tab must be active");
  assert.match(
    (await focusedTab.first().getAttribute("aria-label")) ?? "",
    /Arya Stark/,
    "the focused tab must be the Bot session",
  );
  report.checks.push("open-session-twice-one-tab");

  // ---- Gap 3: the sidebar Chats section lists the Bot session ----
  const botRow = page.locator(`[data-bot-session-row="${bot.id}"]`);
  await botRow.waitFor({ timeout: 20000 });
  const botRowText = (await botRow.textContent()) ?? "";
  assert.ok(botRowText.includes("Arya Stark"), "sidebar row must name the Bot");
  assert.ok(botRowText.includes("Pi"), "sidebar row must name the harness");
  const state = await botRow.getAttribute("data-bot-session-state");
  assert.ok(state && state !== "exited", `sidebar row must show a live state, got ${state}`);
  report.checks.push(`sidebar-bot-row:${state}`);
  await page.screenshot({
    path: path.join(output, "01-sidebar-bot-row.png"),
    animations: "disabled",
  });
  report.screenshots.push("01-sidebar-bot-row.png");

  // Navigate away by opening the Bots page, then click the sidebar row: it
  // must bring the SAME one session back into focus without adding a tab.
  await goToBotsPage(page);
  await page.getByTestId("bots-panel").waitFor();
  await botRow.click();
  await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
  await delay(400);
  assert.equal(
    await countSessionTabs(page),
    1,
    "opening from the sidebar must not add a session",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: /Arya Stark/ })
      .getAttribute("aria-selected"),
    "true",
    "the sidebar click must focus the Bot session tab",
  );
  report.checks.push("sidebar-click-focuses-same-session");

  // ---- Parity widths (no horizontal overflow) + light/dark captures ----
  for (const width of [1440, 1100, 900, 760]) {
    await page.setViewportSize({ width, height: 900 });
    await delay(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, `app must not overflow horizontally at ${width}px`);
    report.widths.push({ width, overflow });
    await page.screenshot({
      path: path.join(output, `width-${width}.png`),
      animations: "disabled",
    });
    report.screenshots.push(`width-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
    await page.screenshot({
      path: path.join(output, `theme-${theme}.png`),
      animations: "disabled",
    });
    report.screenshots.push(`theme-${theme}.png`);
    report.checks.push(`theme-captured:${theme}`);
  }

  // Stop the session with the real Stop button so its fixture process ends
  // before the daemon does.
  await page.getByTestId("bot-session-stop").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="bot-session-status-pill"]')
        ?.textContent?.includes("Exited"),
    undefined,
    { timeout: 15000 },
  );
  report.checks.push("stop-terminates-session");

  console.log("PASS", JSON.stringify(report, null, 2));
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error("FAIL", error);
  console.error("checks so far:", JSON.stringify(report.checks, null, 2));
  if (livePage) {
    try {
      await mkdir(output, { recursive: true });
      await livePage.screenshot({
        path: path.join(output, "FAILURE.png"),
        animations: "disabled",
      });
      const bodyText = await livePage.evaluate(() => document.body.innerText);
      await writeFile(path.join(output, "FAILURE-body.txt"), bodyText);
      console.error("failure evidence written to", output);
    } catch (captureError) {
      console.error("failed to capture failure evidence:", captureError);
    }
  }
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best effort
    }
  }
  if (desktop) report.desktopStop = await stopAcceptanceProcess(desktop);
  if (drogond) report.drogondStop = await stopAcceptanceProcess(drogond);
  const desktopExited = !desktop || report.desktopStop?.verdict === "exited";
  const drogondExited = !drogond || report.drogondStop?.verdict === "exited";
  // Scoped cleanup evidence: no process may still reference this run's
  // temporary directory. Never a broad executable-name match.
  let survivors = "";
  try {
    const { stdout } = await execFileAsync("pgrep", ["-fl", fixture]);
    survivors = stdout.trim();
  } catch {
    survivors = "";
  }
  report.scopedSurvivors = survivors;
  if (desktopExited && drogondExited && survivors === "") {
    await rm(fixture, { recursive: true, force: true });
  } else {
    console.error(
      `owned processes did not confirm exit (or a survivor referenced ${fixture}); leaving it for inspection`,
    );
  }
  console.log(
    "cleanup",
    JSON.stringify(
      { desktopExited, drogondExited, scopedSurvivors: survivors },
      null,
      2,
    ),
  );
}
if (failure) process.exit(1);
