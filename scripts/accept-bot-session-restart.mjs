// Focused CDP acceptance for the owner's "the Bot session does not start /
// Stop does nothing" regressions (task_252b2d1a2b29), plus the two smaller
// reports it was grouped with.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE). The harness is the
// repo's prescribed SHELL FIXTURE on PATH -- never real model inference.
//
// The fixture is a raw-byte recorder: it prints a startup banner (so the
// terminal's RENDERED text proves the harness booted), then puts the PTY in
// raw mode and appends every stdin byte, one hex line at a time, to
// `.drogon-bytes` in its cwd. That makes input delivery observable without
// depending on terminal echo. Raw mode matters: a TUI harness runs the PTY
// raw, and the canonical line discipline would otherwise eat an image-paste
// Ctrl+V (0x16) as VLNEXT.
//
// What it proves:
//  P0  a Bot session boots (rendered terminal text, not the absence of an
//      error), accepts a turn, and boots AGAIN after the whole app is
//      relaunched over the same data dir -- the daemon recovers the prior
//      row as `unverifiable`, which used to be focused as if it were live and
//      left a blank pane with a Stop button that could not do anything.
//  P1  Stop on a genuinely running session really exits the OS process (the
//      pid is checked with signal 0), and the daemon reports `exited`.
//  P2  an image-only clipboard reaches the session as the Ctrl+V byte the
//      harness's own clipboard reader listens on (0x16 in the byte log).
//  P3  the Chats rows render at 1440/1100/900/760 in light and dark with no
//      horizontal overflow, and the avatar carries the larger size class.
//
// Usage: node scripts/accept-bot-session-restart.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import {
  terminalBufferText,
  waitForTerminalText,
} from "./acceptance-terminal-text.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");

const fixture = await mkdtemp(path.join(tmpdir(), "dbsr-restart-"));
const dataDir = path.join(fixture, "data");
const foreignDir = path.join(fixture, "project");
const fixtureBin = path.join(fixture, "bin");
// The fixture writes its raw stdin byte log here; a DROGON_-prefixed name
// would be scrubbed from the session environment by design.
const byteLog = path.join(fixture, "bytes.log");
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `bot-session-restart-${Date.now()}`,
);
await mkdir(foreignDir, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(output, { recursive: true });

// One `claude` stand-in: banner (argv + cwd) then raw byte recording. `stty
// raw` is what a real TUI does, and it is required for 0x16 to reach the
// program at all.
const fixtureScript = [
  "#!/bin/bash",
  "echo CWD=$(pwd)",
  '[ -f .prior ] && echo "PRIOR:$(cat .prior)"',
  'echo "prior" > .prior',
  'for arg in "$@"; do echo "ARG:$arg"; done',
  ': > "$ACCEPT_BYTE_LOG"',
  "trap 'exit 0' TERM INT",
  "stty raw -echo 2>/dev/null",
  "while :; do",
  "  hex=$(dd bs=1 count=1 2>/dev/null | od -An -tx1 | tr -d ' \\n')",
  '  [ -z "$hex" ] && break',
  '  printf \'%s\\n\' "$hex" >> "$ACCEPT_BYTE_LOG"',
  "done",
].join("\n");
await writeFile(path.join(fixtureBin, "claude"), `${fixtureScript}\n`, { mode: 0o755 });

const daemonBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond");
const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");

const report = {
  kind: "bot-session-restart-cdp",
  output,
  checks: [],
  screenshots: [],
  processes: {},
};
let daemon = null;
let desktop = null;
let browser = null;
let page = null;
const ownedPids = new Set();

function ownPid(pid) {
  if (pid) ownedPids.add(pid);
}

async function allProcesses() {
  const { stdout } = await runAcceptanceProcess("ps", ["-Ao", "pid=,ppid="], { timeout: 5000 });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))
    .map(([pid, ppid]) => ({ pid, ppid }));
}

async function descendants(roots) {
  const all = await allProcesses();
  const found = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of all) {
      if (found.has(item.ppid) && !found.has(item.pid)) {
        found.add(item.pid);
        grew = true;
      }
    }
  }
  return [...found];
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOwned(child, label) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  report.processes[label] = result.verdict;
  if (result.verdict !== "exited") {
    throw new Error(`${label} did not exit cleanly: ${JSON.stringify(result)}`);
  }
}

