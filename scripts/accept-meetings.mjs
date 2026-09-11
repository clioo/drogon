// Focused CDP acceptance for the Meetings surface (the owner's own Write That
// Down notes): the honest states, the bounded list, the read-only reader and
// the light/dark sweeps at 1440/1100/900/760.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE, window parked
// off-screen). The notes are fixtures written by this script — never the
// developer's own ~/Transcripts, and never real model inference.
//
// The one daemon runs with WTD_OUTPUT_DIR pointing at a path this script
// creates underneath it, so the SAME app process honestly reports "the folder
// does not exist", then "the folder is empty", then the real meetings. That
// live transition is the point: the states are not mocked.
//
// Usage: node scripts/accept-meetings.mjs [--keep]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const keep = process.argv.includes("--keep");
const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const daemonBin = path.join(root, "target", "debug", exe("drogond"));
const cliBin = path.join(root, "target", "debug", exe("drogon-cli"));

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "meetings-"));
const dataDir = path.join(fixtureRoot, "data");
const notesDir = path.join(fixtureRoot, "Transcripts");
const output = path.join(root, ".preflight", "acceptance", `meetings-${Date.now()}`);
await mkdir(output, { recursive: true });

const report = {
  kind: "meetings-cdp",
  output,
  checks: [],
  screenshots: [],
  states: {},
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
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(
        cliBin,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 2000 },
      );
      assert.equal(JSON.parse(response.stdout).ok, true);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

async function launchDesktop() {
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixtureRoot, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      // Park the window off-screen at the widest sweep width, exactly like
      // scripts/fidelity/compare-surfaces.mjs does; narrower widths use CDP
      // viewport emulation because the app cannot be asked to resize itself
      // in a background window.
      DROGON_WINDOW_BOUNDS: "1440x900+4000+4000",
    },
  });
  ownPid(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 30000);
    desktop.once("exit", () => reject(new Error(`electron exited before connecting: ${tail}`)));
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
  for (let i = 0; i < 240 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "electron must create a rendered page");
  await emulatePageFocus(page);
  page.setDefaultTimeout(20000);
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
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

async function openMeetings() {
  await page.getByRole("button", { name: "Meetings", exact: true }).first().click();
  await page.getByRole("heading", { name: "Meeting transcripts", exact: true }).waitFor();
}

async function refreshMeetings() {
  await page.getByRole("button", { name: "Refresh meetings", exact: true }).click();
}

/** Writes one conversation exactly as Write That Down's TranscriptWriter does. */
async function writeNote({ date, time, duration, title, body }) {
  const file = duration === "recording…" ? `${time}_recording_.md` : `${time}_${duration.replace(" min", "min")}.md`;
  const colon = time.replace("-", ":");
  const dir = path.join(notesDir, date);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, file),
    `# ${title}\n**Date:** ${date} ${colon}\n**Duration:** ${duration}\n\n## Transcript\n\n${body}\n`,
  );
}

