// Work board acceptance over CDP: the real desktop (dev, or a packaged
// bundle with --bundle) against its own daemon, in a BACKGROUND window with
// its own temp DROGON_DATA_DIR / DROGON_ELECTRON_PROFILE. The harness is a
// shell fixture `claude` on PATH (argv + stdin echo): no model inference.
//
// What it proves, through the UI and the daemon together:
//  1. Work sits in the sidebar under Sessions and opens the board.
//  2. A column's prompt is configured in its panel (saved to the daemon).
//  3. A ticket is created from the UI; a session is linked from the UI and
//     another from the CLI; the card shows both.
//  4. Dragging the card into the column types the prompt into BOTH live
//     sessions (read back from the sessions themselves).
//  5. Clicking a linked session opens it: the Sessions view with that
//     session's terminal tab active.
//  6. A session that is no longer running is resumed by the same click, the
//     replacement opens, and the ticket now links the replacement.
//  7. "Send now" reaches the session; List and Sources show the ticket.
//  8. A Jira board (the stateful fake Jira, 127.0.0.1 only) is imported:
//     board, then issues; the picker opens on the issues assigned to you
//     (chosen), "Anyone" adds the rest; its columns, sprint and cards (Jira
//     key, type, priority, assignee, carried-from).
//  9. Jira moves an issue: Sync moves the card and the column's on-enter
//     prompt starts a session for it.
// 10. A card dropped in Drogon waits "Not synced to Jira" until Push, and
//     Jira really transitions; a conflict is settled with "Use Jira's".
// 11. The ticket panel's New session starts a session linked to the ticket
//     and opens it.
// 12. A closed sprint is read-only with its outcome; its summary carries a
//     ticket over, and "Push all pending" moves it in Jira.
// 13. Sources: every source starts allowed; turning one off takes it out of
//     the Import board menu; the "Sync a board" card is dismissible and
//     comes back from Sources.
// 14. GitHub connects from the UI (token + Enterprise API URL on the fake
//     GitHub); a GitHub Project imports with its Status columns and
//     iterations; a drop + Push sets the item's Status on GitHub.
// 15. A Linear team imports (key connected over the CLI's rpc) and reads in
//     cycles; Linear moving an issue moves its card on Sync, and an issue
//     Linear assigns to you comes in by itself on the next Sync.
//
// Usage: node scripts/accept-work-board.mjs [--bundle <Drogon.app>]
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
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const bundleIndex = args.indexOf("--bundle");
const bundle = bundleIndex === -1 ? null : path.resolve(args[bundleIndex + 1]);
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const daemonBin = bundle
  ? path.join(bundle, "Contents", "Resources", "bin", "drogond")
  : path.join(root, "target", "debug", "drogond");
const cliBin = bundle
  ? path.join(bundle, "Contents", "Resources", "bin", "drogon-cli")
  : path.join(root, "target", "debug", "drogon-cli");

const fixture = await mkdtemp(path.join(tmpdir(), "dwork-"));
const dataDir = path.join(fixture, "data");
const projectDir = path.join(fixture, "Drogon");
const fixtureBin = path.join(fixture, "bin");
const claudeConfigDir = path.join(fixture, "claude-config");
const output = path.join(root, ".preflight", "acceptance", `work-board-${Date.now()}`);
for (const dir of [projectDir, fixtureBin, claudeConfigDir, output]) {
  await mkdir(dir, { recursive: true });
}
await writeFile(
  path.join(fixtureBin, "claude"),
  [
    "#!/bin/bash",
    'for arg in "$@"; do echo "ARG:$arg"; done',
    "echo CLAUDE-FIXTURE-READY",
    "trap 'exit 0' TERM INT",
    'while IFS= read -r line; do echo "you said: $line"; done',
    "",
  ].join("\n"),
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  CLAUDE_CONFIG_DIR: claudeConfigDir,
};

const fakeJira = path.join(root, "scripts", "fixtures", "jira", "fake-jira-server.mjs");
const jiraData = path.join(root, "scripts", "fixtures", "jira", "data", "agile-site.json");
let jira = null;
let jiraUrl = null;

/** The fake Jira on an ephemeral 127.0.0.1 port; its --log path keeps the
 *  fixture dir on its command line, so the survivor check covers it. */
