// Focused CDP acceptance for SESSION RESUME BY IDENTITY (owner directive:
// "Drogon guarda el session ID de Claude cuando se inicie, y cuando le doy
// Resume Session, use el CLI de Claude para abrirme la misma sesión en la que
// estaba trabajando").
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE). The harness is a
// SHELL FIXTURE on PATH (never real model inference, never the developer's
// running instance): it keeps a per-home conversation store and can be pointed
// at one conversation by id exactly like `claude --resume <session-id>`, which
// is how "the SAME conversation came back" is asserted on CONTENT.
//
// Journeys:
//   A. an ordinary workspace session: start → exchange a REAL turn → report the
//      provider conversation the way Claude's own hook does (the real
//      `drogon-cli internal hook-event` callback with its JSON payload on
//      stdin) → SIGKILL the daemon → restart over the same data dir → select
//      the recovered session → the pane says it is SLEEPING and offers
//      "Resume session" → resuming lands `--resume <that id>` and the prior
//      conversation's content, with the "session restored" banner.
//   B. a Bot session: the same, plus the Bot-record latch. After the daemon
//      restart the Drogon session row is REMOVED (an explicit close), so the
//      only place the conversation identity survives is the Bot record — and
//      the Bot's Open Session must still resume it instead of refusing with
//      "the daemon has not reported whether this Bot's session is still
//      running".
//
// Usage: node scripts/accept-session-resume-by-id.mjs
import assert from "node:assert/strict";
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

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");

const fixture = await mkdtemp(path.join(tmpdir(), "dsri-"));
const dataDir = path.join(fixture, "data");
const projectDir = path.join(fixture, "project");
const botProjectDir = path.join(fixture, "bot-project");
const fixtureBin = path.join(fixture, "bin");
const claudeConfigDir = path.join(fixture, "claude-config");
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `session-resume-by-id-${Date.now()}`,
);
for (const dir of [projectDir, botProjectDir, fixtureBin, claudeConfigDir]) {
  await mkdir(dir, { recursive: true });
}
await mkdir(output, { recursive: true });

// A `claude` stand-in with a per-home conversation store:
//   * fresh start: mint the next conversation id for this directory, write its
//     first turn, and print both (the acceptance reads the id off the pane);
//   * `--resume <id>`: print the conversation stored for THAT id, or
//     NO-SUCH-CONVERSATION — so "the same conversation came back" is asserted
//     on content, and naming the wrong id fails loudly.
// It echoes every argv entry, which is how the daemon's own resume argv is
// proven, and every stdin line, which is how a turn round-trip is proven.
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
  process.platform === "win32" ? "drogond.exe" : "drogond",
);
const cliBin = path.join(
  root,
  "target",
  "debug",
  process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
);