async function treeHash() {
  const entries = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const bytes = await readFile(full);
      entries.push(`${path.relative(notesDir, full)}:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  }
  await walk(notesDir);
  return entries.sort().join("\n");
}

try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env, WTD_OUTPUT_DIR: notesDir },
  });
  ownPid(daemon.pid);
  await waitForDaemon();
  await launchDesktop();

  // The surface must be reachable from the sidebar, which is where it lives.
  // Pin the capture size explicitly: the native window is 1440x900 at DPR 2
  // (a 2880x1800 shot), and every other capture in this sweep is measured at
  // the emulated viewport, so the first one must match.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMeetings();
  await page.getByText("Notes folder not found", { exact: true }).waitFor();
  const missingCopy = await page.locator("main").innerText();
  assert.ok(
    missingCopy.includes(notesDir),
    `the missing state must name the exact folder: ${missingCopy}`,
  );
  assert.ok(
    !missingCopy.includes("No transcript artifacts found"),
    "a missing folder must never render the empty-meetings copy",
  );
  assert.ok(
    !missingCopy.includes("0 transcripts"),
    `an unread folder must never claim a transcript count: ${missingCopy}`,
  );
  assert.ok(
    missingCopy.includes("Notes folder could not be read"),
    `the header must say the folder could not be read: ${missingCopy}`,
  );
  report.states.missing = missingCopy.split("\n").slice(0, 8).join(" | ");
  await assertNoOverflow("missing-1440");
  await shot("01-missing-folder-dark-1440.png");
  report.checks.push("missing-folder-named-not-empty");
  report.checks.push("unread-folder-header-never-claims-a-count");

  // Same process, folder now exists and is empty: a different truth.
  await mkdir(notesDir, { recursive: true });
  await refreshMeetings();
  await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
  const emptyCopy = await page.locator("main").innerText();
  assert.ok(emptyCopy.includes("holds no Write That Down transcripts"), emptyCopy);
  report.states.empty = emptyCopy.split("\n").slice(0, 8).join(" | ");
  report.checks.push("empty-folder-says-empty-only-when-empty");

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await openMeetings();
    await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
      await assertNoOverflow(`empty-${theme}-${width}`);
      await shot(`empty-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Populate the very same folder and refresh: the real meetings, newest
  // first, including one live recording and one file that fails to parse.
  await writeNote({
    date: "2026-09-09",
    time: "09-00",
    duration: "12 min",
    title: "Yesterday retro",
    body: "[00:00] hola desde la reunion de ayer",
  });
  await writeNote({
    date: "2026-09-10",
    time: "08-05",
    duration: "42 min",
    title: "Weekly sync",
    body: "[00:00] hola desde la reunion de hoy",
  });
  await writeNote({
    date: "2026-09-10",
    time: "15-30",
    duration: "recording…",
    title: "Design review",
    body: "[00:00] hola desde la reunion en vivo",
  });
  await mkdir(path.join(notesDir, "2026-09-10"), { recursive: true });
  await writeFile(path.join(notesDir, "2026-09-10", "16-00_5min.md"), "# Broken\nno header at all\n");
  await writeFile(path.join(notesDir, "2026-09-10", "weekly-sync-summary.md"), "# Summary\n");
  await writeFile(path.join(notesDir, "README.md"), "# not a date folder\n");
  const before = await treeHash();

  await refreshMeetings();
  await page.getByText("Weekly sync", { exact: true }).waitFor();
  const rows = page.locator('[role="listitem"]');
  assert.equal(await rows.count(), 4, "the summary sidecar and README must not be indexed");
  const titles = await rows.locator("h3").allInnerTexts();
  assert.deepEqual(
    titles,
    ["5min", "Design review", "Weekly sync", "Yesterday retro"],
    `newest first, with the unparseable file named last-first: ${titles}`,
  );
  const listText = await page.locator("main").innerText();
  assert.ok(listText.includes("Failed"), "the unparseable file must carry the Failed badge");
  assert.ok(
    listText.includes("malformed-transcript"),
    `the failure must be named: ${listText}`,
  );
  assert.ok(listText.includes("16-00_5min.md"), "the failing file must be named by path");
  assert.ok(listText.includes("Recording"), "the live recording must carry its badge");
  assert.ok(listText.includes("In progress"), "a live recording has no duration yet");
  assert.ok(listText.includes("42 min"), "a saved meeting shows its duration");
  assert.ok(
    listText.includes("read-only"),
    "the folder line must state that the index is read-only",
  );
  report.states.populated = titles.join(" | ");
  report.checks.push("populated-list-newest-first-with-named-failure");

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await openMeetings();
    await page.getByText("Weekly sync", { exact: true }).waitFor();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText("Weekly sync", { exact: true }).waitFor();
      await assertNoOverflow(`populated-${theme}-${width}`);
      await shot(`populated-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Open the note: the existing editor renders it, read-only, byte-exact.
  await openMeetings();
  const weeklyRow = page.locator('[role="listitem"]', { hasText: "Weekly sync" });
  await weeklyRow.getByRole("button", { name: /Open transcript/ }).click();
  const weeklyPath = path.join(notesDir, "2026-09-10", "08-05_42min.md");
  await page.waitForFunction(
    (key) => window.__drogonEditors?.get(key) !== undefined,
    weeklyPath,
    { timeout: 15000 },
  );
  const expected = await readFile(weeklyPath, "utf8");
  const rendered = await page.evaluate(
    (key) => window.__drogonEditors.get(key).getValue(),
    weeklyPath,
  );
  assert.equal(rendered, expected, "the reader must show the note byte for byte");
  const readOnly = await page.evaluate(
    (key) => window.__drogonEditors.get(key).getRawOptions().readOnly,
    weeklyPath,
  );
  assert.equal(readOnly, true, "the note surface must be read-only");
  report.checks.push("reader-shows-note-byte-exact-and-read-only");
  await shot("reader-light-1440.png");

  // Typing into a read-only surface changes nothing on screen and, more
  // importantly, nothing on disk.
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.type("DROGON MUST NOT WRITE THIS");
  const afterType = await page.evaluate(
    (key) => window.__drogonEditors.get(key).getValue(),
    weeklyPath,
  );
  assert.equal(afterType, expected, "typing must not alter a read-only transcript");
  await page.getByRole("button", { name: /Back to meetings/ }).click();
  await page.getByText("Weekly sync", { exact: true }).waitFor();
  await selectSettingsTheme(page, "dark");
  await openMeetings();
  await weeklyRow.getByRole("button", { name: /Open transcript/ }).click();
  await page.waitForFunction(
    (key) => window.__drogonEditors?.get(key) !== undefined,
    weeklyPath,
    { timeout: 15000 },
  );
  await shot("reader-dark-1440.png");

  const after = await treeHash();
  assert.equal(after, before, "the notes must be byte-identical after browsing");
  report.checks.push("notes-untouched-after-browse-and-read");
  report.notesTreeHash = createHash("sha256").update(before).digest("hex");

  // The capability the whole surface gates on, straight from the real daemon.
  const status = JSON.parse(
    (await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], {
      timeout: 5000,
    })).stdout,
  );
  assert.ok(
    status.result.capabilities.includes("meetings.v1"),
    `status must advertise meetings.v1: ${status.result.capabilities.join(",")}`,
  );
  report.checks.push("service-advertises-meetings-v1");

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
    if (!keep) await rm(fixtureRoot, { recursive: true, force: true });
    else report.fixtureRoot = fixtureRoot;
  } catch (cleanupError) {
    process.exitCode = 1;
    report.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
