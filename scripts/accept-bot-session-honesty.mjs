// Focused CDP acceptance for the BOT SESSION HONESTY findings (adversarial
// report + coordinator's finding 6):
//
//   Finding 1 — a resume whose recorded conversation no longer exists must
//   never be presented as "--- session restored ---". The daemon verifies the
//   persisted transcript before claiming anything, declines to a fresh start,
//   and the pane says it started fresh.
//
//   Finding 3 — a Bot whose pinned home directory disappeared is not a dead
//   end: the daemon recreates the home, the session opens, and the receipt
//   says out loud what happened (the previous files in it are gone).
//
//   Finding 5 — the Bots page "Open session" button and the sidebar Chats row
//   racing in the same tick on an `unverifiable` Bot session resolve to ONE
//   dispatch (per-Bot guard), never two live sessions.
//
//   Finding 6 — a Bot record whose recorded session link the daemon
//   positively resolved to NOTHING (row forgotten by an explicit close, then
//   a daemon restart) must open a FRESH session with an honest notice —
//   never a refusal whose "refresh and retry in a moment" advice could never
//   succeed.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE). The harness is a
// SHELL FIXTURE on PATH — never real model inference, never the developer's
// running instance. Screenshots are taken light AND dark at 1440 and 760 px
// with viewport emulation only (no OS activation, no bringToFront).
//
// Usage: node scripts/accept-bot-session-honesty.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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

const fixture = await mkdtemp(path.join(tmpdir(), "dbsh-"));
const dataDir = path.join(fixture, "data");
const projectDir = path.join(fixture, "project");
const fixtureBin = path.join(fixture, "bin");
const claudeConfigDir = path.join(fixture, "claude-config");
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `bot-session-honesty-${Date.now()}`,
);
for (const dir of [projectDir, fixtureBin, claudeConfigDir]) {
  await mkdir(dir, { recursive: true });
}
await mkdir(output, { recursive: true });

// The same `claude` stand-in accept-session-resume-by-id.mjs uses: a per-home
// conversation store, `--resume <id>` names an exact conversation, and every
// argv/stdin line is echoed so the launch is provable from the pane.
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

const daemonBin = path.join(
  root,
  "target",
  "debug",
  "drogond",
);
const cliBin = path.join(root, "target", "debug", "drogon-cli");

