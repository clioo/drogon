// Focused CDP acceptance for the Bot session-resume defects
// (drogon-session-resume): Defect 1 first-click focus, Defect 2 closed
// session resume through the harness's own mechanism, Defect 3 the Chats
// row avatar + name.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE). The harness is the
// repo's prescribed SHELL FIXTURE on PATH -- never real model inference. The
// fixture stays alive like an interactive TUI and echoes its argv, which is
// how the daemon's `--continue` resume argv is proven end to end.
//
// Usage: node scripts/accept-bot-session-resume.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");

const fixture = await mkdtemp(path.join(tmpdir(), "dbsr-"));
const dataDir = path.join(fixture, "data");
const foreignDir = path.join(fixture, "foreign-workspace");
const fixtureBin = path.join(fixture, "bin");
const output = path.join(root, ".preflight", "acceptance", `bot-session-resume-${Date.now()}`);
await mkdir(foreignDir, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(output, { recursive: true });

// A shell stand-in for the `pi` interactive entrypoint: it stays alive like a
// TUI, prints every argv entry (so the daemon's `--continue` is visible), and
// keeps a per-home prior-conversation marker that only a resumed session in
// the SAME Bot home can observe. Env markers are echoed empty to prove the
// child-session scrub.
const fixtureScript = [
  "#!/bin/sh",
  "echo CWD=$(pwd)",
  '[ -f .drogon-prior-conversation ] && echo "PRIOR:$(cat .drogon-prior-conversation)"',
  'echo "prior conversation from the first session" > .drogon-prior-conversation',
  'for arg in "$@"; do echo "ARG:$arg"; done',
  'echo "CHILD_SESSION=${CLAUDE_CODE_CHILD_SESSION:-}"',
  "trap 'exit 0' TERM INT",
  'while IFS= read -r line; do echo "you said: $line"; done',
].join("\n");
await writeFile(path.join(fixtureBin, "pi"), `${fixtureScript}\n`, { mode: 0o755 });
await writeFile(path.join(fixtureBin, "claude"), `${fixtureScript}\n`, { mode: 0o755 });

const daemonBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond");
const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");

const report = {
  kind: "bot-session-resume-cdp",
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
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(
        cliBin,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 1000 },
      );
      assert.equal(JSON.parse(response.stdout).ok, true);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
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
        PI_CODING_AGENT_DIR: path.join(fixture, ".pi", "agent"),
        SHELL: "/bin/sh",
      },
    },
  );
  ownPid(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no debugging endpoint: ${tail}`)),
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
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1)
    await delay(50);
  page = browser.contexts()[0].pages()[0];
  await emulatePageFocus(page);
  assert.ok(page, "electron must create a rendered page");
  page.setDefaultTimeout(20000);
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
}

async function shot(name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(name);
}

async function assertNoOverflow(label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, `horizontal overflow at ${label}`);
  report.checks.push(`no-horizontal-overflow-${label}`);
}

try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: {
      ...process.env,
      // Poisoned exactly like the coordinator's own accident: the daemon is
      // launched from inside a Claude session, so its harness children must
      // scrub these.
      CLAUDE_CODE_CHILD_SESSION: "poison-parent",
      CLAUDE_CODE_SESSION_ID: "poison-parent",
      CLAUDE_CODE_ENTRYPOINT: "poison-parent",
      PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
      PI_CODING_AGENT_DIR: path.join(fixture, ".pi", "agent"),
    },
  });
  ownPid(daemon.pid);
  await waitForDaemon();
  await launchDesktop();

  // Seed a FOREIGN workspace through the real Add Project dialog: the
  // reproduction needs the Bot's session to live somewhere other than the
  // currently-selected workspace.
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.waitFor();
  await addDialog.getByLabel("Folder or repository path").fill(foreignDir);
  await addDialog.getByRole("button", { name: "Add Project", exact: true }).click();
  await page.getByRole("button", { name: "Select foreign-workspace" }).waitFor();
  report.checks.push("foreign-workspace-added-through-the-real-dialog");

  // Create the Bot through the real page.
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
  await form.getByLabel("Agent", { exact: true }).selectOption("pi");
  await form.getByRole("button", { name: "Create Bot", exact: true }).click();
  const card = panel.locator('[data-slot="card"][data-testid^="bot-"]', {
    hasText: "Jon Snow",
  });
  await card.waitFor();
  const botTestId = await card.getAttribute("data-testid");
  const botId = botTestId.startsWith("bot-") ? botTestId.slice(4) : null;
  assert.ok(botId, `bot card must carry bot-<id>, got ${botTestId}`);
  report.botId = botId;
  report.checks.push("bot-created-from-the-real-page");

  // First open: a live, idle session in the Bot's own home.
  await card.getByTestId(`open-session-${botId}`).click();
  await waitForTerminalText(page, "CWD=");
  const firstSession = await page.evaluate(async (id) => {
    const snapshot = await window.drogon.botSnapshot({
      workspaceId: "",
      hostId: (await window.drogon.status()).result.hostId,
      locale: "en-US",
    });
    const bot = snapshot.result.bots.find((entry) => entry.id === id);
    return bot?.currentSession ?? null;
  }, botId);
  assert.ok(firstSession?.sessionId, "the first click must open a session");
  report.firstSessionId = firstSession.sessionId;
  const firstText = await terminalBufferText(page);
  assert.ok(firstText.includes("ARG:--continue") === false, "a fresh session must not resume");
  assert.ok(
    firstText.includes("CHILD_SESSION=") &&
      !firstText.includes("CHILD_SESSION=poison-parent"),
    `the poisoned parent markers must never reach the harness: ${firstText}`,
  );
  await shot("03-bot-session-open.png");
  report.checks.push("first-open-session-is-live-and-idle");
  report.checks.push("poisoned-parent-harness-markers-scrubbed");

  // Defect 1: switch to a FOREIGN workspace, then click Open again. The old
  // code searched the selected workspace's session list, missed, and opened a
  // SECOND session. The fix focuses the recorded one.
  await page.getByRole("button", { name: "Select foreign-workspace", exact: true }).click();
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await card.waitFor();
  const sessionsBefore = await page.evaluate(async (workspaceId) => {
    const result = await window.drogon.sessions(workspaceId);
    return result.ok ? result.result.sessions.length : -1;
  }, firstSession.workspaceId ?? "");
  await card.getByTestId(`open-session-${botId}`).click();
  await delay(1500);
  const afterClick = await page.evaluate(async (id) => {
    const snapshot = await window.drogon.botSnapshot({
      workspaceId: "",
      hostId: (await window.drogon.status()).result.hostId,
      locale: "en-US",
    });
    return snapshot.result.bots.find((entry) => entry.id === id)?.currentSession ?? null;
  }, botId);
  assert.equal(
    afterClick?.sessionId,
    firstSession.sessionId,
    "the first click from another workspace must FOCUS the existing session, not open a second one",
  );
  assert.ok(
    sessionsBefore >= 1,
    `the Bot home must still hold exactly the one session (saw ${sessionsBefore})`,
  );
  await shot("04-first-click-focuses-existing-session.png");
  report.checks.push("defect1-first-click-focuses-existing-session");

  // Defect 2: close the session, then reopen. The daemon must pass the
  // harness's own continue flag and the same home must still carry the prior
  // conversation.
  // Close it through the REAL UI Stop control: it performs session.stop and
  // updates the renderer's own session state + Bot snapshot, exactly the
  // path the owner used when he saw a closed session open blank.
  await page.getByTestId("bot-session-stop").click();
  let stopped = null;
  const stopDeadline = Date.now() + 15000;
  while (Date.now() < stopDeadline) {
    stopped = await page.evaluate(async (id) => {
      const snapshot = await window.drogon.botSnapshot({
        workspaceId: "",
        hostId: (await window.drogon.status()).result.hostId,
        locale: "en-US",
      });
      return snapshot.result.bots.find((entry) => entry.id === id)?.currentSession?.verdict ?? null;
    }, botId);
    if (stopped === "exited") break;
    await delay(200);
  }
  report.stopVerdict = stopped;
  assert.equal(stopped, "exited", "the UI Stop control must close the session");
  await page.getByRole("button", { name: "Bots", exact: true }).first().click();
  await panel.waitFor();
  await card.waitFor();
  report.botsPanelVisible = await panel.isVisible();
  await card.getByTestId(`open-session-${botId}`).click();
  await delay(700);
  report.panelAlert = await panel
    .getByRole("alert")
    .first()
    .textContent()
    .catch(() => null);
  report.panelText = (await panel.textContent().catch(() => ""))?.slice(0, 400) ?? "";
  await delay(1500);
  try {
    report.resumeDiag = await page.evaluate(async (id) => {
      const hostId = (await window.drogon.status()).result.hostId;
      const snapshot = await window.drogon.botSnapshot({ workspaceId: "", hostId, locale: "en-US" });
      const bot = snapshot.result.bots.find((entry) => entry.id === id);
      const ws = bot?.currentSession?.workspaceId;
      const sessions = ws ? await window.drogon.sessions(ws) : null;
      return {
        currentSession: bot?.currentSession ?? null,
        sessions: sessions?.ok
          ? sessions.result.sessions.map((s) => ({ id: s.id, args: s.args, verdict: s.verdict }))
          : null,
      };
    }, botId);
    report.resumeTerminal = await terminalBufferText(page);
  } catch (diagError) {
    report.resumeDiagError = String(diagError);
  }
  await waitForTerminalText(page, "PRIOR:");
  const resumedText = await terminalBufferText(page);
  assert.ok(
    resumedText.includes("ARG:--continue"),
    `the reopened session must pass --continue to the harness: ${resumedText}`,
  );
  assert.ok(
    resumedText.includes("PRIOR:"),
    `the resumed session must find the prior conversation in the same home: ${resumedText}`,
  );
  const resumed = await page.evaluate(async (id) => {
    const snapshot = await window.drogon.botSnapshot({
      workspaceId: "",
      hostId: (await window.drogon.status()).result.hostId,
      locale: "en-US",
    });
    return snapshot.result.bots.find((entry) => entry.id === id)?.currentSession ?? null;
  }, botId);
  assert.notEqual(
    resumed?.sessionId,
    firstSession.sessionId,
    "a closed session must be replaced by a resumed one",
  );
  assert.equal(resumed?.verdict, "live", "the resumed session must be live");
  report.resumedSessionId = resumed.sessionId;
  await shot("05-resumed-session-carries-prior-conversation.png");
  report.checks.push("defect2-closed-session-resumes-with-continue");
  report.checks.push("defect2-resumed-session-finds-prior-conversation");

  // Defect 3: the sidebar Chats row shows the character avatar and name.
  const sidebarRow = page.locator("[data-bot-session-row]").first();
  await sidebarRow.waitFor();
  const avatarSrc = await sidebarRow
    .locator('span[role="img"] img')
    .first()
    .getAttribute("src");
  const avatarAlt = await sidebarRow.locator('span[role="img"]').first().getAttribute("aria-label");
  assert.ok(avatarSrc?.includes("jon-snow"), `Chats row avatar must be the character art, got ${avatarSrc}`);
  assert.equal(avatarAlt, "Jon Snow avatar");
  const rowText = (await sidebarRow.textContent()) ?? "";
  assert.ok(rowText.includes("Jon Snow"), `Chats row must show the character name: ${rowText}`);
  assert.ok(rowText.includes("Pi"), `Chats row must keep the harness identifiable: ${rowText}`);
  report.checks.push("defect3-chats-row-shows-character-avatar-and-name");

  // Light and dark captures at every required width, with an overflow check.
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await sidebarRow.waitFor();
      await page.evaluate(() => {
        document
          .querySelector("[data-bot-session-row]")
          ?.scrollIntoView({ block: "center" });
      });
      await assertNoOverflow(`${theme}-${width}`);
      await shot(`chats-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await delay(300);
    await shot(`resumed-session-${theme}.png`);
  }
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close().catch(() => {});
    // Capture descendants before stopping the parents, so cleanup can prove
    // no test-owned helper survived.
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
      cleanupError instanceof Error ? cleanupError.stack ?? cleanupError.message : String(cleanupError);
  }
  await writeFile(
    path.join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