async function waitForDaemon() {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 1000 });
      assert.equal(JSON.parse(response.stdout).ok, true);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function startDaemon() {
  const child = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      PI_CODING_AGENT_DIR: path.join(fixture, ".pi", "agent"),
      ACCEPT_BYTE_LOG: byteLog,
    },
  });
  ownPid(child.pid);
  await waitForDaemon();
  return child;
}

async function launchDesktop() {
  const child = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      PI_CODING_AGENT_DIR: path.join(fixture, ".pi", "agent"),
      SHELL: "/bin/sh",
    },
  });
  ownPid(child.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 20000);
    child.once("exit", () => reject(new Error(`electron exited before connecting: ${tail}`)));
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  assert.ok(page, "electron must create a rendered page");
  page.setDefaultTimeout(20000);
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  return child;
}

async function shot(name) {
  await page.screenshot({ path: path.join(output, name), animations: "disabled" });
  report.screenshots.push(name);
}

async function assertNoOverflow(label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `horizontal overflow at ${label}`);
  report.checks.push(`no-horizontal-overflow-${label}`);
}

async function botSnapshot(botId) {
  return page.evaluate(async (id) => {
    const hostId = (await window.drogon.status()).result.hostId;
    const snapshot = await window.drogon.botSnapshot({ workspaceId: "", hostId, locale: "en-US" });
    return snapshot.result.bots.find((entry) => entry.id === id)?.currentSession ?? null;
  }, botId);
}