const report = {
  kind: "session-resume-by-id-cdp",
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
const ownedSessions = [];

function ownPid(pid) {
  if (pid) ownedPids.add(pid);
}

async function allProcesses() {
  const { stdout } = await runAcceptanceProcess("ps", ["-Ao", "pid=,ppid="], {
    timeout: 5000,
  });
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
  // Own the process BEFORE waiting for the endpoint: a desktop that never
  // reports one (a missing renderer build, say) must still be torn down by
  // the finally block, never leaked.
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
  const child = desktop;
  ownPid(child.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no debugging endpoint; stderr: ${tail}`)),
      20000,
    );
    child.once("exit", () =>
      reject(new Error(`electron exited before connecting: ${tail}`)),
    );
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
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) {
    await delay(50);
  }
  page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  assert.ok(page, "electron must create a rendered page");
  page.setDefaultTimeout(20000);
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  return child;
}

async function shot(name) {
  await page.screenshot({
    path: path.join(output, name),
    animations: "disabled",
  });
  report.screenshots.push(name);
}

async function sessions(workspaceId) {
  return page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
}

async function hostSessions() {
  return sessions(undefined);
}

async function waitForSession(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      last = await hostSessions();
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

async function addProject(projectPath) {
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(projectPath);
  await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
  // The composer closes and the project lands in the sidebar as a row with a
  // "Select <name>" control; reading `workspaces()` before that is a race.
  await addDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^Select / }).first().waitFor();
}

async function workspaceFor(projectPath) {
  const leaf = path.basename(projectPath);
  return page.evaluate(
    async ({ target, base }) => {
      const response = await window.drogon.workspaces();
      if (!response.ok) throw new Error(response.error.message);
      const workspace = response.result.workspaces.find(
        (candidate) =>
          candidate.path === target || candidate.path?.endsWith(`/${base}`),
      );
      if (!workspace) {
        throw new Error(
          `no workspace for ${target}: ${JSON.stringify(response.result.workspaces)}`,
        );
      }
      return workspace;
    },
    { target: projectPath, base: leaf },
  );
}

/** Launch a harness session through the app's own bridge, then select its
 *  sidebar row so the real pane renders (the sidebar row is how a session
 *  without a tab is opened, exactly like the owner clicking it). */
async function openHarnessSession(workspaceId, sessionId) {
  if (sessionId) {
    const row = page.locator(`[data-worktree-agent-row="${sessionId}"]`).first();
    await row.waitFor();
    await row.click();
  }
  await page.locator("#active-session-panel").waitFor();
}

async function startHarnessSession(workspaceId) {
  return page.evaluate(async (id) => {
    const response = await window.drogon.startHarness({
      workspaceId: id,
      harnessId: "claude",
      permissionMode: "inherit",
      requestId: `accept-resume-${Date.now()}-${Math.random()}`,
    });
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  }, workspaceId);
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

/** The real hook callback: `drogon-cli internal hook-event` with the harness's
 *  own JSON payload on stdin (Claude Code delivers `session_id` and
 *  `transcript_path` exactly this way). No product code is bypassed — this is
 *  the documented callback the harness itself invokes. */
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

/** Everything a failure needs to be diagnosable from the report alone. */
async function captureDiagnostics(label) {
  if (!page || page.isClosed()) return;
  try {
    report.diagnostics = report.diagnostics ?? {};
    report.diagnostics[label] = {
      sessions: await hostSessions().catch((error) => String(error)),
      paneText: (await terminalBufferText(page)).slice(-4000),
      alerts: await page
        .locator('[role="alert"]')
        .allTextContents()
        .catch(() => []),
      openSessionTestIds: await page
        .locator('[data-testid^="open-session-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))
        .catch(() => []),
      botsPanelText: (
        await page
          .locator('[data-testid="bots-panel"]')
          .textContent()
          .catch(() => "")
      )?.slice(0, 800),
    };
  } catch (error) {
    report.diagnostics = { captureError: String(error) };
  }
}

async function conversationIdFromPane() {
  const text = await terminalBufferText(page);
  const match = text.match(/CONVERSATION-ID:(conv-\d+)/);
  assert.ok(match, `the harness must report its conversation id: ${text}`);
  return match[1];
}

/** The session's own accumulated PTY output, read through the app's bridge.
 *  Stronger and more deterministic than DOM text: it is the daemon's retained
 *  output for THAT session, so a neighbouring pane can never satisfy an
 *  assertion on its behalf. */
async function sessionOutput(session) {
  return page.evaluate(
    async ({ sessionId, incarnation }) => {
      const response = await window.drogon.read({
        sessionId,
        incarnation,
        cursor: 0,
        limitBytes: 65536,
      });
      if (!response.ok) throw new Error(response.error.message);
      return atob(response.result.dataBase64);
    },
    { sessionId: session.id, incarnation: session.incarnation },
  );
}

async function waitForSessionOutput(session, marker, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    try {
      last = await sessionOutput(session);
      if (last.includes(marker)) return last;
    } catch {
      // A transient read failure is not a verdict.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for ${marker} in session ${session.id}: ${last.slice(-2000)}`,
      );
    }
    await delay(150);
  }
}

