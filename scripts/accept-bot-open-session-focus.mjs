// Focused CDP acceptance for the owner's duplicate-window report: with a Bot
// session ALREADY open, "Open session" on that Bot's card must take you to
// the session that is on screen -- not open another one.
//
//   "yo ya tengo una sesión abierta de este bot, termina abriendome otra
//    ventana [...] esto causa que tenga multiples ventanas apuntando a la
//    misma sesión [...] lo de abrir y resumir la sesión solo debería ocurrir
//    si no tengo ninguna sesión abierta"
//
// The regression's precondition is the latched provider conversation: the
// daemon latches `agentSessionId` onto the Bot record the moment the harness
// reports it (Claude Code's SessionStart hook), and the renderer's decision
// ranked that latched id ABOVE the live verdict -- so every click on a
// healthy Bot resolved to `reopen` and dispatched a NEW Drogon session that
// resumed the conversation already on screen. This acceptance latches the
// conversation exactly the way Claude Code does (the real
// `drogon-cli internal hook-event` callback), then clicks Open session
// repeatedly and asserts NOTHING is dispatched: no new session row in the
// Bot's own home, one tab, and that tab active.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE). The harness is a
// SHELL FIXTURE on PATH -- never real model inference, never the developer's
// running instance. Screenshots use viewport emulation only (no OS
// activation, no bringToFront).
//
// Usage: node scripts/accept-bot-open-session-focus.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");

const fixture = await mkdtemp(path.join(tmpdir(), "dbof-"));
const dataDir = path.join(fixture, "data");
const projectDir = path.join(fixture, "project");
const fixtureBin = path.join(fixture, "bin");
const claudeConfigDir = path.join(fixture, "claude-config");
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `bot-open-session-focus-${Date.now()}`,
);
for (const dir of [projectDir, fixtureBin, claudeConfigDir]) {
  await mkdir(dir, { recursive: true });
}
await mkdir(output, { recursive: true });

// The same `claude` stand-in the other bot-session acceptances use: a
// per-home conversation store, `--resume <id>` names an exact conversation,
// and every argv line is echoed so a surprise dispatch is provable from the
// pane as well as from the session list.
const claudeFixture = [
  "#!/bin/bash",
  'for arg in "$@"; do echo "ARG:$arg"; done',
  'resume_id=""; previous=""',
  'for arg in "$@"; do if [ "$previous" = "--resume" ]; then resume_id="$arg"; fi; previous="$arg"; done',
  'if [ -n "$resume_id" ]; then',
  '  echo "RESUMED:$resume_id"',
  '  if [ -f ".drogon-conversation-$resume_id" ]; then cat ".drogon-conversation-$resume_id"; else echo "NO-SUCH-CONVERSATION"; fi',
  "else",
  '  n=1; if [ -f .drogon-conv-seq ]; then n=$(( $(cat .drogon-conv-seq) + 1 )); fi; echo "$n" > .drogon-conv-seq',
  '  id="conv-$n"',
  '  echo "CONVERSATION-ID:$id"',
  '  echo "the first turn of $id" > ".drogon-conversation-$id"',
  '  cat ".drogon-conversation-$id"',
  "fi",
  "echo CONVERSATION-READY",
  "trap 'exit 0' TERM INT",
  'while IFS= read -r line; do echo "you said: $line"; done',
].join("\n");
await writeFile(path.join(fixtureBin, "claude"), `${claudeFixture}\n`, {
  mode: 0o755,
});

const daemonBin = path.join(root, "target", "debug", "drogond");
const cliBin = path.join(root, "target", "debug", "drogon-cli");

const report = {
  kind: "bot-open-session-focus-cdp",
  output,
  checks: [],
  screenshots: [],
  processes: { desktop: null, daemon: null, survivors: [] },
};

let browser = null;
let page = null;
let desktop = null;
let daemon = null;

const ownedPids = new Set();
const ownedSessions = [];

function ownPid(pid) {
  if (pid) ownedPids.add(pid);
}

async function allProcesses() {
  try {
    const { stdout } = await runAcceptanceProcess(
      "/bin/ps",
      ["-axo", "pid=,ppid=,command="],
      { timeout: 5000 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pid, ppid] = line.split(/\s+/, 2);
        return { pid: Number(pid), ppid: Number(ppid), command: line };
      });
  } catch {
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function descendants(roots) {
  const processes = await allProcesses();
  const byParent = new Map();
  for (const entry of processes) {
    const list = byParent.get(entry.ppid) ?? [];
    list.push(entry.pid);
    byParent.set(entry.ppid, list);
  }
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of byParent.get(pid) ?? []) queue.push(child);
  }
  return [...seen].filter((pid) => !roots.includes(pid));
}