/** The fixture's own byte log, read from the Bot home it printed. */
async function recordedBytes() {
  try {
    const raw = await readFile(byteLog, "utf8");
    return raw.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

function containsSequence(bytes, sequence) {
  if (!bytes) return false;
  for (let start = 0; start + sequence.length <= bytes.length; start += 1) {
    if (sequence.every((byte, offset) => bytes[start + offset] === byte)) return true;
  }
  return false;
}

/** Waits until the byte log holds `sequence` as a contiguous run. */
async function waitForByteSequence(sequence, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const bytes = await recordedBytes();
    if (containsSequence(bytes, sequence)) return bytes;
    if (Date.now() >= deadline) return bytes;
    await delay(100);
  }
}

/** Waits until the byte log holds a single marker line (e.g. "16"). */
async function waitForBytes(marker, timeoutMs) {
  return waitForByteSequence([marker], timeoutMs);
}

function hexOf(text) {
  return [...Buffer.from(text, "utf8")].map((byte) => byte.toString(16).padStart(2, "0"));
}

async function createBot() {
  await page.getByRole("button", { name: "Workspace options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(foreignDir);
  await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
  await page.getByRole("button", { name: /^Select project/ }).waitFor();

  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.waitFor();
  await panel.getByRole("button", { name: "New Bot", exact: true }).click();
  const form = page.getByRole("form", { name: "Create a Bot" });
  await form.waitFor();
  await form.locator("label").filter({ hasText: "Jon Snow" }).first().click();
  await form.getByLabel("Name (optional)").fill("Jon Snow");
  await form.getByLabel("Purpose").fill("Acceptance probe bot.");
  await form.getByText(/^Advanced · /).click();
  await form.getByLabel("Agent", { exact: true }).selectOption("claude");
  await form.getByRole("button", { name: "Create Bot", exact: true }).click();
  const card = panel.locator('[data-slot="card"][data-testid^="bot-"]', { hasText: "Jon Snow" });
  await card.waitFor();
  const testId = await card.getAttribute("data-testid");
  assert.ok(testId?.startsWith("bot-"), `bot card must carry bot-<id>, got ${testId}`);
  report.checks.push("bot-created-from-the-real-page");
  return testId.slice(4);
}

async function openSessionFromBotsPage(botId) {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click().catch(() => {});
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.waitFor();
  await panel
    .locator('[data-slot="card"][data-testid^="bot-"]', { hasText: "Jon Snow" })
    .waitFor();
  // The redesign collapses an unconfigured Bot to a compact row: expand it so
  // the real "Open session" control is on screen before clicking.
  const expanded = await panel.getByTestId(`bot-expand-${botId}`).getAttribute("aria-expanded");
  if (expanded !== "true") await panel.getByTestId(`bot-expand-${botId}`).click();
  await panel.getByTestId(`open-session-${botId}`).click();
}

try {
  daemon = await startDaemon();
  desktop = await launchDesktop();
  const botId = await createBot();

  // ---- P0: first open boots the harness (rendered text, not silence) ----
  await openSessionFromBotsPage(botId);
  await waitForTerminalText(page, "CWD=");
  const firstText = await terminalBufferText(page);
  assert.ok(
    firstText.includes("ARG:--dangerously-skip-permissions"),
    `the real harness argv must be rendered: ${firstText}`,
  );
  assert.ok(
    !firstText.includes("ARG:--continue"),
    `a fresh open must not resume anything: ${firstText}`,
  );
  const firstSession = await botSnapshot(botId);
  assert.equal(firstSession?.verdict, "live");
  report.firstSession = firstSession.sessionId;
  report.checks.push("p0-first-open-boots-live-harness");

  // ---- P0/P1: send a turn, then Stop must really kill the process ----
  const turn = "hello from the acceptance probe\n";
  await page.evaluate(async (session) => {
    await window.drogon.write({
      sessionId: session.sessionId,
      incarnation: session.incarnation,
      text: "hello from the acceptance probe\n",
    });
  }, firstSession);
  const turnHex = hexOf("hello from the acceptance probe");
  const afterTurn = await waitForByteSequence(turnHex, 10000);
  assert.ok(
    containsSequence(afterTurn, turnHex),
    `the session must accept input; got ${(afterTurn ?? []).join(",")}`,
  );
  report.checks.push("p0-session-accepts-input");

  const pid = firstSession.processId;
  assert.ok(Number.isInteger(pid) && pid > 0, `expected a live pid, got ${pid}`);
  assert.equal(alive(pid), true, `pid ${pid} must be running before Stop`);
  await page.getByTestId("bot-session-stop").click();
  let stopped = null;
  const stopDeadline = Date.now() + 15000;
  while (Date.now() < stopDeadline) {
    stopped = await botSnapshot(botId);
    if (stopped?.verdict === "exited") break;
    await delay(200);
  }
  assert.equal(stopped?.verdict, "exited", "Stop must report the session exited");
  const goneDeadline = Date.now() + 5000;
  while (alive(pid) && Date.now() < goneDeadline) await delay(50);
  assert.equal(alive(pid), false, `Stop must actually kill pid ${pid}`);
  assert.equal(stopped.processId ?? null, null, "an exited session must not project a pid");
  report.checks.push("p1-stop-exits-the-real-process");
  void turn;

  // ---- P2: an image-only clipboard reaches the harness as Ctrl+V (0x16) ----
  // Reopen a live session to paste into (the previous one was stopped).
  await openSessionFromBotsPage(botId);
  await waitForTerminalText(page, "CWD=");
  const pasteSession = await botSnapshot(botId);

  // TEXT first, through the real paste chord: proves the handler runs and the
  // fixture records input.
  await page.evaluate(() => navigator.clipboard.writeText("CLIPBOARD-TEXT-PROBE"));
  await page.locator(".xterm-helper-textarea").first().click({ force: true });
  await page.keyboard.press("Meta+v");
  const textProbeHex = hexOf("CLIPBOARD-TEXT-PROBE");
  const afterText = await waitForByteSequence(textProbeHex, 10000);
  assert.ok(
    containsSequence(afterText, textProbeHex),
    `text paste through the real chord must reach the session; got ${(afterText ?? []).join(",")}`,
  );
  report.checks.push("p2-text-paste-through-the-real-chord");

  // Now a REAL image on the clipboard (no text) and the same chord.
  report.imageClipboardWrite = await page.evaluate(async () => {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return "unavailable";
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
      ),
      (c) => c.charCodeAt(0),
    );
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) }),
      ]);
      return "written";
    } catch (error) {
      return `failed:${error instanceof Error ? error.message : String(error)}`;
    }
  });
  assert.equal(report.imageClipboardWrite, "written", "the probe must put a real image on the clipboard");
  const clipboardTypes = await page.evaluate(async () => {
    const items = await navigator.clipboard.read().catch(() => []);
    return items.flatMap((item) => item.types);
  });
  report.clipboardTypes = clipboardTypes;
  assert.deepEqual(clipboardTypes, ["image/png"], "the clipboard must hold only the image");
  await page.locator(".xterm-helper-textarea").first().click({ force: true });
  await page.keyboard.press("Meta+v");
  const afterImage = await waitForBytes("16", 10000);
  assert.ok(
    (afterImage ?? []).includes("16"),
    `an image-only clipboard must reach the harness as Ctrl+V (0x16); got ${(afterImage ?? []).join(",")}`,
  );
  report.checks.push("p2-image-paste-delivers-ctrl-v");

  // ---- P3: the Chats rows render at every width, in both themes ----
  const sidebarRow = page.locator("[data-bot-session-row]").first();
  await sidebarRow.waitFor();
  const avatar = sidebarRow.locator('span[role="img"]').first();
  const avatarAlt = await avatar.getAttribute("aria-label");
  assert.match(avatarAlt ?? "", /avatar$/);
  const avatarClass = await avatar.getAttribute("class");
  assert.ok(
    avatarClass?.includes("size-5"),
    `the avatar must carry the larger size class, got ${avatarClass}`,
  );
  const rowClass = await sidebarRow.getAttribute("class");
  assert.ok(rowClass?.includes("h-6"), `the row rhythm must stay h-6, got ${rowClass}`);
  report.checks.push("p3-chats-avatar-is-larger");

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await sidebarRow.waitFor();
      await page.evaluate(() => {
        document.querySelector("[data-bot-session-row]")?.scrollIntoView({ block: "center" });
      });
      await assertNoOverflow(`${theme}-${width}`);
      await shot(`chats-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await delay(200);
  }

  // ---- P0/P1: relaunch the WHOLE app over the same data dir ----
  // The daemon recovers the (now stopped) row as `unverifiable`; the old code
  // focused that dead stub, so the pane stayed blank and Stop did nothing.
  await browser.close();
  browser = null;
  await stopOwned(desktop, "desktop");
  desktop = null;
  await stopOwned(daemon, "daemon");
  daemon = null;
  await delay(1500);
  report.checks.push("relaunch-teardown-clean");

  daemon = await startDaemon();
  desktop = await launchDesktop();
  const recovered = await botSnapshot(botId);
  report.recoveredVerdict = recovered?.verdict ?? null;
  await openSessionFromBotsPage(botId);
  await waitForTerminalText(page, "CWD=");
  const afterRestart = await botSnapshot(botId);
  assert.equal(afterRestart?.verdict, "live", "the reopened session must be live");
  assert.notEqual(
    afterRestart?.sessionId,
    firstSession.sessionId,
    "a dead recorded session must be replaced, never focused",
  );
  assert.notEqual(
    afterRestart?.sessionId,
    pasteSession.sessionId,
    "the image-paste session is not the one being reopened",
  );
  assert.ok(
    /CWD=/.test(await terminalBufferText(page)),
    "the harness must boot after an app restart",
  );
  report.checks.push("p0-session-boots-after-app-restart");
  await shot("after-restart-bot-session-boots.png");

  // Stop the reopened session too, so teardown owns no orphan.
  const restartPid = afterRestart.processId;
  await page.getByTestId("bot-session-stop").click();
  const restartStopDeadline = Date.now() + 15000;
  let restartStopped = null;
  while (Date.now() < restartStopDeadline) {
    restartStopped = await botSnapshot(botId);
    if (restartStopped?.verdict === "exited") break;
    await delay(200);
  }
  assert.equal(restartStopped?.verdict, "exited", "Stop must work after the restart");
  if (Number.isInteger(restartPid)) {
    const restartGoneDeadline = Date.now() + 5000;
    while (alive(restartPid) && Date.now() < restartGoneDeadline) await delay(50);
    assert.equal(alive(restartPid), false, `Stop must kill pid ${restartPid}`);
  }
  report.checks.push("p1-stop-works-after-restart");
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close().catch(() => {});
    const tracked = [...ownedPids].filter((pid) => alive(pid));
    const victims = tracked.length > 0 ? await descendants(tracked) : [];
    await stopOwned(desktop, "desktop");
    await stopOwned(daemon, "daemon");
    await delay(500);
    const survivors = victims.filter((pid) => alive(pid));
    report.processes.survivors = survivors;
    if (survivors.length > 0) {
      process.exitCode = 1;
      await writeFile(
        path.join(output, "survivors.json"),
        `${JSON.stringify({ victims, survivors }, null, 2)}\n`,
      );
    }
    await rm(fixture, { recursive: true, force: true });
  } catch (cleanupError) {
    process.exitCode = 1;
    report.cleanupError =
      cleanupError instanceof Error ? (cleanupError.stack ?? cleanupError.message) : String(cleanupError);
  }
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