async function closeSession(session) {
  const response = await page.evaluate(
    async ({ sessionId, incarnation }) =>
      window.drogon.close({ sessionId, incarnation }),
    { sessionId: session.id, incarnation: session.incarnation },
  );
  assert.equal(response.ok, true, JSON.stringify(response.error ?? {}));
  ownedSessions.splice(ownedSessions.indexOf(session), 1);
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

const BOT_NAME = "Resume Probe Bot";

async function createBot() {
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.waitFor();
  await panel.getByRole("button", { name: "New Bot", exact: true }).click();
  const form = page.getByRole("form", { name: "Create a Bot" });
  await form.waitFor();
  await form.getByLabel("Name (optional)").fill(BOT_NAME);
  await form.getByLabel("Purpose").fill("Acceptance probe bot.");
  await form.getByText(/^Advanced · /).click();
  await form.getByLabel("Agent", { exact: true }).selectOption("claude");
  await form.getByRole("button", { name: "Create Bot", exact: true }).click();
  const card = panel.locator('[data-slot="card"][data-testid^="bot-"]', {
    hasText: BOT_NAME,
  });
  await card.waitFor();
  const testId = await card.getAttribute("data-testid");
  const botId = testId.startsWith("bot-") ? testId.slice(4) : null;
  assert.ok(botId, `bot card must carry bot-<id>, got ${testId}`);
  return { card, botId };
}

/** Open a Bot's session from the Bots page. A Bot with nothing configured
 *  renders as the design's collapsed row (no Open session control), so the
 *  chevron is clicked first — the same two clicks the owner makes. */
async function openBotSession(botId) {
  const openSession = page.getByTestId(`open-session-${botId}`);
  if (!(await openSession.isVisible().catch(() => false))) {
    await page.getByTestId(`bot-expand-${botId}`).first().click();
  }
  await openSession.waitFor();
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

async function waitForBotSession(botId, predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await botSnapshotBot(botId);
    const current = last?.currentSession ?? null;
    if (current && predicate(current)) return current;
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

  // ---------------------------------------------------------------- journey A
  await addProject(projectDir);
  const workspace = await workspaceFor(projectDir);
  const launched = await startHarnessSession(workspace.id);
  ownedSessions.push(launched);
  assert.equal(
    launched.agentSessionId ?? null,
    null,
    "a fresh session has no provider conversation yet",
  );
  await openHarnessSession(workspace.id, launched.id);
  await waitForTerminalText(page, "CONVERSATION-READY");
  const workspaceConversation = await conversationIdFromPane();
  report.workspaceConversation = workspaceConversation;

  // A REAL turn through the PTY: the fixture echoes what it reads, so the
  // conversation demonstrably has content before the restart.
  await writeTurn(launched, "hello-from-the-first-session\n");
  await waitForTerminalText(page, "you said: hello-from-the-first-session");
  report.checks.push("ordinary-session-exchanged-a-real-turn");

  // The harness's own hook reports the provider conversation.
  const transcriptPath = path.join(
    projectDir,
    `.drogon-conversation-${workspaceConversation}`,
  );
  await reportHookEvent(launched, "SessionStart", {
    session_id: workspaceConversation,
    transcript_path: transcriptPath,
    hook_event_name: "SessionStart",
  });
  const captured = await waitForSession(
    (item) => item.id === launched.id && item.agentSessionId === workspaceConversation,
    "the provider conversation id on the session row",
  );
  report.capturedAgentSessionId = captured.agentSessionId;
  report.checks.push("provider-conversation-id-persisted-from-the-hook-payload");

  // ---- the owner's trigger: a hard daemon restart over the same data dir ----
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
    restarted.status.serviceInstanceId === serviceInstanceId &&
    Date.now() < deadline
  ) {
    await delay(100);
  }
  serviceInstanceId = restarted.status.serviceInstanceId;

  const recovered = await waitForSession(
    (item) => item.id === launched.id && item.verdict === "unverifiable",
    "the recovered unverifiable session",
  );
  assert.equal(
    recovered.agentSessionId,
    workspaceConversation,
    "the provider conversation id must survive the daemon restart",
  );
  report.recovered = {
    verdict: recovered.verdict,
    agentSessionId: recovered.agentSessionId,
  };
  report.checks.push("daemon-restart-keeps-the-recorded-conversation");

  // Wait for the renderer to settle on the recovered verdict before reading
  // the pane, so the assertion is about the rendered state, not a race.
  await page.waitForFunction(
    (id) => {
      const row = document.querySelector(
        `[data-worktree-agent-row="${CSS.escape(id)}"]`,
      );
      return Boolean(row);
    },
    launched.id,
    { timeout: 20000 },
  );
  await openHarnessSession(workspace.id, launched.id);

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
  await shot("01-workspace-session-sleeping-offer.png");
  report.checks.push("sleeping-session-offers-resume-not-a-blank-pane");

  await resumeButton.click();
  try {
    await waitForTerminalText(page, `RESUMED:${workspaceConversation}`, {
      timeout: 20000,
    });
  } catch (error) {
    await captureDiagnostics("workspace-resume");
    throw error;
  }
  await waitForTerminalText(page, `the first turn of ${workspaceConversation}`);
  const resumedText = await terminalBufferText(page);
  assert.ok(
    resumedText.includes("ARG:--resume") &&
      resumedText.includes(`ARG:${workspaceConversation}`),
    `the reopen must name the recorded conversation, not the most recent one: ${resumedText}`,
  );
  assert.ok(
    !resumedText.includes("NO-SUCH-CONVERSATION"),
    `the resumed conversation must exist: ${resumedText}`,
  );
  const restoredBanner = page.locator(
    '[data-session-restored-banner="restored"]',
  );
  await restoredBanner.waitFor();
  const bannerText = (await restoredBanner.textContent()) ?? "";
  assert.ok(
    bannerText.includes("--- session restored ---"),
    `a completed resume must say so: ${bannerText}`,
  );
  await shot("02-workspace-session-resumed.png");
  report.resumedText = resumedText
    .split("\n")
    .filter((line) => line.includes("RESUMED:") || line.includes("RESUME") || line.includes("ARG:"))
    .slice(0, 8);
  report.checks.push("resume-returns-the-same-conversation-content");
  report.checks.push("resume-raises-the-restored-banner");

  const replacement = await waitForSession(
    (item) => item.verdict === "live" && item.id !== launched.id,
    "the resumed live session",
  );
  ownedSessions.push(replacement);
  report.resumedSession = replacement.id;
  ownedSessions.splice(ownedSessions.indexOf(launched), 1);

  // ---------------------------------------------------------------- journey B
  // The Bot twin: the identity must survive the Drogon session row itself.
  await addProject(botProjectDir);
  const botWorkspace = await workspaceFor(botProjectDir);
  const { card, botId } = await createBot();
  report.botId = botId;
  await openBotSession(botId);
  const botSession = await waitForBotSession(
    botId,
    (current) => current.verdict === "live",
    "the live Bot session",
  );
  const botOutput = await waitForSessionOutput(
    { id: botSession.sessionId, incarnation: botSession.incarnation },
    "CONVERSATION-ID:",
  );
  const botMatch = botOutput.match(/CONVERSATION-ID:(conv-\d+)/);
  assert.ok(botMatch, `the Bot's harness must report its conversation id: ${botOutput}`);
  const botConversation = botMatch[1];
  report.botConversation = botConversation;
  ownedSessions.push({
    id: botSession.sessionId,
    incarnation: botSession.incarnation,
  });

  await writeTurn(
    { id: botSession.sessionId, incarnation: botSession.incarnation },
    "hello-from-the-bot-session\n",
  );
  await waitForSessionOutput(
    { id: botSession.sessionId, incarnation: botSession.incarnation },
    "you said: hello-from-the-bot-session",
  );
  report.checks.push("bot-session-exchanged-a-real-turn");

  await reportHookEvent(
    { id: botSession.sessionId, incarnation: botSession.incarnation },
    "SessionStart",
    {
      session_id: botConversation,
      transcript_path: path.join(
        botProjectDir,
        `.drogon-conversation-${botConversation}`,
      ),
      hook_event_name: "SessionStart",
    },
  );
  const latched = await waitForBotSession(
    botId,
    (current) => current.agentSessionId === botConversation,
    "the Bot record's latched conversation id",
  );
  assert.equal(latched.agentSessionId, botConversation);
  report.checks.push("bot-record-latches-the-harness-conversation");

  // Hard restart, then REMOVE the Drogon session row: from here on the Bot
  // record is the only place the conversation identity exists. This is the
  // dead end the owner hit -- and it must now be a real recovery.
  daemon.kill("SIGKILL");
  const botKilled = await stopAcceptanceProcess(daemon).catch(() => ({
    verdict: "exited",
  }));
  daemon = null;
  assert.equal(botKilled.verdict, "exited");
  const botRestarted = await startDaemon();
  daemon = botRestarted.child;
  serviceInstanceId = botRestarted.status.serviceInstanceId;

  const botRecovered = await waitForSession(
    (item) => item.id === botSession.sessionId && item.verdict === "unverifiable",
    "the recovered Bot session stub",
  );
  await closeSession({
    id: botRecovered.id,
    incarnation: botRecovered.incarnation,
  });
  const remaining = await hostSessions();
  assert.ok(
    !remaining.some((item) => item.id === botSession.sessionId),
    "the durable row must be gone, leaving the Bot record as the only source",
  );
  const withoutRow = await botSnapshotBot(botId);
  assert.equal(
    withoutRow?.currentSession?.agentSessionId,
    botConversation,
    "the Bot record must still carry the conversation id",
  );
  report.botRecordOnly = {
    verdict: withoutRow?.currentSession?.verdict ?? null,
    agentSessionId: withoutRow?.currentSession?.agentSessionId ?? null,
  };

  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await card.waitFor();
  await openBotSession(botId);
  // The reopen is a NEW Drogon session that resumes the OLD conversation.
  const botSessionAfter = await waitForBotSession(
    botId,
    (current) =>
      current.verdict === "live" && current.sessionId !== botSession.sessionId,
    "the reopened live Bot session",
  );
  let botResumedText = "";
  try {
    botResumedText = await waitForSessionOutput(
      { id: botSessionAfter.sessionId, incarnation: botSessionAfter.incarnation },
      `RESUMED:${botConversation}`,
    );
  } catch (error) {
    await captureDiagnostics("bot-reopen");
    throw error;
  }
  assert.ok(
    botResumedText.includes(`the first turn of ${botConversation}`),
    `the Bot's conversation CONTENT must come back: ${botResumedText}`,
  );
  assert.ok(
    !botResumedText.includes("NO-SUCH-CONVERSATION"),
    `the Bot's conversation must exist: ${botResumedText}`,
  );
  assert.ok(
    botResumedText.includes("ARG:--resume") &&
      botResumedText.includes(`ARG:${botConversation}`),
    `a Bot reopen must name the recorded conversation: ${botResumedText}`,
  );
  // And the user sees it: the sidebar's Chat row for that Bot focuses the
  // session and the pane renders the resumed output. (A Bot session lives in
  // the Bot's own home workspace, so it is reached through the Chats row, not
  // through the project's session rows.)
  const chatRow = page.locator("[data-bot-session-row]").first();
  try {
    await chatRow.waitFor({ timeout: 20000 });
    await chatRow.click();
    await waitForTerminalText(page, `RESUMED:${botConversation}`, {
      timeout: 20000,
    });
    report.botPaneRendered = true;
  } catch (error) {
    report.botPaneRendered = false;
    await captureDiagnostics("bot-pane-render");
    throw new Error(
      `the resumed Bot session must render its output in the pane: ${String(error)}`,
      { cause: error },
    );
  }
  await shot("03-bot-session-resumed-from-the-record.png");
  assert.notEqual(
    botSessionAfter.sessionId,
    botSession.sessionId,
    "the reopen is a new Drogon session that resumes the old conversation",
  );
  ownedSessions.push({
    id: botSessionAfter.sessionId,
    incarnation: botSessionAfter.incarnation,
  });
  report.checks.push("bot-record-alone-resumes-the-conversation");

  // ---------------------------------------------------------------- journey C
  // The honest fallback. A session whose provider conversation was never
  // reported (no hook payload) has no identity to name, and this fixture's
  // Claude store is empty -- so the daemon DECLINES the resume rather than
  // launching a CLI that would refuse to start. The pane must say it started
  // fresh; silence would read as a successful restore.
  const unrecorded = await startHarnessSession(botWorkspace.id);
  ownedSessions.push(unrecorded);
  const unrecordedOutput = await waitForSessionOutput(
    { id: unrecorded.id, incarnation: unrecorded.incarnation },
    "CONVERSATION-ID:",
  );
  assert.equal(
    unrecorded.agentSessionId ?? null,
    null,
    "this session deliberately reports no provider conversation",
  );

  daemon.kill("SIGKILL");
  const thirdKill = await stopAcceptanceProcess(daemon).catch(() => ({
    verdict: "exited",
  }));
  daemon = null;
  assert.equal(thirdKill.verdict, "exited");
  const thirdRestart = await startDaemon();
  daemon = thirdRestart.child;
  serviceInstanceId = thirdRestart.status.serviceInstanceId;
  const stale = await waitForSession(
    (item) => item.id === unrecorded.id && item.verdict === "unverifiable",
    "the recovered session with no recorded provider conversation",
  );
  assert.equal(stale.agentSessionId ?? null, null);
  await openHarnessSession(botWorkspace.id, unrecorded.id);
  const connSleeping = panel
    .getByRole("alert")
    .filter({ hasText: "This session is sleeping" });
  await connSleeping.waitFor();
  await connSleeping
    .getByRole("button", { name: "Resume session", exact: true })
    .click();
  const resumeUnavailable = page.locator(
    '[data-session-restored-banner="resume-unavailable"]',
  );
  try {
    await resumeUnavailable.waitFor({ timeout: 20000 });
  } catch (error) {
    await captureDiagnostics("honest-fallback");
    throw error;
  }
  const fallbackText = (await resumeUnavailable.textContent()) ?? "";
  assert.equal(
    fallbackText.trim(),
    "--- previous session unavailable, started fresh ---",
  );
  const restoredBannerAfterFallback = page.locator(
    '[data-session-restored-banner="restored"]',
  );
  assert.equal(
    await restoredBannerAfterFallback.count(),
    0,
    "a declined resume must never be presented as a restore",
  );
  const freshSession = await waitForSession(
    (item) => item.verdict === "live" && item.id !== unrecorded.id,
    "the freshly started replacement session",
  );
  ownedSessions.push(freshSession);
  const freshOutput = await waitForSessionOutput(freshSession, "CONVERSATION-READY");
  const freshConversation = freshOutput.match(/CONVERSATION-ID:(conv-\d+)/)?.[1];
  const previousConversation = unrecordedOutput.match(/CONVERSATION-ID:(conv-\d+)/)?.[1];
  assert.ok(
    freshConversation && freshConversation !== previousConversation,
    `a fresh start must mint its own conversation: ${freshConversation} vs ${previousConversation}`,
  );
  assert.ok(
    !freshOutput.includes("ARG:--resume") &&
      !freshOutput.includes("ARG:--continue") &&
      !freshOutput.includes("RESUMED:"),
    `a declined resume must start fresh, with no resume argv: ${freshOutput}`,
  );
  assert.ok(
    !freshOutput.includes("NO-SUCH-CONVERSATION"),
    `a declined resume must not point the CLI at a missing conversation: ${freshOutput}`,
  );
  await shot("04-declined-resume-says-started-fresh.png");
  report.fallbackBannerText = fallbackText.trim();
  report.checks.push("declined-resume-says-it-started-fresh");

  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  await captureDiagnostics("failure").catch(() => {});
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