async function startJira() {
  jira = startAcceptanceProcess(process.execPath, [fakeJira, "--port", "0", "--data", jiraData, "--log", path.join(fixture, "jira.jsonl")], {
    stdio: ["ignore", "pipe", "ignore"],
    env,
  });
  ownedPids.add(jira.pid);
  const port = await new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("fake Jira never listened")), 15000);
    jira.stdout.on("data", (bytes) => {
      buffered += bytes.toString();
      const match = buffered.match(/LISTEN (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  jiraUrl = `http://127.0.0.1:${port}`;
}

/** A teammate's change in "Jira" (the fixture's control endpoint). */
async function jiraControl(pathname, body) {
  const response = await fetch(`${jiraUrl}/__fixture/${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `fixture control ${pathname}`);
}

async function jiraIssue(key) {
  const preview = await cli(["work", "import", "preview", "--board", "7"]);
  return preview.issues.find((i) => i.key === key);
}

const fakeSources = path.join(root, "scripts", "fixtures", "work-sources", "fake-sources-server.mjs");
let sources = null;
let sourcesUrl = null;

async function startSources() {
  sources = startAcceptanceProcess(process.execPath, [fakeSources, "--port", "0", "--log", path.join(fixture, "sources.jsonl")], {
    stdio: ["ignore", "pipe", "ignore"],
    env,
  });
  ownedPids.add(sources.pid);
  const port = await new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("fake sources never listened")), 15000);
    sources.stdout.on("data", (bytes) => {
      buffered += bytes.toString();
      const match = buffered.match(/LISTEN (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  sourcesUrl = `http://127.0.0.1:${port}`;
}

async function sourcesControl(pathname, body) {
  const response = await fetch(`${sourcesUrl}/__fixture/${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `fixture control ${pathname}`);
}

async function importMenu() {
  await page.getByRole("button", { name: "Import board", exact: true }).click();
  const items = (await page.getByRole("menuitem").allTextContents()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  return items;
}

const report = {
  kind: "work-board-cdp",
  bundle,
  output,
  checks: [],
  screenshots: [],
  processes: { desktop: null, daemon: null, survivors: [] },
};
const check = (name) => {
  report.checks.push(name);
  process.stderr.write(`ok ${name}\n`);
};

let browser = null;
let page = null;
let desktop = null;
let daemon = null;
const ownedPids = new Set();

async function cli(argv, { allowFailure = false } = {}) {
  try {
    const { stdout } = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", ...argv], {
      timeout: 60000,
      env,
    });
    const envelope = JSON.parse(stdout);
    if (!envelope.ok && !allowFailure) throw new Error(`${argv.join(" ")}: ${JSON.stringify(envelope.error)}`);
    return envelope.result ?? envelope;
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

async function sessionText(session) {
  const read = await cli(["terminal", "read", "--session", session.id, "--incarnation", session.incarnation]);
  if (typeof read.text === "string") return read.text;
  return Buffer.from(read.dataBase64 ?? "", "base64").toString("utf8");
}

async function waitFor(label, probe, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await probe().catch((error) => ({ error: String(error) }));
    if (last && !last.error && last !== false) return last;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
    await delay(150);
  }
}

async function waitForSessionText(session, needle) {
  return waitFor(`"${needle}" in ${session.id}`, async () => ((await sessionText(session)).includes(needle) ? true : false));
}

async function ticket(key) {
  return cli(["work", "ticket", "show", "--ticket", key]);
}

/** A dark capture of the current view (the fixture's default theme). */
async function shot(name) {
  const file = `${name}-dark.png`;
  await page.screenshot({ path: path.join(output, file), animations: "disabled" });
  report.screenshots.push(file);
}

async function activeSessionTab() {
  return page.evaluate(() =>
    document
      .querySelector('[role="tablist"][aria-label="Sessions"] [role="tab"][aria-selected="true"]')
      ?.getAttribute("data-tab-id") ?? null,
  );
}

async function launch() {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], { stdio: "ignore", env });
  ownedPids.add(daemon.pid);
  await waitFor("daemon", async () => (await cli(["status"], { allowFailure: true }))?.capabilities?.includes("work.v1"));
  check("daemon-advertises-work-v1");
  const executable = bundle ? path.join(bundle, "Contents", "MacOS", "Drogon") : electron;
  desktop = startAcceptanceProcess(executable, [...(bundle ? [] : [appDir]), "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
    },
  });
  ownedPids.add(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 30000);
    desktop.once("exit", () => reject(new Error(`desktop exited: ${tail}`)));
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
  for (let i = 0; i < 600 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "the desktop renders a page");
  await emulatePageFocus(page);
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
}

try {
  await launch();
  const project = await cli(["project", "add", projectDir]);
  const workspaceId = (await cli(["worktree", "list", "--project", project.id])).worktrees[0].workspaceId;
  const first = await cli(["harness", "start", "--workspace", workspaceId, "--harness", "claude"]);
  const second = await cli(["harness", "start", "--workspace", workspaceId, "--harness", "claude"]);
  await waitForSessionText(first, "CLAUDE-FIXTURE-READY");
  await waitForSessionText(second, "CLAUDE-FIXTURE-READY");

  // 1. The sidebar row, right under Sessions.
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll(".shell-nav-links button")].map((b) => b.textContent.trim()),
  );
  assert.equal(nav[nav.indexOf("Sessions") + 1], "Work", `nav order: ${nav}`);
  await page.getByRole("button", { name: "Work", exact: true }).click();
  const board = page.getByTestId("work-board");
  await board.waitFor();
  for (const name of ["To do", "In progress", "Review", "QA", "Done"]) {
    await page.getByRole("region", { name: `${name} column` }).waitFor();
  }
  assert.equal(
    await page.getByRole("button", { name: "Work", exact: true }).getAttribute("aria-current"),
    "page",
  );
  check("sidebar-work-row-opens-the-board-with-default-columns");
  // The optional card lists every allowed source; dismissed, it stays gone
  // until Sources brings it back.
  const syncCard = page.getByTestId("work-sync-card");
  await syncCard.getByRole("button", { name: /Import a Linear team/ }).waitFor();
  await syncCard.getByRole("button", { name: /Import a GitHub project or repository/ }).waitFor();
  await shot("sync-card");
  await syncCard.getByRole("button", { name: "Dismiss" }).click();
  await syncCard.waitFor({ state: "detached" });
  assert.deepEqual(await importMenu(), [
    "Import a Jira board…",
    "Import a Linear team…",
    "Import a GitHub project or repository…",
    "Manage sources…",
  ]);
  await page.getByRole("tab", { name: "sources" }).click();
  await page.getByRole("button", { name: /Sync a board" card/ }).click();
  await page.getByRole("tab", { name: "board" }).click();
  await syncCard.waitFor();
  check("the-sync-card-is-dismissible-and-returns-from-sources");

  // 2. Configure the Review column's prompt in its panel.
  await page.getByRole("button", { name: "Review column actions" }).click();
  await page.getByRole("menuitem", { name: "Configure prompt…" }).click();
  const columnPanel = page.getByRole("complementary", { name: "Review prompt" });
  await columnPanel.getByRole("checkbox", { name: "Ticket enters Review" }).click();
  await columnPanel.getByRole("checkbox", { name: "Pull request changes" }).click();
  const message = columnPanel.getByRole("textbox", { name: "Message to sessions" });
  await message.fill("Review {ticket.pr} for {ticket.id}: {ticket.title}");
  await columnPanel.getByRole("heading", { name: "Recipients" }).click();
  await waitFor("column saved", async () => {
    const review = (await cli(["work", "column", "list"])).columns.find((c) => c.name === "Review");
    return review.sendOnEnter && review.prWatch && review.message === "Review {ticket.pr} for {ticket.id}: {ticket.title}";
  });
  await page.getByRole("region", { name: "Review column" }).getByText("On enter · PR watch").waitFor();
  await shot("column-panel");
  check("column-prompt-configured-in-the-panel-is-saved-to-the-daemon");
  await columnPanel.getByRole("button", { name: "Close prompt panel" }).click();

  // 3. A ticket from the UI, one session linked from the UI, one from the CLI.
  await page.getByRole("button", { name: "New ticket in In progress" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Improve Jira resume");
  await dialog.getByRole("combobox", { name: "Project" }).selectOption({ label: "Drogon" });
  await dialog.getByRole("textbox", { name: "Pull request" }).fill("#648");
  await dialog.getByRole("textbox", { name: "Source link" }).fill("https://jira.example.com/browse/DRG-9");
  await dialog.getByRole("button", { name: "Create ticket" }).click();
  await dialog.waitFor({ state: "detached" });
  const created = await ticket("DRG-1");
  assert.equal(created.title, "Improve Jira resume");
  assert.equal(created.prNumber, 648);
  const ticketPanel = page.getByRole("complementary", { name: "Ticket DRG-1" });
  await ticketPanel.waitFor();
  await ticketPanel.getByRole("tab", { name: "sessions" }).click();
  await ticketPanel.getByRole("button", { name: /Link a session/ }).click();
  const picker = ticketPanel.getByRole("combobox", { name: "Session to link" });
  await picker.selectOption(first.id);
  await ticketPanel.getByRole("button", { name: "Link", exact: true }).click();
  await waitFor("UI link", async () => (await ticket("DRG-1")).sessions.some((s) => s.id === first.id));
  await cli(["work", "ticket", "link", "--ticket", "DRG-1", "--session", second.id]);
  const card = page.getByRole("article", { name: "DRG-1 Improve Jira resume" });
  await card.getByText("2 linked sessions").waitFor({ timeout: 15000 });
  await card.getByText("PR #648").waitFor();
  await card.getByText("Drogon").waitFor();
  check("ticket-created-in-the-ui-with-sessions-linked-from-ui-and-cli");

  // 4. Drag the card into Review: both live sessions receive the prompt.
  await card.dragTo(page.getByRole("region", { name: "Review column" }));
  await waitFor("ticket in Review", async () => {
    const shown = await ticket("DRG-1");
    const review = (await cli(["work", "column", "list"])).columns.find((c) => c.name === "Review");
    return shown.columnId === review.id;
  });
  const expected = "you said: Review PR #648 for DRG-1: Improve Jira resume";
  await waitForSessionText(first, expected);
  await waitForSessionText(second, expected);
  const sends = await cli(["work", "sends", "--ticket", "DRG-1"]);
  assert.equal(sends.sends[0].trigger, "enter");
  assert.deepEqual(sends.sends[0].results.map((r) => r.action), ["sent", "sent"]);
  await page.getByRole("region", { name: "Review column" }).getByRole("article", { name: "DRG-1 Improve Jira resume" }).waitFor();
  await shot("board-after-drag");
  check("dragging-into-a-column-types-its-prompt-into-every-live-linked-session");

  // 5. Clicking a linked session opens it in the Sessions view.
  await page.getByRole("button", { name: "Open DRG-1: Improve Jira resume" }).click();
  await ticketPanel.waitFor();
  await shot("ticket-panel");
  await ticketPanel.getByRole("button", { name: new RegExp(`Open Claude Code session ${first.id.slice(0, 8)}`) }).click();
  await waitFor("session tab active", async () => (await activeSessionTab()) === first.id);
  assert.equal(
    await page.getByRole("button", { name: "Sessions", exact: true }).getAttribute("aria-current"),
    "page",
  );
  await waitFor("prompt visible in the opened terminal", async () =>
    page.evaluate(
      ({ id, needle }) => {
        const terminal = window.__drogonTerminals?.get(id);
        if (!terminal) return false;
        let text = "";
        for (let row = 0; row < terminal.buffer.active.length; row += 1)
          text += `${terminal.buffer.active.getLine(row)?.translateToString(true) ?? ""}\n`;
        return text.includes(needle);
      },
      { id: first.id, needle: expected },
    ),
  );
  await shot("session-opened-from-ticket");
  check("clicking-a-linked-session-opens-its-terminal-tab");

  // 6. A session that is no longer running is resumed by the same click.
  await cli(["rpc", "session.stop", "--params", JSON.stringify({ sessionId: second.id, incarnation: second.incarnation })]);
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await ticketPanel.waitFor();
  const secondRow = ticketPanel.getByRole("button", { name: new RegExp(`Open Claude Code session ${second.id.slice(0, 8)}`) });
  await ticketPanel
    .locator("li")
    .filter({ has: page.getByRole("button", { name: new RegExp(`Open Claude Code session ${second.id.slice(0, 8)}`) }) })
    .getByText("Exited")
    .waitFor({ timeout: 15000 });
  await secondRow.click();
  const replacementId = await waitFor("replacement linked", async () => {
    const shown = await ticket("DRG-1");
    const ids = shown.sessions.map((s) => s.id);
    return !ids.includes(second.id) && ids.length === 2 ? ids.find((id) => id !== first.id) : false;
  });
  await waitFor("replacement tab active", async () => (await activeSessionTab()) === replacementId);
  const replacement = (await ticket("DRG-1")).sessions.find((s) => s.id === replacementId);
  assert.equal(replacement.verdict, "live");
  await waitForSessionText(replacement, "CLAUDE-FIXTURE-READY");
  check("a-stopped-session-is-resumed-by-its-click-and-replaces-the-old-link");

  // 7. Send now from the column panel; List and Sources views.
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: "Review column actions" }).click();
  await page.getByRole("menuitem", { name: "Configure prompt…" }).click();
  await columnPanel.getByRole("textbox", { name: "Message to sessions" }).fill("Status check for {ticket.id}");
  await columnPanel.getByRole("button", { name: "Preview" }).click();
  await columnPanel.getByTestId("work-column-preview").getByText("Status check for DRG-1").waitFor();
  await columnPanel.getByRole("button", { name: "Send now" }).click();
  await waitForSessionText(first, "you said: Status check for DRG-1");
  await waitForSessionText(replacement, "you said: Status check for DRG-1");
  await columnPanel.getByTestId("work-column-last-sent").getByText(/Last sent .* · 2 sessions/).waitFor({ timeout: 15000 });
  check("send-now-reaches-every-linked-session-and-reports-last-sent");
  await columnPanel.getByRole("button", { name: "Close prompt panel" }).click();
  await page.getByRole("tab", { name: "list" }).click();
  await page.getByRole("table", { name: "Tickets" }).getByText("DRG-1").waitFor();
  await page.getByRole("tab", { name: "sources" }).click();
  await page.getByRole("region", { name: "Jira sources" }).getByText("Improve Jira resume").waitFor();
  await shot("sources");
  await page.getByRole("tab", { name: "board" }).click();
  check("list-and-sources-views-show-the-ticket");

  // 8. Import a Jira board from the Import board menu.
  await startJira();
  await cli(["rpc", "jira.connect", "--params", JSON.stringify({ siteUrl: jiraUrl, email: "carlos@example.com", apiToken: "fixture-token" })]);
  await page.getByRole("button", { name: "Import board", exact: true }).click();
  await page.getByRole("menuitem", { name: /Import a Jira board/ }).click();
  const importDialog = page.getByTestId("work-import-dialog");
  await importDialog.getByRole("button", { name: "Choose Platform Delivery" }).click();
  await importDialog.getByTestId("work-import-columns").getByText("Columns: To Do · In Progress · Review · QA · Done").waitFor();
  assert.equal(await importDialog.getByRole("combobox", { name: "Assigned to" }).inputValue(), "me");
  await importDialog.getByRole("checkbox", { name: "Import APP-142" }).waitFor();
  assert.equal(await importDialog.getByRole("checkbox", { name: "Import APP-130" }).count(), 0, "only yours at first");
  await importDialog.getByRole("button", { name: "Import 2 issues" }).waitFor();
  await importDialog.getByRole("combobox", { name: "Assigned to" }).selectOption("any");
  await importDialog.getByRole("checkbox", { name: "Import APP-130" }).waitFor();
  await importDialog.getByRole("checkbox", { name: "All of Sprint 25 · Active" }).click();
  await importDialog.getByRole("checkbox", { name: "Import APP-122" }).click();
  await importDialog.getByRole("combobox", { name: "Drogon project for sessions" }).selectOption({ label: "Drogon" });
  await shot("jira-import-issues");
  await importDialog.getByRole("button", { name: "Import 7 issues" }).click();
  await importDialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Board", exact: true }).getByText("Platform Delivery · Jira").waitFor();
  await page.getByRole("button", { name: "Sprint", exact: true }).getByText("Sprint 25 · Active").waitFor();
  const carried = page.getByRole("article", { name: "APP-128 Handle session resume after PR review" });
  await carried.getByTestId("work-carried").getByText("Carried from Sprint 24").waitFor();
  await carried.getByTestId("work-issue-type").getByText("Task").waitFor();
  await carried.getByRole("img", { name: "Jon Doe" }).waitFor();
  const boards = await cli(["work", "boards"]);
  assert.deepEqual(boards.boards.map((b) => b.name), ["My work", "Platform Delivery"]);
  await shot("jira-board");
  check("a-jira-board-and-chosen-issues-import-from-the-import-menu");

  // 9. Jira moves APP-130; Sync moves the card and Review's prompt fires.
  await page.getByRole("button", { name: "Review column actions" }).click();
  await page.getByRole("menuitem", { name: "Configure prompt…" }).click();
  const jiraReview = page.getByRole("complementary", { name: "Review prompt" });
  await jiraReview.getByTestId("work-column-statuses").getByRole("checkbox", { name: "Map In Review to Review" }).waitFor();
  await jiraReview.getByRole("checkbox", { name: "Ticket enters Review" }).click();
  await jiraReview.getByRole("textbox", { name: "Message to sessions" }).fill("Jira moved {ticket.key} to {ticket.status}");
  await jiraReview.getByRole("heading", { name: "Recipients" }).click();
  await waitFor("Jira review prompt saved", async () => {
    const cols = await cli(["work", "column", "list", "--board", "7"]);
    return cols.columns.find((c) => c.name === "Review")?.message === "Jira moved {ticket.key} to {ticket.status}";
  });
  await jiraReview.getByRole("button", { name: "Close prompt panel" }).click();
  await jiraControl("issue/APP-130", { status: "In Review" });
  await page.getByRole("button", { name: "Sync Platform Delivery" }).click();
  await page.getByRole("region", { name: "Review column" }).getByRole("article", { name: /APP-130/ }).waitFor({ timeout: 20000 });
  const moved = await ticket("APP-130");
  assert.equal(moved.sends[0].trigger, "enter");
  assert.equal(moved.sends[0].results[0].action, "started");
  const started = moved.sessions[0];
  await waitForSessionText(started, "ARG:Jira moved APP-130 to In Review");
  assert.ok(moved.activity.some((a) => a.text === "Moved by Jira: In Progress → Review"));
  check("a-jira-status-change-moves-the-card-and-fires-the-columns-prompt");

  // 10. A Drogon move waits for Push; a conflict takes Jira's status.
  await page.getByRole("article", { name: /APP-142/ }).dragTo(page.getByRole("region", { name: "QA column" }));
  const pending = page.getByRole("region", { name: "QA column" }).getByRole("article", { name: /APP-142/ });
  await pending.getByText("Not synced to Jira").waitFor();
  assert.equal((await jiraIssue("APP-142")).status.name, "To Do");
  await shot("jira-not-synced");
  await pending.getByRole("button", { name: "Push to Jira" }).click();
  await waitFor("Jira transitioned APP-142", async () => (await jiraIssue("APP-142")).status.name === "QA");
  await pending.getByText("Not synced to Jira").waitFor({ state: "detached" });
  await page.getByRole("article", { name: /APP-149/ }).dragTo(page.getByRole("region", { name: "Review column" }));
  await jiraControl("issue/APP-149", { status: "Done" });
  await page.getByRole("button", { name: "Sync Platform Delivery" }).click();
  const conflict = page.getByRole("article", { name: /APP-149/ });
  await conflict.getByText("Jira: Done").waitFor({ timeout: 20000 });
  await shot("jira-conflict");
  await conflict.getByRole("button", { name: "Use Jira's" }).click();
  await page.getByRole("region", { name: "Done column" }).getByRole("article", { name: /APP-149/ }).waitFor();
  check("a-drogon-move-waits-for-push-and-a-conflict-takes-jiras-status");

  // 11. New session from the ticket panel, linked and opened.
  await page.getByRole("button", { name: "Open APP-128: Handle session resume after PR review" }).click();
  const jiraPanel = page.getByRole("complementary", { name: "Ticket APP-128" });
  await jiraPanel.getByRole("region", { name: "Sprint continuity" }).getByText(/Sprint 24/).waitFor();
  await jiraPanel.getByRole("region", { name: "Jira details" }).getByText("Jon Doe").waitFor();
  await shot("jira-ticket-panel");
  await jiraPanel.getByRole("button", { name: "New session" }).click();
  await page.getByRole("menuitem", { name: "Claude Code" }).click();
  const linkedId = await waitFor("new session linked", async () => (await ticket("APP-128")).sessions[0]?.id ?? false);
  await waitFor("new session tab active", async () => (await activeSessionTab()) === linkedId);
  check("new-session-from-the-ticket-panel-is-linked-and-opened");

  // 12. A closed sprint: read-only record, summary, carry over, push.
  await page.getByRole("button", { name: "Work", exact: true }).click();
  if (await page.getByRole("button", { name: "Close ticket panel" }).count()) {
    await page.getByRole("button", { name: "Close ticket panel" }).click();
  }
  await page.getByRole("button", { name: "Sprint", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sprint 24 · Closed" }).click();
  await page.getByTestId("work-closed-banner").getByText("Historical snapshot · prompts paused").waitFor();
  const outcome = page.getByTestId("work-sprint-outcome");
  await outcome.getByText("1 carried over").waitFor();
  assert.equal(await page.getByRole("button", { name: "New column" }).count(), 0);
  await shot("jira-closed-sprint");
  await page.getByTestId("work-closed-banner").getByRole("button", { name: "Sprint summary" }).click();
  const summaryView = page.getByTestId("work-sprint-summary");
  await summaryView.getByRole("heading", { name: "Returned to backlog · 1" }).waitFor();
  await shot("jira-sprint-summary");
  await summaryView.getByRole("button", { name: "Carry over to Sprint 25" }).click();
  await waitFor("carried over", async () => (await ticket("APP-122")).sprintPending === true);
  await page.getByRole("button", { name: "Back to active sprint" }).click();
  await page.getByRole("article", { name: /APP-122/ }).getByText(/Not synced to Jira/).waitFor();
  await page.getByRole("button", { name: "Sync options" }).click();
  await page.getByRole("menuitem", { name: /Push all pending moves/ }).click();
  await waitFor("APP-122 in Sprint 25 on Jira", async () => (await jiraIssue("APP-122")).sprint?.name === "Sprint 25");
  check("a-closed-sprint-is-read-only-and-its-summary-carries-a-ticket-over");

  // 13. Sources: turning Jira off takes it out of the import menus.
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("menuitem", { name: "My work" }).click();
  await page.getByRole("tab", { name: "sources" }).click();
  const panel = page.getByTestId("work-sync-sources");
  const row = (name) => panel.getByRole("listitem", { name });
  await row("Jira").getByTestId("work-source-status").getByText(/Connected as/).waitFor();
  await row("GitHub").getByTestId("work-source-status").getByText("Not connected").waitFor();
  await row("Jira").getByRole("switch", { name: "Allow Jira" }).click();
  await row("Jira").getByTestId("work-source-status").getByText("Off: not imported, synced or pushed").waitFor();
  assert.equal((await cli(["work", "sources"])).sources.find((s) => s.id === "jira").enabled, false);
  await page.getByRole("tab", { name: "board" }).click();
  assert.deepEqual(await importMenu(), ["Import a Linear team…", "Import a GitHub project or repository…", "Manage sources…"]);
  await page.getByRole("tab", { name: "sources" }).click();
  await row("Jira").getByRole("switch", { name: "Allow Jira" }).click();
  await row("Jira").getByTestId("work-source-status").getByText(/Connected as/).waitFor();
  check("sources-start-allowed-and-an-off-source-leaves-the-import-menu");

  // 14. GitHub, connected from the UI, and a Project imported.
  await startSources();
  await row("GitHub").getByRole("button", { name: "Connect" }).click();
  await row("GitHub").getByRole("button", { name: "GitHub Enterprise?" }).click();
  await row("GitHub").getByLabel("GitHub Enterprise API URL").fill(`${sourcesUrl}/github`);
  await row("GitHub").getByLabel("GitHub token").fill("ghp_fixture");
  await shot("sources-connect-github");
  await row("GitHub").getByRole("button", { name: "Connect", exact: true }).last().click();
  await row("GitHub").getByTestId("work-source-status").getByText("Connected as octo-fixture").waitFor();
  await shot("sources");
  await page.getByRole("tab", { name: "board" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("menuitem", { name: /Import a GitHub project or repository/ }).click();
  const ghDialog = page.getByTestId("work-import-dialog");
  await ghDialog.getByRole("button", { name: "Choose Drogon Roadmap" }).click();
  await ghDialog.getByTestId("work-import-columns").getByText("Columns: No Status · Todo · In Progress · Done").waitFor();
  await ghDialog.getByRole("region", { name: "Iteration 2 · Active" }).waitFor();
  await ghDialog.getByRole("combobox", { name: "Assigned to" }).selectOption("any");
  await ghDialog.getByRole("checkbox", { name: "Import clioo/drogon#11" }).waitFor();
  await ghDialog.getByRole("checkbox", { name: "All of Iteration 2 · Active" }).click();
  await ghDialog.getByRole("button", { name: /^Import \d+ issues?$/ }).click();
  await ghDialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Iteration", exact: true }).getByText("Iteration 2 · Active").waitFor();
  const ghCard = page.getByRole("article", { name: /drogon#11 Iteration picker/ });
  await ghCard.getByTestId("work-issue-type").getByText("Issue").waitFor();
  await shot("github-board");
  await ghCard.dragTo(page.getByRole("region", { name: "Done column" }));
  const ghPending = page.getByRole("region", { name: "Done column" }).getByRole("article", { name: /drogon#11/ });
  await ghPending.getByRole("button", { name: "Push to GitHub" }).click();
  await waitFor("GitHub item status Done", async () => {
    const preview = await cli(["work", "import", "preview", "--provider", "github", "--board", "project:PVT_roadmap"]);
    return preview.issues.find((i) => i.key === "clioo/drogon#11")?.status.name === "Done";
  });
  await ghPending.getByText("Not synced to GitHub").waitFor({ state: "detached" });
  check("github-connects-from-the-ui-and-a-project-round-trips-a-status");

  // 15. Linear: key over the CLI's rpc (the UI form is covered by vitest).
  await cli(["rpc", "work.source_connect", "--params", JSON.stringify({ provider: "linear", apiKey: "lin_api_fixture", apiUrl: `${sourcesUrl}/linear` })]);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("menuitem", { name: /Import a Linear team/ }).click();
  const linDialog = page.getByTestId("work-import-dialog");
  await linDialog.getByRole("button", { name: "Choose Engineering" }).click();
  await linDialog.getByRole("region", { name: "Cycle 12 · Resume polish · Active" }).waitFor();
  await linDialog.getByRole("combobox", { name: "Assigned to" }).selectOption("any");
  await linDialog.getByRole("checkbox", { name: "Import ENG-2" }).waitFor();
  await linDialog.getByRole("checkbox", { name: "All of Cycle 12 · Resume polish · Active" }).click();
  await shot("linear-import-filters");
  await linDialog.getByRole("button", { name: /^Import \d+ issues?$/ }).click();
  await linDialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Cycle", exact: true }).getByText("Cycle 12 · Resume polish · Active").waitFor();
  await page.getByRole("button", { name: "Past cycles" }).waitFor();
  await sourcesControl("linear/issue/ENG-2", { state: "In Progress" });
  await page.getByRole("button", { name: "Sync Engineering" }).click();
  await page.getByRole("region", { name: "In Progress column" }).getByRole("article", { name: /ENG-2/ }).waitFor({ timeout: 20000 });
  // Assigned to you in Linear later: the next Sync brings it in.
  await sourcesControl("linear/issue/ENG-5", { assignee: "Jon Doe", cycle: 12 });
  await page.getByRole("button", { name: "Sync Engineering" }).click();
  await page.getByRole("region", { name: "Backlog column" }).getByRole("article", { name: /ENG-5/ }).waitFor({ timeout: 20000 });
  assert.ok((await ticket("ENG-5")).activity.some((a) => a.text === "Assigned to you in Linear: imported on sync"));
  await shot("linear-board");
  check("a-linear-team-imports-in-cycles-and-follows-linear-on-sync");

  // Light theme, chosen through the real Settings pane (the app's theme does
  // not follow an emulated color scheme): the board and both panels.
  await selectSettingsTheme(page, "light");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await page.getByTestId("work-board").waitFor();
  const light = async (file) => {
    await delay(300);
    await page.screenshot({ path: path.join(output, file), animations: "disabled" });
    report.screenshots.push(file);
  };
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("menuitem", { name: "Platform Delivery · Jira" }).click();
  await page.getByRole("button", { name: "Sprint", exact: true }).waitFor();
  await light("jira-board-light.png");
  await page.getByRole("button", { name: "Open APP-128: Handle session resume after PR review" }).click();
  await jiraPanel.waitFor();
  await light("jira-ticket-panel-light.png");
  await page.getByRole("button", { name: "Close ticket panel" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("menuitem", { name: "My work" }).click();
  await page.getByRole("region", { name: "Review column" }).getByRole("article", { name: "DRG-1 Improve Jira resume" }).waitFor();
  await light("board-light.png");
  await page.getByRole("button", { name: "Review column actions" }).click();
  await page.getByRole("menuitem", { name: "Configure prompt…" }).click();
  await columnPanel.waitFor();
  await light("column-panel-light.png");
  await page.getByRole("button", { name: "Open DRG-1: Improve Jira resume" }).click();
  await ticketPanel.waitFor();
  await light("ticket-panel-light.png");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
  check("board-and-panels-render-in-the-light-theme");
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
} finally {
  try {
    // Close every session this run owns, then the desktop and the daemon.
    const listed = await cli(["terminal", "list"], { allowFailure: true });
    for (const s of listed?.sessions ?? []) {
      if (s.verdict === "live") await cli(["terminal", "close", "--session", s.id, "--incarnation", s.incarnation], { allowFailure: true });
    }
    if (browser) await browser.close().catch(() => {});
    if (desktop) {
      await stopAcceptanceProcess(desktop).catch(() => {});
      report.processes.desktop = "exited";
    }
    if (daemon) {
      await stopAcceptanceProcess(daemon).catch(() => {});
      report.processes.daemon = "exited";
    }
    if (jira) {
      await stopAcceptanceProcess(jira).catch(() => {});
      report.processes.jira = "exited";
    }
    if (sources) {
      await stopAcceptanceProcess(sources).catch(() => {});
      report.processes.sources = "exited";
    }
    await delay(500);
    const { stdout } = await runAcceptanceProcess("/bin/ps", ["-axo", "pid=,command="], { timeout: 5000 });
    report.processes.survivors = stdout.split("\n").filter((line) => line.includes(fixture));
    if (report.processes.survivors.length > 0) {
      process.exitCode = 1;
      report.cleanupError = "processes of this run survived";
    } else {
      await rm(fixture, { recursive: true, force: true });
    }
  } catch (cleanupError) {
    process.exitCode = 1;
    report.cleanupError = String(cleanupError);
  }
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks, error: report.error, output, survivors: report.processes.survivors }, null, 2)}\n`);
}