async function stopOwned(child, label) {
  if (!child) return;
  report.processes[label] = "exited";
  await stopAcceptanceProcess(child).catch((error) => {
    report.processes[label] = `stop failed: ${error.message}`;
  });
}

async function waitForDaemon() {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(
        cliBin,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 1000 },
      );
      const envelope = JSON.parse(response.stdout);
      assert.equal(envelope.ok, true);
      return envelope.result;
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
      CLAUDE_CONFIG_DIR: claudeConfigDir,
    },
  });
  ownPid(child.pid);
  const status = await waitForDaemon();
  return { child, status };
}

async function launchDesktop() {
  desktop = startAcceptanceProcess(
    electron,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        DROGON_BACKGROUND_WINDOW: "1",
        PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
      },
    },
  );
  ownPid(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no debugging endpoint; stderr: ${tail}`)),
      20000,
    );
    desktop.once("exit", () =>
      reject(new Error(`electron exited before connecting: ${tail}`)),
    );
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
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) {
    await delay(50);
  }
  page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  assert.ok(page, "electron must create a rendered page");
  page.setDefaultTimeout(20000);
  // No `bot.run` spy: the preload exposes a FROZEN bridge
  // (`contextBridge.exposeInMainWorld("drogon", Object.freeze(bridge))`), so
  // a renderer-side wrapper can never attach. The dispatch is observed
  // instead where it is real and unfakeable -- the daemon's own session list
  // (a dispatch always lands a row), the tab strip, and the pane's buffer.
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  return desktop;
}

/** Screenshots light AND dark at 1440 and 760 px, viewport emulation only --
 *  the window stays in the background and is never activated. */
async function shot4(name) {
  for (const [width, scheme] of [
    [1440, "dark"],
    [1440, "light"],
    [760, "dark"],
    [760, "light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await delay(400);
    const file = `${name}-${width}-${scheme}.png`;
    await page.screenshot({
      path: path.join(output, file),
      animations: "disabled",
    });
    report.screenshots.push(file);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
}

async function sessions() {
  // The desktop's IPC framing occasionally mis-parses a response under burst
  // (several polls answering together) — a pre-existing transport fragility
  // outside this finding's scope. Ride it out with a bounded retry.
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await page.evaluate(async () => {
        const response = await window.drogon.sessions(undefined);
        if (!response.ok) throw new Error(response.error.message);
        return response.result.sessions;
      });
    } catch (error) {
      lastError = error;
      await delay(400);
    }
  }
  throw lastError;
}

async function waitForHostSession(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      last = await sessions();
      const found = last.find(predicate);
      if (found) return found;
    } catch {
      // Reconnect polls are expected to fail transiently.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for ${label}: ${JSON.stringify(last)}`,
      );
    }
    await delay(100);
  }
}

async function botSnapshotBot(botId) {
  return page.evaluate(async (id) => {
    const status = await window.drogon.status();
    const snapshot = await window.drogon.botSnapshot({
      workspaceId: "",
      hostId: status.result.hostId,
      locale: "en-US",
    });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    return snapshot.result.bots.find((entry) => entry.id === id) ?? null;
  }, botId);
}