const report = {
  kind: "bot-session-honesty-cdp",
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
    const { stdout } = await runAcceptanceProcess("/bin/ps", ["-axo", "pid=,ppid=,command="], {
      timeout: 5000,
    });
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

/** The owner's trigger: a hard SIGKILL of the daemon, then a restart over the
 *  same data dir. Returns once the daemon answers AND reports a new service
 *  instance id. */
async function restartDaemon(previousInstanceId) {
  daemon.kill("SIGKILL");
  const killed = await stopAcceptanceProcess(daemon).catch(() => ({
    verdict: "exited",
  }));
  daemon = null;
  assert.equal(killed.verdict, "exited", "the SIGKILLed daemon must be observed gone");
  const restarted = await startDaemon();
  daemon = restarted.child;
  const deadline = Date.now() + 30000;
  while (
    restarted.status.serviceInstanceId === previousInstanceId &&
    Date.now() < deadline
  ) {
    await delay(100);
  }
  assert.notEqual(
    restarted.status.serviceInstanceId,
    previousInstanceId,
    "the restarted daemon must be a NEW service instance",
  );
  return restarted.status.serviceInstanceId;
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
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
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
  // Dispatch provenance: wrap bot.run BEFORE the renderer's modules capture
  // the bridge reference (init script + one reload), so every dispatch logs
  // its calling stack and a surprise dispatch names its surface.
  await page.context().addInitScript(() => {
    const wrap = () => {
      const bridge = window.drogon;
      const original = bridge && bridge.botRun ? bridge.botRun.bind(bridge) : null;
      if (!original || bridge.__botRunWrapped) return;
      bridge.__botRunLog = [];
      bridge.botRun = (input) => {
        bridge.__botRunLog.push({
          botId: input && input.botId,
          requestId: input && input.requestId,
          resume: (input && input.resume) || null,
          at: new Date().toISOString(),
          stack: (new Error().stack || "")
            .split("\n")
            .slice(1, 7)
            .join(" | "),
        });
        return original(input);
      };
      bridge.__botRunWrapped = true;
    };
    wrap();
    window.addEventListener("load", wrap);
  });
  await page.reload().catch(() => {});
  await emulatePageFocus(page);
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  return desktop;
}

/** Screenshots light AND dark at 1440 and 760 px: the evidence matrix the
 *  findings are reviewed under. Viewport emulation only — the window stays
 *  in the background and is never activated. */
async function shot4(name) {
  for (const [width, scheme] of [
    [1440, "dark"],
    [1440, "light"],
    [760, "dark"],
    [760, "light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await delay(500);
    const file = `${name}-${width}-${scheme}.png`;
    await page.screenshot({
      path: path.join(output, file),
      animations: "disabled",
    });
    report.screenshots.push(file);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

async function sessions() {
  // The desktop's IPC framing occasionally mis-parses a response under
  // burst (several polls answering together) — a pre-existing transport
  // fragility outside this finding's scope. Ride it out with a bounded
  // retry rather than failing the acceptance on it.
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
      // Reconnect polls are expected to fail while the daemon is down.
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
    }
    await delay(100);
  }
}

/** Wait for the renderer to hold the POST-restart truth: its bot snapshot
 *  refetches on a 4s app-global poll (and on Bots-route re-entry), so once
 *  the daemon answers again, one poll tick plus this beat is enough. A
 *  click against a stale snapshot focuses instead of dispatching (the safe
 *  direction), so the races below retry until the dispatch lands. */
const RENDERER_REFETCH_BEAT_MS = 6000;

async function addProject(projectPath) {
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(projectPath);
  await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
  await addDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^Select / }).first().waitFor();
}

async function workspaceIdFor(projectPath) {
  const leaf = path.basename(projectPath);
  return page.evaluate(
    async ({ target, base }) => {
      const response = await window.drogon.workspaces();
      if (!response.ok) throw new Error(response.error.message);
      const workspace = response.result.workspaces.find(
        (candidate) =>
          candidate.path === target || candidate.path?.endsWith(`/${base}`),
      );
      if (!workspace) throw new Error(`no workspace for ${target}`);
      return workspace.id;
    },
    { target: projectPath, base: leaf },
  );
}

async function writeTurn(session, text) {
  return page.evaluate(
    async ({ sessionId, incarnation, payload }) => {
      const response = await window.drogon.write({
        sessionId,
        incarnation,
        text: payload,
      });
      if (!response.ok) throw new Error(response.error.message);
      return response.result.acceptedBytes;
    },
    {
      sessionId: session.id,
      incarnation: session.incarnation,
      payload: text,
    },
  );
}

/** The real hook callback (`drogon-cli internal hook-event`), exactly the way
 *  Claude Code reports its own conversation — no product code is bypassed. */
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
  let output = "";
  child.stdout.on("data", (bytes) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    output += bytes.toString();
  });
  const exit = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(
    exit,
    0,
    `hook-event ${event} must succeed (exit ${exit}): ${output}`,
  );
}

