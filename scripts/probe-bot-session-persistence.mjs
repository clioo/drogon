// Regression proof for two Bot-session defects the owner found by hand:
//
//  1. Placement: opening Bot B must never land its session in Bot A's
//     workspace -- each Bot's session must always run in that Bot's OWN
//     home (crates/drogon-core/src/bot_run_rpc.rs's `RunTurn::OpenSession`
//     retarget + `bot_self_mgmt::ensure_home_for_bot`, keyed purely by
//     bot id). Exercised here across fresh first-opens, a cancel-and-retry
//     pattern, and TRUE concurrent dispatch (Promise.all, no await gap) --
//     this codebase did not reproduce placement misattribution under any of
//     these, on main or with the persistence fix below, so this section is
//     a regression guard, not a fix landing.
//  2. Persistence: a Bot session must stay reachable (the sidebar's Chats
//     row) and resumable for as long as it is alive, regardless of which
//     workspace is currently selected -- "si cambio de sesion, los bots de
//     ahi desaparecen" (the owner's report). This DID reproduce on main
//     (Arya's Chats row vanishes the instant you open a second Bot in a
//     different workspace) and is fixed by App.tsx's host-wide session poll
//     (`mergeSessionsForBots` in
//     apps/desktop/src/renderer/src/features/bots/bot-session-visibility.ts).
//
// Drives the REAL packaged-dev app (built renderer + real drogond) in a
// hidden background window with a plain shell fixture standing in for the
// harness (no real model inference, per AGENTS.md). Own temporary
// DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE; never the developer's running
// instance; every owned process is torn down and verified exited in
// `finally` before the fixture directory is removed.
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
  "apps/desktop/out missing -- run `pnpm --filter @drogon/desktop exec electron-vite build` first",
);

const fixture = await mkdtemp(path.join(tmpdir(), "dgbotpersist-"));
const dataDir = path.join(fixture, "data");
const electronProfile = path.join(fixture, "electron");
const fixtureBin = path.join(fixture, "bin");
const projectDir = path.join(fixture, "project-worktree");
const output = path.join(root, ".preflight", "bot-session-persistence", `${Date.now()}`);

function readRenderedTerminalText() {
  const registry = window.__drogonTerminals;
  if (!registry || registry.size === 0)
    return document.querySelector(".xterm-screen")?.textContent ?? "";
  const lines = [];
  for (const terminal of registry.values()) {
    const buffer = terminal.buffer.active;
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
  }
  return lines.join("\n");
}

async function waitForRenderedTextIncludes(page, needle, timeout) {
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
          for (let row = 0; row < buffer.length; row += 1) {
            lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
          }
        }
        rendered = lines.join("\n");
      }
      return rendered.includes(text);
    },
    needle,
    { timeout },
  );
}

async function getRenderedText(page) {
  return page.evaluate(readRenderedTerminalText);
}

async function waitForBotSessionTitle(page, expected, timeout = 20000) {
  await page.getByTestId("bot-session-header").waitFor({ timeout });
  await page.waitForFunction(
    (text) =>
      document.querySelector('[data-testid="bot-session-title"]')?.textContent?.trim() === text,
    expected,
    { timeout },
  );
}

async function stopFocusedBotSession(page) {
  if (!(await page.getByTestId("bot-session-stop").isEnabled().catch(() => false))) return;
  await page.getByTestId("bot-session-stop").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="bot-session-status-pill"]')
        ?.textContent?.includes("Exited"),
    undefined,
    { timeout: 15000 },
  );
}

await mkdir(dataDir, { recursive: true });
await mkdir(electronProfile, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(projectDir, { recursive: true });
await mkdir(output, { recursive: true });

// Each spawned fixture process prints its own cwd, then genuinely
// converses -- lets the probe tell sessions apart by rendered CONTENT
// (never just UI chrome) and prove a resumed session is the SAME process
// (its earlier conversation is still in the scrollback) rather than a
// fresh spawn. `trap` so SIGTERM (session.stop) exits cleanly.
const fixtureScript = `#!/bin/sh
echo "CWD=$(pwd)"
echo "Session live. Ready for instructions."
trap 'exit 0' TERM INT
while IFS= read -r line; do
  echo "you said: $line"
done
exit 0
`;
const fixturePath = path.join(fixtureBin, "pi");
await writeFile(fixturePath, fixtureScript);
await chmod(fixturePath, 0o755);

let drogond = null;
let desktop = null;
let browser = null;
let livePage = null;
const report = { checks: [], notes: [], screenshots: [] };

async function countFixtureProcesses() {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid,ppid,command"]);
    return stdout
      .split("\n")
      .filter((line) => line.includes(fixturePath))
      .map((line) => line.trim());
  } catch {
    return [];
  }
}