async function waitForBotSnapshot(botId, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await botSnapshotBot(botId).catch(() => null);
    if (last && predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for ${label}: ${JSON.stringify(last)}`,
      );
    }
    await delay(150);
  }
}

/** The real hook callback (`drogon-cli internal hook-event`), exactly the way
 *  Claude Code reports its own conversation — no product code is bypassed.
 *  This is what latches `agentSessionId` onto the Bot record, which is the
 *  precondition of the duplicate this acceptance guards. */
async function reportHookEvent(session, event, payload) {
  const child = startAcceptanceProcess(
    cliBin,
    [
      "--data-dir",
      dataDir,
      "internal",
      "hook-event",
      "--session",
      session.id,
      "--incarnation",
      session.incarnation,
      "--event",
      event,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.end(`${JSON.stringify(payload)}\n`);
  let text = "";
  child.stdout.on("data", (bytes) => {
    text += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    text += bytes.toString();
  });
  const exit = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(
    exit,
    0,
    `hook-event ${event} must succeed (exit ${exit}): ${text}`,
  );
}

async function stopTrackedSessions() {
  for (const session of [...ownedSessions]) {
    await page
      .evaluate(
        async ({ sessionId, incarnation }) =>
          window.drogon.stop({ sessionId, incarnation }),
        { sessionId: session.id, incarnation: session.incarnation },
      )
      .catch(() => {});
  }
  ownedSessions.length = 0;
}

/** A Bot's own scope comes from the app's selected host+workspace, so the
 *  Bots page needs one real project registered before "New Bot" can land. */
async function addProject(projectPath) {
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Add Project", exact: true })
    .click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(projectPath);
  await addDialog
    .getByRole("button", { name: "Add Project", exact: true })
    .click();
  await addDialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: /^Select / })
    .first()
    .waitFor();
}

async function gotoBotsPage() {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await page.locator('[data-testid="bots-panel"]').waitFor();
}

function botCard(botName) {
  return page.locator('[data-slot="card"][data-testid^="bot-"]', {
    hasText: botName,
  });
}

async function createBot(botName) {
  await gotoBotsPage();
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.getByRole("button", { name: "New Bot", exact: true }).click();
  const form = page.getByRole("form", { name: "Create a Bot" });
  await form.waitFor();
  await form.getByLabel("Name (optional)").fill(botName);
  await form.getByLabel("Purpose").fill("Acceptance focus probe bot.");
  await form.getByText(/^Advanced · /).click();
  await form.getByLabel("Agent", { exact: true }).selectOption("claude");
  await form.getByRole("button", { name: "Create Bot", exact: true }).click();
  const card = botCard(botName);
  await card.waitFor();
  const testId = await card.getAttribute("data-testid");
  const botId = testId.startsWith("bot-") ? testId.slice(4) : null;
  assert.ok(botId, `bot card must carry bot-<id>, got ${testId}`);
  return { card, botId };
}

/** Reveal the card's Open session control (a bare Bot renders collapsed).
 *  The card re-mounts on snapshot reloads, so the expand click is retried. */
async function revealOpenSession(botId) {
  const openSession = page.getByTestId(`open-session-${botId}`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await openSession.isVisible().catch(() => false)) {
      await openSession.waitFor();
      return openSession;
    }
    const expand = page.getByTestId(`bot-expand-${botId}`).first();
    if (await expand.isVisible().catch(() => false)) {
      await expand.click().catch(() => {});
      await delay(400);
    } else {
      await delay(500);
    }
  }
  await openSession.waitFor();
  return openSession;
}

async function openBotSessionFromPage(botId) {
  await gotoBotsPage();
  const openSession = await revealOpenSession(botId);
  await openSession.click();
}

/** The tab strip's own facts: every open tab, and which one is active. The
 *  owner's screenshot IS this list — four tabs on one conversation. */
async function tabStrip() {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-tab-id]")].map((node) => ({
      id: node.getAttribute("data-tab-id"),
      active: node.getAttribute("data-active") === "true",
    })),
  );
}

/**
 * One "Open session" click on a Bot whose session is LIVE: it must take the
 * owner to the session already on screen and dispatch nothing.
 *
 * `click` performs the surface's own interaction; everything else is the
 * assertion. The settle window is what makes a negative provable: a dispatch
 * lands a new session row within it (the duplicate this guards took well
 * under a second).
 */
async function assertFocusOnly({
  label,
  botId,
  sessionId,
  workspaceId,
  click,
}) {
  const before = await sessions();
  const beforeIds = new Set(before.map((item) => item.id));
  await click();
  // The focus leaves the Bots page and activates the existing tab.
  await page.locator("#active-session-panel").waitFor();
  await delay(3000);
  const after = await sessions();
  const fresh = after.filter((item) => !beforeIds.has(item.id));
  const inBotHome = after.filter((item) => item.workspaceId === workspaceId);
  const strip = await tabStrip();
  const alerts = await page
    .getByRole("alert")
    .allTextContents()
    .catch(() => []);
  const detail = {
    label,
    freshSessions: fresh.map((item) => item.id),
    sessionsInBotHome: inBotHome.map((item) => item.id),
    strip,
    alerts: alerts.map((text) => text.trim()).filter(Boolean),
  };
  report.focusChecks = report.focusChecks ?? [];
  report.focusChecks.push(detail);
  assert.deepEqual(
    fresh.map((item) => item.id),
    [],
    `${label}: a live Bot session must be FOCUSED, never duplicated: ${JSON.stringify(detail)}`,
  );
  // The Bot's own home is where its sessions run: one Bot, one session.
  assert.deepEqual(
    inBotHome.map((item) => item.id),
    [sessionId],
    `${label}: the Bot's home must hold exactly its ONE session: ${JSON.stringify(detail)}`,
  );
  // A focus that silently failed would refuse in the shared action alert
  // instead (the "could create a duplicate" dead end) — that is a bug too.
  assert.equal(
    detail.alerts.filter((text) => /could create a duplicate/.test(text))
      .length,
    0,
    `${label}: focusing a live session must never refuse: ${JSON.stringify(detail)}`,
  );
  assert.equal(
    strip.filter((tab) => tab.id === sessionId).length,
    1,
    `${label}: the Bot's session must hold exactly ONE tab: ${JSON.stringify(detail)}`,
  );
  assert.ok(
    strip.some((tab) => tab.id === sessionId && tab.active),
    `${label}: the click must land ON that session's tab: ${JSON.stringify(detail)}`,
  );
  const stillRecorded = await botSnapshotBot(botId);
  assert.equal(
    stillRecorded?.currentSession?.sessionId,
    sessionId,
    `${label}: the Bot record must still name the same session`,
  );
  return detail;
}