async function closeSession(session) {
  const response = await page.evaluate(
    async ({ sessionId, incarnation }) =>
      window.drogon.close({ sessionId, incarnation }),
    { sessionId: session.id, incarnation: session.incarnation },
  );
  assert.equal(response.ok, true, JSON.stringify(response.error ?? {}));
  const index = ownedSessions.indexOf(session);
  if (index >= 0) ownedSessions.splice(index, 1);
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

/** The Bots page: opening a session navigates to the new tab, so every
 *  card interaction starts by (re)entering the route — the same click the
 *  owner makes. */
async function gotoBotsPage() {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await page.locator('[data-testid="bots-panel"]').waitFor();
}

function botCard(botName) {
  return page
    .locator('[data-slot="card"][data-testid^="bot-"]', { hasText: botName });
}

async function createBot(botName) {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.waitFor();
  await panel.getByRole("button", { name: "New Bot", exact: true }).click();
  const form = page.getByRole("form", { name: "Create a Bot" });
  await form.waitFor();
  await form.getByLabel("Name (optional)").fill(botName);
  await form.getByLabel("Purpose").fill("Acceptance honesty probe bot.");
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
 *  The card re-mounts on snapshot reloads, so the expand click is retried
 *  until the control is actually visible. */
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

async function waitForBotSnapshot(botId, predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await botSnapshotBot(botId);
    if (last && predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
    }
    await delay(150);
  }
}

try {
  const started = await startDaemon();
  daemon = started.child;
  let serviceInstanceId = started.status.serviceInstanceId;
  desktop = await launchDesktop();

  // ================================================================= journey 1
  // Finding 1: a resume whose recorded conversation no longer exists must
  // NOT be presented as a restoration.
  await addProject(projectDir);
  const workspaceId = await workspaceIdFor(projectDir);
  const launched = await page.evaluate(async (id) => {
    const response = await window.drogon.startHarness({
      workspaceId: id,
      harnessId: "claude",
      permissionMode: "inherit",
      requestId: `accept-honesty-${Date.now()}`,
    });
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  }, workspaceId);
  ownedSessions.push(launched);
  await page
    .locator(`[data-worktree-agent-row="${launched.id}"]`)
    .first()
    .click();
  await page.locator("#active-session-panel").waitFor();
  await waitForTerminalText(page, "CONVERSATION-READY");
  const buffer = await terminalBufferText(page);
  const conversation = buffer.match(/CONVERSATION-ID:(conv-\d+)/)?.[1];
  assert.ok(conversation, `the fixture must mint a conversation: ${buffer}`);
  await writeTurn(launched, "hello-from-the-first-session\n");
  await waitForTerminalText(page, "you said: hello-from-the-first-session");
  report.checks.push("first-session-exchanged-a-real-turn");

  // The harness's own hook reports the conversation AND the transcript the
  // daemon will later verify against.
  const transcriptPath = path.join(
    projectDir,
    `.drogon-conversation-${conversation}`,
  );
  await reportHookEvent(launched, "SessionStart", {
    session_id: conversation,
    transcript_path: transcriptPath,
    hook_event_name: "SessionStart",
  });
  await waitForHostSession(
    (item) => item.id === launched.id && item.agentSessionId === conversation,
    "the provider conversation on the session row",
  );
  assert.ok((await stat(transcriptPath)).isFile(), "the transcript must exist");

  // The owner's trigger: a hard daemon restart, then the recorded
  // conversation is deleted underneath.
  serviceInstanceId = await restartDaemon(serviceInstanceId);
  const recovered = await waitForHostSession(
    (item) => item.id === launched.id && item.verdict === "unverifiable",
    "the recovered unverifiable session",
  );
  assert.equal(recovered.agentSessionId, conversation);
  await rm(transcriptPath);
  assert.ok(
    !(await stat(transcriptPath).catch(() => null)),
    "the recorded conversation must be gone",
  );

  // The pane offers resume; taking it must NOT claim a restoration.
  await page
    .locator(`[data-worktree-agent-row="${launched.id}"]`)
    .first()
    .click();
  const panel = page.locator("#active-session-panel");
  const sleepingAlert = panel
    .getByRole("alert")
    .filter({ hasText: "This session is sleeping" });
  await sleepingAlert.waitFor();
  const resumeButton = sleepingAlert.getByRole("button", {
    name: "Resume session",
    exact: true,
  });
  await resumeButton.waitFor();
  await resumeButton.click();
  await waitForTerminalText(page, "CONVERSATION-READY", { timeout: 20000 });
  // Track the replacement session for teardown: the declined resume starts
  // a NEW session, and every process this acceptance starts must be reaped.
  const replacement = await waitForHostSession(
    (item) => item.verdict === "live" && item.id !== launched.id,
    "the fresh replacement session",
  );
  ownedSessions.push(replacement);

  // THE assertion: no restored banner may stand anywhere in the pane.
  const restoredBanners = page.locator(
    '[data-session-restored-banner="restored"]',
  );
  assert.equal(
    await restoredBanners.count(),
    0,
    "a resume whose conversation is gone must never claim a restoration",
  );
  await delay(1000);
  assert.equal(
    await restoredBanners.count(),
    0,
    "the restored claim must not appear late either",
  );
  // The honest banner: it started fresh.
  const freshBanner = page.locator(
    '[data-session-restored-banner="resume-unavailable"]',
  );
  await freshBanner.waitFor();
  assert.match(
    ((await freshBanner.textContent()) ?? "").trim(),
    /previous session unavailable, started fresh/,
    "the pane must say plainly that it started fresh",
  );
  const freshText = await terminalBufferText(page);
  assert.ok(
    !freshText.includes("ARG:--resume") && !freshText.includes("RESUMED:"),
    `a declined resume must not carry resume argv: ${freshText}`,
  );
  assert.ok(
    !freshText.includes(`the first turn of ${conversation}`),
    "the deleted conversation must not come back",
  );
  const newConversation = freshText.match(/CONVERSATION-ID:(conv-\d+)/)?.[1];
  assert.ok(
    newConversation && newConversation !== conversation,
    `a fresh start must mint its own conversation: ${freshText}`,
  );
  report.finding1 = { previous: conversation, fresh: newConversation };
  report.checks.push("failed-resume-never-claims-restoration");
  await shot4("f1-failed-resume-never-claims-restoration");

  // ================================================================= journey 2
  // Finding 3: a missing Bot home is recreated, the session opens, and the
  // receipt says out loud what happened.
  const homeBotName = "Home Probe Bot";
  const homeBot = await createBot(homeBotName);
  await openBotSessionFromPage(homeBot.botId);
  const provisioned = await waitForBotSnapshot(
    homeBot.botId,
    (bot) => bot.currentSession?.verdict === "live" && bot.home?.path,
    "the first home-probe session",
  );
  const homePath = provisioned.home.path;
  assert.ok(
    (await stat(path.join(homePath, "AGENTS.md"))).isFile(),
    "the first open must provision the identity files",
  );
  // Stop the session, then delete the home underneath (the owner's state).
  const firstSession = {
    sessionId: provisioned.currentSession.sessionId,
    incarnation: provisioned.currentSession.incarnation,
  };
  await page.evaluate(async ({ sessionId, incarnation }) => {
    const response = await window.drogon.stop({ sessionId, incarnation });
    if (!response.ok) throw new Error(response.error.message);
  }, firstSession);
  ownedSessions.length = 0;
  await rm(homePath, { recursive: true, force: true });

  await openBotSessionFromPage(homeBot.botId);
  const recreated = await waitForBotSnapshot(
    homeBot.botId,
    (bot) =>
      bot.currentSession?.verdict === "live" &&
      bot.currentSession.sessionId !== firstSession.sessionId,
    "the recreated-home session",
  );
  const recreatedSessionId = recreated.currentSession.sessionId;
  // The honest notice: the home was missing and was recreated.
  const homeToast = page.getByText(
    "The Bot's home directory was missing and Drogon recreated it. Previous files in it are gone.",
  );
  await homeToast.first().waitFor({ timeout: 15000 });
  assert.ok(
    (await stat(path.join(homePath, "AGENTS.md"))).isFile() &&
      (await stat(path.join(homePath, "CLAUDE.md"))).isFile(),
    "the identity files must be rewritten in the recreated home",
  );
  report.finding3 = { homePath };
  report.checks.push("missing-home-recreated-with-honest-notice");
  await shot4("f3-missing-home-recreated-with-honest-notice");

  // ================================================================= journey 3
  // Finding 5: the Bots page and the sidebar Chats row racing in the same
  // tick on an `unverifiable` Bot session resolve to ONE session.
  serviceInstanceId = await restartDaemon(serviceInstanceId);
  await waitForHostSession(
    (item) =>
      item.id === recreatedSessionId && item.verdict === "unverifiable",
    "the race bot's unverifiable recorded session",
    30000,
  );
  await waitForBotSnapshot(
    homeBot.botId,
    (bot) =>
      bot.currentSession?.sessionId === recreatedSessionId &&
      bot.currentSession?.verdict === "unverifiable",
    "the race bot's post-restart snapshot",
    30000,
  );
  await waitForBotSnapshot(
    homeBot.botId,
    (bot) => bot.currentSession?.verdict === "unverifiable",
    "the race bot's post-restart snapshot",
    30000,
  );
  // Give the renderer's own reconnect refetch its beat, then surface both
  // controls.
  await delay(RENDERER_REFETCH_BEAT_MS);
  await gotoBotsPage();
  await revealOpenSession(homeBot.botId);
  await page
    .locator(`[data-bot-session-row="${homeBot.botId}"]`)
    .first()
    .waitFor();

  // The race: both surfaces clicked in the SAME tick. A click against a
  // stale snapshot focuses instead of dispatching (the safe direction), so
  // the race is retried until it lands; the count is then asserted ONCE.
  let racedNew = [];
  for (let attempt = 0; attempt < 4 && racedNew.length === 0; attempt += 1) {
    const sessionIdsBefore = new Set((await sessions()).map((item) => item.id));
    await page.evaluate((botId) => {
      document
        .querySelector(`[data-testid="open-session-${CSS.escape(botId)}"]`)
        ?.click();
      document
        .querySelector(`[data-bot-session-row="${CSS.escape(botId)}"]`)
        ?.click();
    }, homeBot.botId);
    const raceDeadline = Date.now() + 15000;
    for (;;) {
      const now = await sessions();
      racedNew = now.filter((item) => !sessionIdsBefore.has(item.id));
      if (racedNew.length >= 1) {
        // Settle: any duplicate would appear in this window.
        await delay(2500);
        racedNew = (await sessions()).filter(
          (item) => !sessionIdsBefore.has(item.id),
        );
        break;
      }
      if (Date.now() >= raceDeadline) break;
      await delay(200);
    }
    if (racedNew.length === 0) await delay(RENDERER_REFETCH_BEAT_MS);
  }
  assert.equal(
    racedNew.length,
    1,
    `a two-surface race for the same Bot must open ONE session, got ${racedNew.length}`,
  );
  ownedSessions.push(racedNew[0]);
  report.finding5 = { newSessions: racedNew.length };
  report.checks.push("two-surface-race-opens-one-session");
  await shot4("f5-two-surface-race-opens-one-session");

  // ================================================================= journey 4
  // Finding 6: a recorded link the daemon positively resolved to NOTHING
  // (explicit close forgets the row; then a daemon restart) opens a FRESH
  // session with an honest notice — never the dead-end refusal.
  const phantomBotName = "Phantom Probe Bot";
  const phantomBot = await createBot(phantomBotName);
  await openBotSessionFromPage(phantomBot.botId);
  const phantomLive = await waitForBotSnapshot(
    phantomBot.botId,
    (bot) => bot.currentSession?.verdict === "live",
    "the phantom bot's first live session",
  );
  await closeSession({
    id: phantomLive.currentSession.sessionId,
    incarnation: phantomLive.currentSession.incarnation,
  });
  // The daemon-side fact is already true the moment the row is forgotten;
  // the owner's restart then makes it the ONLY truth available.
  await waitForBotSnapshot(
    phantomBot.botId,
    (bot) =>
      bot.currentSession?.sessionId === phantomLive.currentSession.sessionId &&
      bot.currentSession?.recordedSessionMissing === true,
    "the daemon's positive recordedSessionMissing fact",
  );
  serviceInstanceId = await restartDaemon(serviceInstanceId);
  // One renderer refetch beat after the daemon answers again, so the click
  // below lands on the POST-restart snapshot.
  await delay(RENDERER_REFETCH_BEAT_MS);
  report.debugHostAfterPhantomRestart = (await sessions()).map((item) => ({
    id: item.id.slice(0, 8),
    ws: item.workspaceId.slice(0, 8),
    verdict: item.verdict,
  }));
  report.debugPhantomSnapshotAtClick = await botSnapshotBot(phantomBot.botId);

  // A stale-snapshot click focuses (no dispatch) — safe — so the open is
  // retried until exactly ONE fresh session appears. The dead-end refusal
  // fails the moment it shows: that IS the bug. Toast texts are captured
  // continuously so the honest notice is provable even if it expires
  // before the explicit wait below.
  const openedFresh = [];
  const toastsSeen = new Set();
  let noticeText = null;
  for (let attempt = 0; attempt < 4 && openedFresh.length === 0; attempt += 1) {
    const before = new Set((await sessions()).map((item) => item.id));
    await openBotSessionFromPage(phantomBot.botId);
    const deadline = Date.now() + 15000;
    for (;;) {
      for (const text of await page
        .locator("[data-sonner-toast]")
        .allTextContents()
        .catch(() => [])) {
        if (text.trim()) toastsSeen.add(text.trim());
      }
      const now = await sessions();
      const fresh = now.filter((item) => !before.has(item.id));
      if (fresh.length >= 1) {
        await delay(1500);
        openedFresh.push(
          ...(await sessions()).filter((item) => !before.has(item.id)),
        );
        break;
      }
      assert.equal(
        await page
          .getByRole("alert")
          .filter({ hasText: "could create a duplicate" })
          .count(),
        0,
        "the dead-end refusal must never appear for a resolved phantom",
      );
      if (Date.now() >= deadline) break;
      await delay(200);
    }
    if (openedFresh.length === 0) await delay(RENDERER_REFETCH_BEAT_MS);
  }
  assert.equal(
    openedFresh.length,
    1,
    `the phantom open must open exactly one fresh session, got ${openedFresh.length}`,
  );
  ownedSessions.push(openedFresh[0]);
  report.debugToastsSeen = [...toastsSeen];
  // The honest telling, in whichever durable form the resolution took: the
  // phantom path toasts "the previous session is gone · Starting a new
  // conversation"; a reopen path (a stale observed row may legitimately
  // shadow the phantom for a poll cycle) lands the pane's own honest
  // "--- previous session unavailable, started fresh ---" banner. What may
  // NEVER appear is the dead-end refusal (asserted inside the loop) — that
  // is the finding.
  const freshPaneBanner = page.locator(
    '[data-session-restored-banner="resume-unavailable"]',
  );
  const phantomToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "previous session is gone" });
  const honestDeadline = Date.now() + 15000;
  let honestVia = null;
  while (Date.now() < honestDeadline && !honestVia) {
    if ((await phantomToast.count()) > 0) {
      honestVia = "toast";
      break;
    }
    if ((await freshPaneBanner.count()) > 0) {
      honestVia = "pane-banner";
      break;
    }
    await delay(250);
  }
  if (!honestVia) {
    report.debugPhantomDom = await page.evaluate(() => ({
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map(
        (node) => node.textContent,
      ),
      alerts: [...document.querySelectorAll("[role=alert]")].map(
        (node) => node.textContent,
      ),
      banners: [...document.querySelectorAll("[data-session-restored-banner]")].map(
        (node) => node.getAttribute("data-session-restored-banner"),
      ),
      toasterMounted: document.querySelector("[data-sonner-toaster]") !== null,
    }));
  }
  assert.ok(
    honestVia,
    "the phantom open must say honestly what happened (the gone-session " +
      "notice, or the pane's started-fresh banner)",
  );
  if (honestVia === "toast") {
    noticeText = ((await phantomToast.first().textContent()) ?? "").trim();
    assert.match(noticeText, /Starting a new conversation/);
    assert.doesNotMatch(
      noticeText.toLowerCase(),
      /refresh and retry/,
      "the notice must never print advice that cannot work",
    );
  } else {
    noticeText =
      ((await freshPaneBanner.first().textContent()) ?? "").trim();
    assert.match(noticeText, /started fresh/);
  }
  // The record rotated to the fresh session.
  await waitForBotSnapshot(
    phantomBot.botId,
    (bot) =>
      bot.currentSession?.verdict === "live" &&
      bot.currentSession.sessionId === openedFresh[0].id,
    "the rotated record after the phantom open",
  );
  report.debugToastsSeenFinal = [...toastsSeen];
  report.finding6 = { notice: noticeText, newSessions: openedFresh.length };
  report.checks.push("phantom-recorded-link-opens-fresh-with-honest-notice");
  await shot4("f6-phantom-link-opens-fresh-with-honest-notice");

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