async function createBot(page, { hostId, workspaceId, displayName, handle, characterPreset }) {
  return page.evaluate(
    async ({ hostId, workspaceId, displayName, handle, characterPreset }) => {
      const result = await window.drogon.botCreate({
        hostId,
        workspaceId,
        requestId: crypto.randomUUID(),
        locale: "en-US",
        body: {
          characterPreset,
          displayIdentity: { displayName, handle, title: null },
          harnessPolicy: { defaultHarness: "pi", explicitModel: null },
          instructions: "",
          memories: [],
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.result;
    },
    { hostId, workspaceId, displayName, handle, characterPreset },
  );
}

async function openBotFromBotsPage(page, botId) {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await page.getByTestId(`open-session-${botId}`).waitFor();
  await page.getByTestId(`open-session-${botId}`).click();
}

async function main() {
  drogond = startAcceptanceProcess(drogondBin, ["--data-dir", dataDir], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH ?? ""}` },
  });
  assert.ok(drogond.pid, "drogond must report a pid");
  await delay(600);
  assert.equal(drogond.exitCode, null, "drogond must still be running");

  desktop = startAcceptanceProcess(electronBin, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: electronProfile,
      DROGON_BACKGROUND_WINDOW: "1",
      PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
    },
  });
  if (desktop.pid) report.desktopPid = desktop.pid;

  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
      20000,
    );
    desktop.once("error", (error) => { clearTimeout(timer); reject(error); });
    desktop.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited before connection (code ${code}): ${tail}`));
    });
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
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

  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
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

  const arya = await createBot(page, {
    hostId: status.hostId,
    workspaceId: registered.id,
    displayName: "Arya Stark",
    handle: "arya-stark",
    characterPreset: "arya",
  });
  const jonSnow = await createBot(page, {
    hostId: status.hostId,
    workspaceId: registered.id,
    displayName: "Jon Snow",
    handle: "jon-snow-h",
    characterPreset: "jon-snow",
  });
  report.checks.push(`bots-created:${arya.id},${jonSnow.id}`);

  // ---- Open Arya, then Jon Snow: each must land in ITS OWN home. ----
  await openBotFromBotsPage(page, arya.id);
  await waitForBotSessionTitle(page, "Arya Stark · Pi");
  await waitForRenderedTextIncludes(page, "CWD=", 15000);
  let rendered = await getRenderedText(page);
  const aryaCwdLine = rendered.split("\n").find((l) => l.startsWith("CWD="));
  assert.ok(aryaCwdLine?.includes("/arya-stark"), `Arya's session must run in her own home, got: ${aryaCwdLine}`);
  report.notes.push(`arya cwd=${aryaCwdLine}`);

  await openBotFromBotsPage(page, jonSnow.id);
  await waitForBotSessionTitle(page, "Jon Snow · Pi");
  await waitForRenderedTextIncludes(page, "CWD=", 15000);
  rendered = await getRenderedText(page);
  const jonCwdLine = rendered.split("\n").find((l) => l.startsWith("CWD="));
  assert.ok(
    jonCwdLine?.includes("/jon-snow-h") && !jonCwdLine.includes("/arya-stark"),
    `DEFECT1: Jon Snow's session must run in HIS own home, not Arya's, got: ${jonCwdLine}`,
  );
  report.notes.push(`jon-snow cwd=${jonCwdLine}`);

  await page.screenshot({ path: path.join(output, "01-jon-snow-own-workspace.png"), animations: "disabled" });
  report.screenshots.push("01-jon-snow-own-workspace.png");

  // ---- DEFECT 2: switch away from Arya (now on Jon Snow's own
  // workspace) -- her Chats row must stay present/truthful, and clicking
  // it must resume the SAME process (never kill it, never spawn a
  // second). ----
  const aryaMarker = "arya-marker-before-switch";
  await page.locator(`[data-bot-session-row="${arya.id}"]`).waitFor({ timeout: 10000 });
  await page.locator(`[data-bot-session-row="${arya.id}"]`).click();
  await waitForBotSessionTitle(page, "Arya Stark · Pi");
  await page.locator(".xterm-helper-textarea:visible").click();
  await page.keyboard.type(aryaMarker);
  await page.keyboard.press("Enter");
  await waitForRenderedTextIncludes(page, `you said: ${aryaMarker}`, 15000);
  report.checks.push("arya-marker-planted");

  const fixtureCountBeforeSwitch = (await countFixtureProcesses()).length;
  assert.equal(fixtureCountBeforeSwitch, 2, "both Bot sessions must be live before the switch");

  await page.locator(`[data-bot-session-row="${jonSnow.id}"]`).click();
  await waitForBotSessionTitle(page, "Jon Snow · Pi");
  report.checks.push("switched-to-jon-snow");

  const aryaRowVisible = await page
    .locator(`[data-bot-session-row="${arya.id}"]`)
    .isVisible()
    .catch(() => false);
  await page.screenshot({ path: path.join(output, "02-defect2-arya-row-while-on-jon-snow.png"), animations: "disabled" });
  report.screenshots.push("02-defect2-arya-row-while-on-jon-snow.png");
  assert.ok(
    aryaRowVisible,
    "DEFECT2: Arya's Chats row must stay visible while a different Bot's workspace is selected",
  );

  const fixtureCountAfterSwitch = (await countFixtureProcesses()).length;
  assert.equal(
    fixtureCountAfterSwitch,
    fixtureCountBeforeSwitch,
    "switching workspace must not kill or spawn extra Bot session processes",
  );
  report.checks.push("fixture-process-count-stable-across-switch");

  // Click back: must resume the SAME session (marker still in scrollback),
  // never spawn a fresh one.
  await page.locator(`[data-bot-session-row="${arya.id}"]`).click();
  await waitForBotSessionTitle(page, "Arya Stark · Pi");
  await waitForRenderedTextIncludes(page, `you said: ${aryaMarker}`, 15000);
  report.checks.push("arya-resume-preserved-marker");

  const fixtureCountAfterResume = (await countFixtureProcesses()).length;
  assert.equal(
    fixtureCountAfterResume,
    fixtureCountBeforeSwitch,
    "resuming from the Chats row must not spawn a duplicate session",
  );

  await page.screenshot({ path: path.join(output, "03-arya-resumed.png"), animations: "disabled" });
  report.screenshots.push("03-arya-resumed.png");

  // ---- Placement regression guard, part 1: cancel out of an in-flight
  // open and immediately open a different bot, repeated. ----
  for (let round = 0; round < 4; round += 1) {
    await page.getByRole("button", { name: "Bots", exact: true }).first().click();
    const hasNewSession = await page.getByTestId(`new-session-${jonSnow.id}`).count();
    if (hasNewSession) await page.getByTestId(`new-session-${jonSnow.id}`).click();
    else await page.getByTestId(`open-session-${jonSnow.id}`).click();
    // Do not wait for settle -- immediately back out and open Arya.
    await page.keyboard.press("Escape").catch(() => {});
    await page.getByRole("button", { name: "Bots", exact: true }).first().click();
    const hasAryaNew = await page.getByTestId(`new-session-${arya.id}`).count();
    if (hasAryaNew) await page.getByTestId(`new-session-${arya.id}`).click();
    else await page.getByTestId(`open-session-${arya.id}`).click();
    await waitForBotSessionTitle(page, "Arya Stark · Pi", 15000);
    await waitForRenderedTextIncludes(page, "CWD=", 15000);
    rendered = await getRenderedText(page);
    const cwdLines = rendered.split("\n").filter((l) => l.startsWith("CWD="));
    const cwdLine = cwdLines[cwdLines.length - 1];
    assert.ok(
      cwdLine?.includes("/arya-stark") && !cwdLine.includes("/jon-snow-h"),
      `DEFECT1 (cancel-and-retry round ${round}): Arya's active session shows the wrong cwd: ${cwdLine}`,
    );
  }
  report.checks.push("placement-guard-cancel-and-retry:4-rounds-clean");

  // ---- Placement regression guard, part 2: TRUE concurrency. Stop both
  // bots, then fire both Chats-row re-opens via Promise.all with no await
  // gap -- neither the sidebar's re-open path nor the Bots-page path
  // serializes across DIFFERENT mounts, so this is genuine overlap. ----
  for (let round = 0; round < 3; round += 1) {
    await page.locator(`[data-bot-session-row="${arya.id}"]`).click();
    await waitForBotSessionTitle(page, "Arya Stark · Pi", 15000);
    await stopFocusedBotSession(page);
    await page.locator(`[data-bot-session-row="${jonSnow.id}"]`).click();
    await waitForBotSessionTitle(page, "Jon Snow · Pi", 15000);
    await stopFocusedBotSession(page);

    await Promise.all([
      page.locator(`[data-bot-session-row="${arya.id}"]`).click(),
      page.locator(`[data-bot-session-row="${jonSnow.id}"]`).click(),
    ]);
    await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500); // let both concurrent dispatches settle

    for (const [label, botId, expectedFragment, forbiddenFragment] of [
      ["Arya Stark · Pi", arya.id, "/arya-stark", "/jon-snow-h"],
      ["Jon Snow · Pi", jonSnow.id, "/jon-snow-h", "/arya-stark"],
    ]) {
      await page.locator(`[data-bot-session-row="${botId}"]`).click();
      await waitForBotSessionTitle(page, label, 15000);
      await page.waitForTimeout(300);
      const paneText = await getRenderedText(page);
      const lines = paneText.split("\n").filter((l) => l.startsWith("CWD="));
      const cwdLine = lines[lines.length - 1];
      assert.ok(
        cwdLine?.includes(expectedFragment) && !cwdLine.includes(forbiddenFragment),
        `DEFECT1 (true concurrency round ${round}): ${label}'s pane shows the wrong cwd: ${cwdLine}`,
      );
    }
  }
  report.checks.push("placement-guard-true-concurrency:3-rounds-clean");

  console.log("PASS", JSON.stringify(report, null, 2));
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error("FAIL", error);
  console.error("checks so far:", JSON.stringify(report.checks, null, 2));
  console.error("notes so far:", JSON.stringify(report.notes, null, 2));
  if (livePage) {
    try {
      await mkdir(output, { recursive: true });
      await livePage.screenshot({ path: path.join(output, "FAILURE.png"), animations: "disabled" });
      const bodyText = await livePage.evaluate(() => document.body.innerText);
      await writeFile(path.join(output, "FAILURE-body.txt"), bodyText);
      console.error("failure evidence written to", output);
    } catch (captureError) {
      console.error("failed to capture failure evidence:", captureError);
    }
  }
} finally {
  if (browser) {
    try { await browser.close(); } catch { /* best effort */ }
  }
  if (desktop) {
    report.desktopStop = await stopAcceptanceProcess(desktop);
  }
  if (drogond) {
    report.drogondStop = await stopAcceptanceProcess(drogond);
  }
  const desktopExited = !desktop || report.desktopStop?.verdict === "exited";
  const drogondExited = !drogond || report.drogondStop?.verdict === "exited";
  const remainingFixtures = await countFixtureProcesses();
  if (remainingFixtures.length > 0) {
    console.error("fixture processes still present after teardown:", remainingFixtures);
  }
  if (desktopExited && drogondExited && remainingFixtures.length === 0) {
    await rm(fixture, { recursive: true, force: true });
  } else {
    console.error(`owned processes did not confirm exit -- leaving fixture dir for inspection: ${fixture}`);
  }
  console.log(
    "cleanup",
    JSON.stringify(
      { desktopExited, drogondExited, remainingFixtures: remainingFixtures.length },
      null,
      2,
    ),
  );
}
if (failure) process.exit(1);