try {
  const started = await startDaemon();
  daemon = started.child;
  desktop = await launchDesktop();

  // ================================================================= journey 1
  // A Bot with ONE live session whose provider conversation the record has
  // latched — the exact state the owner's app was in.
  await addProject(projectDir);
  const probe = await createBot("Focus Probe Bot");
  await openBotSessionFromPage(probe.botId);
  const opened = await waitForBotSnapshot(
    probe.botId,
    (bot) => bot.currentSession?.verdict === "live",
    "the probe bot's first live session",
  );
  const sessionId = opened.currentSession.sessionId;
  const liveRow = await waitForHostSession(
    (item) => item.id === sessionId,
    "the opened session on the host list",
  );
  ownedSessions.push(liveRow);
  await page.locator("#active-session-panel").waitFor();
  await waitForTerminalText(page, "CONVERSATION-READY");
  const buffer = await terminalBufferText(page);
  const conversation = buffer.match(/CONVERSATION-ID:(conv-\d+)/)?.[1];
  assert.ok(conversation, `the fixture must mint a conversation: ${buffer}`);
  await reportHookEvent(liveRow, "SessionStart", {
    session_id: conversation,
    transcript_path: path.join(
      opened.home?.path ?? fixture,
      `.drogon-conversation-${conversation}`,
    ),
    hook_event_name: "SessionStart",
  });
  const latched = await waitForBotSnapshot(
    probe.botId,
    (bot) =>
      bot.currentSession?.sessionId === sessionId &&
      bot.currentSession?.agentSessionId === conversation &&
      bot.currentSession?.verdict === "live",
    "the latched provider conversation on a LIVE record",
  );
  report.journey1 = {
    sessionId,
    conversation,
    verdict: latched.currentSession.verdict,
    agentSessionId: latched.currentSession.agentSessionId,
  };
  report.checks.push("live-bot-session-with-a-latched-conversation");
  await shot4("open-session-live-with-latched-conversation");

  // ================================================================= journey 2
  // THE finding: clicking Open session again — three times, the way the
  // owner ended up with a strip of identical tabs — focuses and dispatches
  // nothing.
  for (let click = 1; click <= 3; click += 1) {
    await assertFocusOnly({
      label: `bots-page-open-session-click-${click}`,
      botId: probe.botId,
      sessionId,
      workspaceId: liveRow.workspaceId,
      click: () => openBotSessionFromPage(probe.botId),
    });
  }
  report.checks.push("repeated-open-session-clicks-focus-the-live-session");
  await shot4("open-session-repeated-clicks-focus");

  // ================================================================= journey 3
  // The sidebar Chats row shares the same host resolution, so it must reach
  // the same verdict — the surface the owner's screenshot also shows.
  await assertFocusOnly({
    label: "sidebar-chats-row",
    botId: probe.botId,
    sessionId,
    workspaceId: liveRow.workspaceId,
    click: async () => {
      const row = page
        .locator(`[data-bot-session-row="${probe.botId}"]`)
        .first();
      await row.waitFor();
      await row.click();
    },
  });
  report.checks.push("sidebar-chats-row-focuses-the-live-session");

  // The session that was focused all along is still the one running, with
  // its own conversation — a focus can never have restarted it.
  const finalBuffer = await terminalBufferText(page);
  assert.ok(
    finalBuffer.includes(`CONVERSATION-ID:${conversation}`),
    `the focused pane must still hold the original conversation: ${finalBuffer}`,
  );
  assert.ok(
    !finalBuffer.includes("RESUMED:"),
    `a focus must never relaunch the harness with a resume: ${finalBuffer}`,
  );
  report.checks.push("focused-pane-holds-the-original-conversation");
  await shot4("open-session-focus-keeps-one-conversation");

  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try {
    if (page && !page.isClosed()) await stopTrackedSessions().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    const tracked = [...ownedPids].filter((pid) => alive(pid));
    const victims = tracked.length > 0 ? await descendants(tracked) : [];
    await stopOwned(desktop, "desktop");
    await stopOwned(daemon, "daemon");
    await delay(500);
    const survivors = [...new Set(victims)].filter((pid) => alive(pid));
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
      cleanupError instanceof Error
        ? (cleanupError.stack ?? cleanupError.message)
        : String(cleanupError);
  }
  await writeFile(
    path.join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
